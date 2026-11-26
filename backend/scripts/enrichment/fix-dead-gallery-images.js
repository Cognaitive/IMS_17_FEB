#!/usr/bin/env node
"use strict";

/**
 * Fix ready-to-confirm / unpublished products whose images[] URLs are dead
 * (404/403/placeholder) while count > 0 — so New Listings stops lying.
 *
 *   node scripts/enrichment/fix-dead-gallery-images.js
 *   node scripts/enrichment/fix-dead-gallery-images.js --dry-run
 *   node scripts/enrichment/fix-dead-gallery-images.js --skus 95375WM01,TH1710494
 *   node scripts/enrichment/fix-dead-gallery-images.js --audit-only
 *   node scripts/enrichment/fix-dead-gallery-images.js --limit 80
 *
 * Priority recoveries:
 *   - Titan: catalog CDN with optional trailing "F" (IMS often drops it)
 *   - Tommy Hilfiger / Helios 403: Watch Factory Shopify JSON
 *   - Enrichable brands: official enrichSku → retailer chain
 *   - Else: drop dead URLs (clear gallery if none survive)
 *
 * Reads MONGODB_URI + DO Spaces keys from backend/.env (never printed).
 */

const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

// Works from both repo/scripts/enrichment and backend/scripts/enrichment
const CANDIDATE_BACKENDS = [
  path.join(__dirname, "../.."), // backend/scripts/enrichment → backend
  path.join(__dirname, "../../backend"), // scripts/enrichment → backend
];
const BACKEND_ROOT = CANDIDATE_BACKENDS.find((p) =>
  fs.existsSync(path.join(p, "models/Product.js"))
);
if (!BACKEND_ROOT) {
  console.error("Cannot locate backend/models/Product.js from", __dirname);
  process.exit(1);
}
const backendRequire = createRequire(path.join(BACKEND_ROOT, "package.json"));

backendRequire("dotenv").config({ path: path.join(BACKEND_ROOT, ".env") });

const mongoose = backendRequire("mongoose");
const { Product } = backendRequire("./models/Product");
const { migrateUrlsToDoSpaces } = backendRequire("./utils/doSpacesImageMigrator");
const {
  probeImageUrl,
  filterUsableImageUrls,
  classifyGallery,
} = require("./lib/imageProbe");
const { enrichFromRetailerChain } = require("./lib/retailerFallback");
const { sleep } = require("./lib/http");

const TITAN_CATALOG =
  "https://www.titan.co.in/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog";

