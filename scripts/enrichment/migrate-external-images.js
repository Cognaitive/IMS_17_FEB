#!/usr/bin/env node
"use strict";

/**
 * Migrate product images[] / seoImage off external hosts onto DO Spaces.
 *
 * Priority (default):
 *   1. published + brand=Casio
 *   2. published + inventory>0
 *   3. remaining published
 *   4. unpublished with inventory>0 (only with --include-unpublished)
 *
 *   node scripts/enrichment/migrate-external-images.js --published-only --concurrency 4
 *   node scripts/enrichment/migrate-external-images.js --brand Casio --published-only
 *   node scripts/enrichment/migrate-external-images.js --skus A1793,ED676
 *   node scripts/enrichment/migrate-external-images.js --audit-only
 *   node scripts/enrichment/migrate-external-images.js --resume
 *   node scripts/enrichment/migrate-external-images.js --resume --retry-failed
 *
 * Optional proxy (Helios CDN / bot-blocked hosts): set IMAGE_MIGRATE_PROXY
 * (or HTTPS_PROXY / HTTP_PROXY) to an http(s) proxy URL. Restart migrate
 * (or run a parallel --retry-failed) after setting — env is read at process start.
 */

const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const CANDIDATE_BACKENDS = [
  path.join(__dirname, "../.."),
  path.join(__dirname, "../../backend"),
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
backendRequire("./models/Brand");
const { Product } = backendRequire("./models/Product");
const { uploadUrlToSpaces } = backendRequire("./utils/doSpacesImageMigrator");
const { probeImageUrl, filterUsableImageUrls } = require("./lib/imageProbe");
const { filterRetailerBrandingUrls } = require("./lib/retailerImageHygiene");
const { sleep } = require("./lib/http");
const {
  isImageMigrateProxyConfigured,
  proxiedGet,
} = require("./lib/migrateProxy");

/** Sequential Spaces upload — safer under product concurrency than Promise.all-all-images */
async function migrateUrlsSequential(images) {
  const out = [];
  for (const img of images || []) {
    try {
      const u = await uploadUrlToSpaces(img);
      if (u && isOurs(u)) out.push(u);
    } catch (err) {
      console.warn(`  upload fail: ${err.message}`);
    }
    await sleep(40);
  }
  return out;
}

const OUT_DIR = path.join(__dirname, "output/external-image-migrate");
const PROGRESS_PATH = path.join(OUT_DIR, "progress.jsonl");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.json");

function parseArgs(argv) {
  const args = {
    publishedOnly: false,
    includeUnpublished: false,
    brand: null,
    skus: null,
    limit: null,
    concurrency: 3,
    auditOnly: false,
    resume: false,
    dryRun: false,
    recover: true,
    retryFailed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--published-only") args.publishedOnly = true;
    else if (a === "--include-unpublished") args.includeUnpublished = true;
    else if (a === "--brand") args.brand = argv[++i];
    else if (a === "--skus")
      args.skus = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 0) || null;
    else if (a === "--concurrency")
      args.concurrency = Math.max(1, Math.min(8, Number(argv[++i]) || 3));
    else if (a === "--audit-only") args.auditOnly = true;
    else if (a === "--resume") args.resume = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-recover") args.recover = false;
    else if (a === "--retry-failed") args.retryFailed = true;
  }
  return args;
}

function isOurs(u) {
  if (typeof u !== "string" || !u.trim()) return true;
  if (!/^https?:\/\//i.test(u)) return true;
  return /digitaloceanspaces\.com/i.test(u) || /samaywatch\.(in|com)/i.test(u);
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "(bad)";
  }
}