const dryRun = process.argv.includes("--dry-run");
const auditOnly = process.argv.includes("--audit-only");
const skuArgIdx = process.argv.indexOf("--skus");
const skuFilter =
  skuArgIdx >= 0
    ? String(process.argv[skuArgIdx + 1] || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null;
const limitIdx = process.argv.indexOf("--limit");
const limit =
  limitIdx >= 0 ? Math.max(1, Number(process.argv[limitIdx + 1]) || 120) : 120;

const OUT_DIR = path.join(__dirname, "output/dead-gallery-fix");

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

function titanStyleCandidates(sku) {
  const raw = compactSku(sku);
  const bare = raw.replace(/^NU/i, "").replace(/^NT/i, "");
  if (!bare) return [];
  const out = [bare, raw];
  // Many Raga / new Titan styles append F on titan.co.in while IMS stores bare
  if (!bare.endsWith("F")) out.push(`${bare}F`);
  return [...new Set(out.filter(Boolean))];
}

async function probeTitanCatalogStyle(style) {
  const urls = [];
  for (let i = 1; i <= 8; i++) {
    const url = `${TITAN_CATALOG}/${style}_${i}.jpg`;
    const pr = await probeImageUrl(url, { timeoutMs: 10000 });
    if (pr.ok) urls.push(url);
    else if (i === 1 && !pr.ok) break; // style missing
  }
  return urls;
}

async function recoverTitanImages(sku) {
  for (const style of titanStyleCandidates(sku)) {
    const urls = await probeTitanCatalogStyle(style);
    if (urls.length) {
      return { images: urls, source: `titan-catalog:${style}` };
    }
  }
  return { images: [], source: null };
}

async function fetchWatchFactoryProductJson(handle) {
  const jsonUrl = `https://watchfactory.in/products/${handle}.json`;
  const res = await fetch(jsonUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function watchFactoryHandlesFromSuggest(sku) {
  const compact = compactSku(sku);
  const q = encodeURIComponent(compact);
  const suggestUrl =
    `https://watchfactory.in/search/suggest.json?q=${q}` +
    `&resources[type]=product&resources[limit]=8`;
  try {
    const res = await fetch(suggestUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const products = body?.resources?.results?.products || [];
    const handles = [];
    const needle = compact.toLowerCase();
    for (const p of products) {
      const handle = String(p.handle || "")
        .trim()
        .toLowerCase();
      const hay = `${p.handle || ""} ${p.title || ""} ${p.url || ""}`.toLowerCase();
      if (!handle) continue;
      if (hay.includes(needle) || handle.includes(needle.replace(/^th/, ""))) {
        handles.push(handle);
      }
    }
    // If SKU-tight filter empty, still try first suggest hit
    if (!handles.length && products[0]?.handle) {
      handles.push(String(products[0].handle).toLowerCase());
    }
    return [...new Set(handles)];
  } catch (err) {
    console.warn(`  watchfactory suggest: ${err.message}`);
    return [];
  }
}

async function recoverWatchFactoryImages(sku) {
  const compact = compactSku(sku).toLowerCase();
  const bare = compact.replace(/^th/, "");
  const handles = [
    ...(await watchFactoryHandlesFromSuggest(sku)),
    `tommy-hilfiger-men-luca-${compact}`,
    `tommy-hilfiger-men-luca-th${bare}`,
    `tommy-hilfiger-${compact}`,
    `tommy-hilfiger-th${bare}`,
    compact,
  ];
  for (const handle of [...new Set(handles.filter(Boolean))]) {
    try {
      const body = await fetchWatchFactoryProductJson(handle);
      const imgs = (body?.product?.images || [])
        .map((i) => (typeof i === "string" ? i : i?.src))
        .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
      if (!imgs.length) {
        console.warn(`  watchfactory ${handle}: no images in JSON`);
        continue;
      }
      const { usable } = await filterUsableImageUrls(imgs);
      console.log(
        `  watchfactory ${handle}: ${imgs.length} raw → ${usable.length} usable`
      );
      if (usable.length) {
        return {
          images: usable,
          source: `watchfactory:${handle}`,
          title: body?.product?.title || null,
        };
      }
    } catch (err) {
      console.warn(`  watchfactory ${handle}: ${err.message}`);
    }
  }
  return { images: [], source: null };
}

async function recoverViaRetailer(sku, brand) {
  try {
    const { product } = await enrichFromRetailerChain(sku, {
      brandHint: brand || "Watch",
      preset: "luxury",
      log: false,
      timeoutMs: 18000,
    });
    if (product?.status === "ok" && Array.isArray(product.images)) {
      const { usable } = await filterUsableImageUrls(product.images);
      if (usable.length) {
        return {
          images: usable,
          source: `retailer:${product.source || "chain"}`,
        };
      }
    }
  } catch (err) {
    return { images: [], source: null, reason: err.message };
  }
  return { images: [], source: null };
}

async function recoverViaBrandEnricher(sku, brand) {
  const key = String(brand || "")
    .trim()
    .toLowerCase();
  try {
    if (key === "titan") {
      const { enrichSku } = require("./brands/titan");
      const scraped = await enrichSku(sku, { delayMs: 600, log: false });
      if (scraped?.status === "ok" && scraped.images?.length) {
        const { usable } = await filterUsableImageUrls(scraped.images);
        if (usable.length) {
          return {
            images: usable,
            source: `enrich:${scraped.source || "titan"}`,
          };
        }
      }
    }
  } catch (err) {
    return { images: [], source: null, reason: err.message };
  }
  return { images: [], source: null };
}

async function migrateOrKeep(images, label) {
  const { usable } = await filterUsableImageUrls(images);
  if (!usable.length) {
    return { images: [], source: label, reason: "no_usable" };
  }
  try {
    const migrated = await migrateUrlsToDoSpaces(usable);
    const spaces = (migrated || []).filter(
      (u) => typeof u === "string" && u.includes("digitaloceanspaces.com")
    );
    const verified = [];
    for (const u of spaces) {
      const pr = await probeImageUrl(u, { timeoutMs: 12000 });
      if (pr.ok) verified.push(u);
    }
    if (verified.length) {
      return { images: verified, source: `${label}→spaces` };
    }
  } catch (err) {
    console.warn(`  spaces migrate failed (${label}): ${err.message}`);
  }
  return { images: usable, source: `${label}-live` };
}

async function resolveReplacement(product) {
  const sku = product.sku;
  const brand = String(product.brand || "");
  const brandLower = brand.toLowerCase();
  const hostBlob = JSON.stringify(product.images || []);

  if (brandLower === "titan") {
    const cat = await recoverTitanImages(sku);
    if (cat.images.length) return migrateOrKeep(cat.images, cat.source);
    const en = await recoverViaBrandEnricher(sku, brand);
    if (en.images.length) return migrateOrKeep(en.images, en.source);
  }

  // Helios CDN is hotlink/bot blocked (403) for Node + many browsers → prefer WF
  if (
    /tommy|hilfiger|helios/i.test(brand) ||
    /helioswatchstore/i.test(hostBlob) ||
    /guess|cavalli|boss|movado|cerruti|citizen/i.test(brand)
  ) {
    const wf = await recoverWatchFactoryImages(sku);
    if (wf.images.length) return migrateOrKeep(wf.images, wf.source);
  }

  // Enrichable fashion/luxury brands: retailer chain (JIT / Tata / Collective…)
  const retail = await recoverViaRetailer(sku, brand);
  if (retail.images.length) return migrateOrKeep(retail.images, retail.source);

  // Last resort for anything else: Watch Factory suggest
  if (!/titan/i.test(brand)) {
    const wf = await recoverWatchFactoryImages(sku);
    if (wf.images.length) return migrateOrKeep(wf.images, wf.source);
  }

  // Keep any still-live slots; drop the rest
  const { usable } = await filterUsableImageUrls(product.images || []);
  if (usable.length) {
    return migrateOrKeep(usable, "kept-live-slots");
  }
  return { images: [], source: null, reason: "unrecoverable" };
}

function isReadyCandidate(p) {
  const title = String(p.title || "").trim();
  const imgs = Array.isArray(p.images) ? p.images.filter((u) => typeof u === "string" && u.trim()) : [];
  return Boolean(title) && imgs.length > 0 && !p.isPublished;
}

async function main() {
  ensureOutDir();
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI missing in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("mongo_host", mongoose.connection.host);
  console.log({ dryRun, auditOnly, skuFilter, limit });

  const priority = ["95375WM01", "TH1710494"];
  const query = skuFilter
    ? { sku: { $in: skuFilter.map((s) => new RegExp(`^${s}$`, "i")) } }
    : {
        isPublished: { $ne: true },
        title: { $exists: true, $nin: [null, ""] },
        "images.0": { $exists: true },
      };

  let products = await Product.find(query)
    .select("sku brand title images isPublished inventory")
    .lean();

  // Always include priority SKUs even if published / filtered out
  if (!skuFilter) {
    const pri = await Product.find({
      sku: { $in: priority.map((s) => new RegExp(`^${s}$`, "i")) },
    })
      .select("sku brand title images isPublished inventory")
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    for (const p of pri) byId.set(String(p._id), p);
    products = [...byId.values()];
  }

  products.sort((a, b) => {
    const pa = priority.includes(compactSku(a.sku)) ? 0 : 1;
    const pb = priority.includes(compactSku(b.sku)) ? 0 : 1;
    return pa - pb || String(a.sku).localeCompare(String(b.sku));
  });

  const audit = [];
  const bad = [];

  console.log(`Probing galleries for ${products.length} products…`);
  let probed = 0;
  for (const p of products) {
    if (!skuFilter && !priority.includes(compactSku(p.sku)) && probed >= limit) {
      // Still finish priority; skip rest once limit hit on non-priority
      continue;
    }
    if (!skuFilter && !priority.includes(compactSku(p.sku))) probed += 1;

    const gallery = await classifyGallery(p.images);
    const row = {
      sku: p.sku,
      brand: p.brand,
      title: (p.title || "").slice(0, 80),
      isPublished: !!p.isPublished,
      readyCandidate: isReadyCandidate(p),
      imageCount: gallery.imageCount,
      real: gallery.real,
      broken: gallery.broken,
      placeholder: gallery.placeholder,
      bad: gallery.bad,
      firstUrl: (p.images || [])[0] || "",
    };
    audit.push(row);
    process.stderr.write(gallery.bad ? "X" : ".");
    if (gallery.bad) bad.push({ product: p, gallery, row });
  }
  process.stderr.write("\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "audit.json"),
    JSON.stringify({ at: new Date().toISOString(), audit, badCount: bad.length }, null, 2)
  );
  console.log(
    `Audit: ${audit.length} probed, ${bad.length} bad galleries → ${OUT_DIR}/audit.json`
  );

  if (auditOnly) {
    await mongoose.disconnect();
    return;
  }

  const results = [];
  let fixed = 0;
  let cleared = 0;
  let failed = 0;

  for (const item of bad) {
    const { product } = item;
    console.log(
      `\n→ ${product.brand} ${product.sku} (${item.gallery.broken} broken / ${item.gallery.imageCount} slots)`
    );
    const replacement = await resolveReplacement(product);
    if (!replacement.images.length) {
      console.log(`  unrecoverable — clearing dead images[]`);
      if (!dryRun) {
        await Product.updateOne(
          { _id: product._id },
          { $set: { images: [] } }
        );
      }
      cleared += 1;
      results.push({
        sku: product.sku,
        brand: product.brand,
        action: "cleared",
        reason: replacement.reason || "unrecoverable",
      });
      continue;
    }

    console.log(
      `  → ${replacement.images.length} image(s) via ${replacement.source}`
    );
    if (!dryRun) {
      await Product.updateOne(
        { _id: product._id },
        { $set: { images: replacement.images } }
      );
    }
    fixed += 1;
    results.push({
      sku: product.sku,
      brand: product.brand,
      action: "replaced",
      source: replacement.source,
      count: replacement.images.length,
      images: replacement.images,
    });
    await sleep(200);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "results.json"),
    JSON.stringify(
      { at: new Date().toISOString(), dryRun, fixed, cleared, failed, results },
      null,
      2
    )
  );

  console.log("\n=== SUMMARY ===");
  console.log({ fixed, cleared, failed, dryRun, out: OUT_DIR });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