function hasExternal(p) {
  const urls = [...(p.images || []), p.seoImage].filter(
    (u) => typeof u === "string" && u.trim()
  );
  return urls.some((u) => !isOurs(u));
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function appendProgress(row) {
  fs.appendFileSync(PROGRESS_PATH, JSON.stringify(row) + "\n");
}

function loadDoneSkus(opts = {}) {
  if (!fs.existsSync(PROGRESS_PATH)) return new Set();
  const done = new Set();
  const retryFailed = !!opts.retryFailed;
  for (const line of fs.readFileSync(PROGRESS_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row || !row.sku) continue;
      const sku = String(row.sku).toUpperCase();
      // Success always counts as done.
      if (row.ok || row.action === "skipped_ours") {
        done.add(sku);
        continue;
      }
      // On resume, also skip already-attempted failures so Helios dead-ends
      // don't monopolize the front of every restart (use --retry-failed to requeue).
      if (!retryFailed && row.action) {
        done.add(sku);
      }
    } catch {
      /* ignore */
    }
  }
  return done;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function recoverWatchFactory(sku) {
  const compact = String(sku || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
  if (!compact) return [];
  const suggestUrl =
    `https://watchfactory.in/search/suggest.json?q=${encodeURIComponent(compact)}` +
    `&resources[type]=product&resources[limit]=6`;
  const jsonHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    Accept: "application/json",
  };
  async function getJson(url, timeoutMs) {
    const viaProxy = await proxiedGet(url, {
      timeoutMs,
      headers: jsonHeaders,
      responseType: "text",
    });
    if (viaProxy) {
      if (!viaProxy.ok) return null;
      try {
        return JSON.parse(viaProxy.text || "");
      } catch {
        return null;
      }
    }
    const res = await fetch(url, {
      headers: jsonHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return res.json();
  }
  try {
    const body = await getJson(suggestUrl, 15000);
    if (!body) return [];
    const products = body?.resources?.results?.products || [];
    for (const p of products) {
      const handle = String(p.handle || "").trim();
      if (!handle) continue;
      const jsonUrl = `https://watchfactory.in/products/${handle}.json`;
      const j = await getJson(jsonUrl, 20000);
      if (!j) continue;
      const imgs = (j?.product?.images || [])
        .map((i) => (typeof i === "string" ? i : i?.src))
        .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
      if (imgs.length) {
        const { usable } = await filterUsableImageUrls(imgs);
        if (usable.length) return usable;
      }
    }
  } catch {
    return [];
  }
  return [];
}

async function recoverRetailer(sku, brand) {
  try {
    const { enrichFromRetailerChain } = require("./lib/retailerFallback");
    const { product } = await enrichFromRetailerChain(sku, {
      brandHint: brand || "Watch",
      preset: "luxury",
      log: false,
      timeoutMs: 16000,
    });
    if (product?.status === "ok" && Array.isArray(product.images)) {
      // Don't sharp-probe here — migrate/upload validates
      return product.images.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
    }
  } catch {
    return [];
  }
  return [];
}

const TITAN_CATALOG =
  "https://www.titan.co.in/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog";

function titanStyles(sku) {
  const raw = String(sku || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
  const bare = raw.replace(/^NU/i, "").replace(/^NT/i, "");
  if (!bare) return [];
  const out = [bare, raw];
  if (!bare.endsWith("F")) out.push(`${bare}F`);
  return [...new Set(out)];
}

async function recoverTitanCatalog(sku) {
  for (const style of titanStyles(sku)) {
    const urls = [];
    for (let i = 1; i <= 6; i++) {
      const url = `${TITAN_CATALOG}/${style}_${i}.jpg`;
      const pr = await probeImageUrl(url, { timeoutMs: 8000 });
      if (pr.ok) urls.push(url);
      else if (i === 1) break;
    }
    if (urls.length) return urls;
  }
  return [];
}

/** Helios CDN is hotlink-blocked (403) — never download; recover alternate sources */
async function recoverBlockedGallery(product) {
  const brand = String(product.brand || "").toLowerCase();
  const sku = product.sku;
  const steps = [];

  if (brand === "titan") {
    const titan = await recoverTitanCatalog(sku);
    if (titan.length) return { images: titan, source: "titan-catalog" };
    steps.push("titan-miss");
  }

  const wf = await recoverWatchFactory(sku);
  if (wf.length) return { images: wf, source: "watchfactory" };
  steps.push("wf-miss");

  const retail = await recoverRetailer(sku, product.brand);
  if (retail.length) return { images: retail, source: "retailer" };
  steps.push("retail-miss");

  return { images: [], source: null, steps };
}

async function migrateProduct(product, opts) {
  const before = [...(product.images || [])];
  const beforeSeo = product.seoImage || "";
  const beforeHosts = [
    ...new Set(
      [...before, beforeSeo]
        .filter((u) => typeof u === "string" && !isOurs(u))
        .map(hostOf)
    ),
  ];

  // Keep ours + try migrate externals directly (no full-gallery probe — avoids sharp crashes)
  const ours = before.filter((u) => typeof u === "string" && isOurs(u) && /^https?:/i.test(u));
  const external = before.filter((u) => typeof u === "string" && u.trim() && !isOurs(u));
  let candidate = external.length ? external : before.filter((u) => typeof u === "string" && u.trim());
  // Hard gate: never migrate / reintroduce retailer certificate branding slides
  candidate = filterRetailerBrandingUrls(candidate).kept;
  let source = "direct";

  const blocked =
    /helioswatchstore/i.test(beforeHosts.join(" ")) ||
    /helios/i.test(String(product.brand || ""));

  // Helios / known-blocked: recover FIRST — skip bare 403 downloads unless a
  // migrate proxy is configured (IMAGE_MIGRATE_PROXY / HTTPS_PROXY).
  if (opts.recover && blocked) {
    const rec = await recoverBlockedGallery(product);
    if (rec.images.length) {
      candidate = filterRetailerBrandingUrls(rec.images).kept;
      source = rec.source;
    } else if (isImageMigrateProxyConfigured() && external.length) {
      candidate = external;
      source = "helios-via-proxy";
    } else {
      candidate = []; // do not attempt Helios URLs without proxy
      source = `blocked-unrecovered:${(rec.steps || []).join(",")}`;
    }
  }

  if (opts.dryRun) {
    return {
      ok: true,
      action: "dry-run",
      sku: product.sku,
      brand: product.brand,
      source,
      beforeHosts,
      before0: before[0] || "",
      after0: candidate[0] || "",
      count: candidate.length,
    };
  }

  let migrated = [];
  if (candidate.length) {
    migrated = (await migrateUrlsSequential(candidate)).filter(
      (u) => typeof u === "string" && u.trim() && isOurs(u)
    );
  }
  // Preserve any already-ours images at front
  if (ours.length) {
    migrated = [...ours.filter((u) => !migrated.includes(u)), ...migrated];
  }

  // If migrate failed (403/dead) and not already through full recover — try recover chain
  const onlyOurs = migrated.length > 0 && migrated.every((u) => ours.includes(u));
  if ((!migrated.length || onlyOurs) && external.length && opts.recover && !blocked) {
    const rec = await recoverBlockedGallery(product);
    if (rec.images.length) {
      source = `${rec.source}-retry`;
      const recovered = filterRetailerBrandingUrls(rec.images).kept;
      const more = (await migrateUrlsSequential(recovered)).filter(
        (u) => typeof u === "string" && isOurs(u)
      );
      migrated = [...ours, ...more];
    }
  }

  migrated = [...new Set(migrated.filter((u) => typeof u === "string" && isOurs(u)))];

  if (!migrated.length) {
    return {
      ok: false,
      action: "migrate_failed",
      sku: product.sku,
      brand: product.brand,
      beforeHosts,
      before0: before[0] || "",
      source,
    };
  }

  // Quick verify first URL
  const probe = await probeImageUrl(migrated[0], { timeoutMs: 10000 });
  if (!probe.ok) {
    return {
      ok: false,
      action: "spaces_unverified",
      sku: product.sku,
      brand: product.brand,
      beforeHosts,
      after0: migrated[0],
      probe,
    };
  }

  const seoImage = migrated[0];
  await Product.updateOne(
    { _id: product._id },
    { $set: { images: migrated, seoImage } }
  );

  return {
    ok: true,
    action: "migrated",
    sku: product.sku,
    brand: product.brand,
    source,
    beforeHosts,
    before0: before[0] || "",
    after0: migrated[0],
    count: migrated.length,
    published: !!product.isPublished,
    inventory: product.inventory,
  };
}

function priorityScore(p) {
  const brand = String(p.brand || "").toLowerCase();
  let score = 0;
  if (p.isPublished) score += 1000;
  if ((p.inventory || 0) > 0) score += 100;
  if (brand === "casio") score += 50;
  // Hotlink-blocked hosts first
  const blob = JSON.stringify(p.images || []);
  if (/helioswatchstore|tissotwatches|casio\.com/i.test(blob)) score += 30;
  return -score; // sort ascending → higher priority first
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureOutDir();
  // Survive parent-shell abort / nohup HUP so durable runs keep migrating.
  try {
    process.on("SIGHUP", () => {
      console.warn("SIGHUP ignored — migrate continues");
    });
  } catch {
    /* ignore */
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI missing");
    process.exit(1);
  }
  if (!process.env.DO_SPACES_KEY) {
    console.error("DO Spaces env missing");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const proxyOn = isImageMigrateProxyConfigured();
  console.log(
    "mongo",
    mongoose.connection.host,
    args,
    `imageProxy=${proxyOn ? "yes" : "no (set IMAGE_MIGRATE_PROXY or HTTPS_PROXY)"}`
  );

  const query = {};
  if (args.skus) {
    query.sku = {
      $in: args.skus.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")),
    };
  } else {
    if (args.publishedOnly && !args.includeUnpublished) {
      query.isPublished = true;
    } else if (!args.includeUnpublished && !args.publishedOnly) {
      // default: published OR in-stock unpublished
      query.$or = [{ isPublished: true }, { inventory: { $gt: 0 } }];
    }
    if (args.brand) {
      query.brand = new RegExp(`^${args.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    query["images.0"] = { $exists: true };
  }

  let products = await Product.find(query)
    .select("sku brand title images seoImage isPublished inventory")
    .lean();

  products = products.filter(hasExternal);
  products.sort((a, b) => priorityScore(a) - priorityScore(b) || String(a.sku).localeCompare(String(b.sku)));

  if (args.resume) {
    const done = loadDoneSkus({ retryFailed: args.retryFailed });
    const before = products.length;
    // Also skip if Mongo already fully on Spaces (progress lost mid-crash)
    products = products.filter((p) => {
      if (done.has(String(p.sku).toUpperCase())) return false;
      if (!hasExternal(p)) return false;
      return true;
    });
    console.log(
      `resume: progressFile=${done.size} skus; skip ${before - products.length} already attempted` +
        (args.retryFailed ? " (--retry-failed)" : " (ok+failed; --retry-failed to requeue)")
    );
  }
  if (args.limit) products = products.slice(0, args.limit);

  console.log(`candidates: ${products.length}`);
  if (products.length) {
    const sample = products.slice(0, 5).map((p) => `${p.brand}:${p.sku}`).join(", ");
    console.log(`starting migrate pid=${process.pid} sample=[${sample}]`);
  }

  if (args.auditOnly) {
    const hosts = {};
    const brands = {};
    for (const p of products) {
      for (const u of [...(p.images || []), p.seoImage]) {
        if (!isOurs(u)) hosts[hostOf(u)] = (hosts[hostOf(u)] || 0) + 1;
      }
      const b = p.brand || "?";
      brands[b] = (brands[b] || 0) + 1;
    }
    const audit = {
      at: new Date().toISOString(),
      count: products.length,
      hosts: Object.entries(hosts).sort((a, b) => b[1] - a[1]),
      brands: Object.entries(brands).sort((a, b) => b[1] - a[1]),
      sample: products.slice(0, 30).map((p) => ({
        sku: p.sku,
        brand: p.brand,
        published: !!p.isPublished,
        inventory: p.inventory,
        img0: (p.images || [])[0],
      })),
    };
    fs.writeFileSync(path.join(OUT_DIR, "live-audit.json"), JSON.stringify(audit, null, 2));
    console.log(JSON.stringify({ count: audit.count, topHosts: audit.hosts.slice(0, 15), topBrands: audit.brands.slice(0, 15) }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const stats = {
    ok: 0,
    fail: 0,
    byBrand: {},
    byAction: {},
    casioSamples: [],
  };

  await mapPool(products, args.concurrency, async (p, i) => {
    const label = `[${i + 1}/${products.length}] ${p.brand} ${p.sku}`;
    console.log(`→ ${label}`);
    try {
      const result = await migrateProduct(p, args);
      appendProgress({ at: new Date().toISOString(), ...result });
      const b = p.brand || "?";
      stats.byBrand[b] = stats.byBrand[b] || { ok: 0, fail: 0 };
      stats.byAction[result.action] = (stats.byAction[result.action] || 0) + 1;
      if (result.ok) {
        stats.ok += 1;
        stats.byBrand[b].ok += 1;
        console.log(`✅ ${label} → ${result.count} via ${result.source}`);
        if (/casio/i.test(b) && stats.casioSamples.length < 8) {
          stats.casioSamples.push({
            sku: result.sku,
            before: result.before0,
            after: result.after0,
          });
        }
      } else {
        stats.fail += 1;
        stats.byBrand[b].fail += 1;
        console.warn(`❌ ${label} ${result.action} hosts=${(result.beforeHosts || []).join(",")}`);
      }
    } catch (err) {
      stats.fail += 1;
      appendProgress({
        at: new Date().toISOString(),
        ok: false,
        action: "error",
        sku: p.sku,
        brand: p.brand,
        error: err.message,
      });
      console.warn(`❌ ${label} error: ${err.message}`);
    }
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(
        SUMMARY_PATH,
        JSON.stringify({ at: new Date().toISOString(), ...stats, processed: i + 1, total: products.length }, null, 2)
      );
      console.log(`--- progress ${i + 1}/${products.length} ok=${stats.ok} fail=${stats.fail} ---`);
    }
    await sleep(80);
  });

  const summary = {
    at: new Date().toISOString(),
    args,
    total: products.length,
    ...stats,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log("\n=== DONE ===");
  console.log(JSON.stringify({ ok: stats.ok, fail: stats.fail, byAction: stats.byAction, casioSamples: stats.casioSamples }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
