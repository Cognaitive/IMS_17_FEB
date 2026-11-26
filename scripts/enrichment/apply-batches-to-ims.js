#!/usr/bin/env node
"use strict";

/**
 * Staff-wins fill-empty: apply ok enrichment batch products into IMS Mongo
 * for matching unpublished SKUs so New Listings can show title/images for
 * staff "Approve & go live" confirm.
 *
 * NEVER auto-publishes (scrape ≠ approve). Use --publish only if intentionally
 * going live without per-SKU confirm.
 *
 *   node scripts/enrichment/apply-batches-to-ims.js
 *   node scripts/enrichment/apply-batches-to-ims.js --dry-run
 *   node scripts/enrichment/apply-batches-to-ims.js --brand michael-kors
 *   node scripts/enrichment/apply-batches-to-ims.js --include-published
 *
 * Reads MONGODB_URI from backend/.env (never prints it).
 */

const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const ROOT = path.join(__dirname, "../..");
const BACKEND_ROOT = path.join(ROOT, "backend");
const OUTPUT_ROOT = path.join(__dirname, "output");
const backendRequire = createRequire(path.join(BACKEND_ROOT, "package.json"));

backendRequire("dotenv").config({ path: path.join(BACKEND_ROOT, ".env") });

const mongoose = backendRequire("mongoose");
const { Product } = backendRequire("./models/Product");
const { generateProductSlug } = backendRequire("./utils/slugify");
const {
  mergeProductFields,
  scrapedToIncoming,
} = require("./lib/merge");
const { normalizeGender } = require("./lib/gender");

let migrateUrlsToDoSpacesInBackground = null;
try {
  ({ migrateUrlsToDoSpacesInBackground } = backendRequire(
    "./utils/doSpacesImageMigrator"
  ));
} catch {
  /* optional */
}

const dryRun = process.argv.includes("--dry-run");
const includePublished = process.argv.includes("--include-published");
const doPublish = process.argv.includes("--publish");
const brandArgIdx = process.argv.indexOf("--brand");
const brandFilter =
  brandArgIdx >= 0 && process.argv[brandArgIdx + 1]
    ? String(process.argv[brandArgIdx + 1]).toLowerCase()
    : null;

/** Primary + recover dirs per brand (later dirs overlay earlier ok records). */
const BRAND_BATCHES = [
  {
    id: "balmain",
    brandRe: /^balmain$/i,
    dirs: ["balmain-batch", "balmain-batch-archived"],
  },
  { id: "titan", brandRe: /^titan$/i, dirs: ["titan-batch"] },
  { id: "timex", brandRe: /^timex$/i, dirs: ["timex-batch"] },
  { id: "tissot", brandRe: /^tissot$/i, dirs: ["tissot-batch"] },
  {
    id: "seiko",
    brandRe: /^seiko$/i,
    dirs: ["seiko-batch"],
  },
  {
    id: "longines",
    brandRe: /^longines$/i,
    dirs: ["longines-batch", "longines-tgtluxe-recover"],
  },
  {
    id: "rado",
    brandRe: /^rado$/i,
    dirs: ["rado-batch", "rado-recover-tatacliq-ethos"],
  },
  {
    id: "emporio-armani",
    brandRe: /^emporio\s*armani$/i,
    dirs: [
      "emporio-armani-batch",
      "emporio-armani-recover-tatacliq-ethos",
    ],
  },
  {
    id: "armani-exchange",
    brandRe: /^(armani\s*exchange|ax)$/i,
    dirs: [
      "armani-exchange-batch",
      "armani-exchange-recover-tatacliq-ethos",
    ],
  },
  {
    id: "earnshaw",
    brandRe: /^(earnshaw|thomas\s*earnshaw)$/i,
    dirs: ["earnshaw-batch", "earnshaw-recover-typo-ll"],
  },
  {
    id: "alexandre-christie",
    brandRe: /^(alexandre|alexandra)\s*christie$/i,
    dirs: ["alexandre-christie-batch"],
  },
  {
    id: "michael-kors",
    brandRe: /^(michael\s*kors|mk)$/i,
    dirs: ["michael-kors-batch"],
  },
  {
    id: "fossil",
    brandRe: /^fossil$/i,
    dirs: ["fossil-proof"],
  },
  {
    id: "casio",
    brandRe: /^casio$/i,
    dirs: ["casio-proof"],
  },
];

const brandModules = {};
for (const b of BRAND_BATCHES) {
  const modPath = path.join(__dirname, "brands", `${b.id}.js`);
  if (fs.existsSync(modPath)) {
    try {
      brandModules[b.id] = require(modPath);
    } catch {
      /* optional */
    }
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

function skuKey(brandId, raw) {
  const mod = brandModules[brandId];
  if (mod && typeof mod.normalizeSku === "function") {
    try {
      const n = mod.normalizeSku(raw);
      if (n?.compact) return compactSku(n.compact);
      if (n?.ims) return compactSku(n.ims);
      if (n?.style) return compactSku(n.style);
      if (n?.official) return compactSku(n.official);
    } catch {
      /* fall through */
    }
  }
  return compactSku(raw);
}

function prepareIncoming(scraped, defaultBrand) {
  const rawGender =
    scraped?.rawAttributes?.gender ||
    scraped?.rawAttributes?.Gender ||
    scraped?.extras?.gender ||
    scraped?.gender ||
    "";
  const genderInfo = normalizeGender(rawGender);
  const incoming = scrapedToIncoming(scraped);
  delete incoming._fieldMapped;
  delete incoming._fieldUnmapped;

  if (!incoming.brand && defaultBrand) incoming.brand = defaultBrand;

  if (genderInfo.unknown) {
    incoming.gender = "";
  } else if (genderInfo.value) {
    incoming.gender = genderInfo.value;
  } else {
    delete incoming.gender;
  }
  if (incoming.price == null) delete incoming.price;
  if (incoming.oldPrice == null) delete incoming.oldPrice;
  return { incoming, genderInfo };
}

function loadOkBySku(dirs) {
  const byKey = new Map();
  const sources = [];
  for (const dir of dirs) {
    const filePath = path.join(OUTPUT_ROOT, dir, "products.json");
    if (!fs.existsSync(filePath)) continue;
    sources.push(path.relative(ROOT, filePath));
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.products || [];
    for (const p of list) {
      if (!p || p.status !== "ok" || !p.sku) continue;
      const key = compactSku(p.sku);
      if (!key) continue;
      // Later dirs (recover) win for same SKU
      byKey.set(key, p);
      if (p.officialSku) byKey.set(compactSku(p.officialSku), p);
      if (p.imsSku) byKey.set(compactSku(p.imsSku), p);
    }
  }
  // Deduplicate by identity of product object
  const unique = [];
  const seen = new Set();
  for (const p of byKey.values()) {
    const id = `${compactSku(p.sku)}::${p.title || ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(p);
  }
  return { products: unique, sources };
}

async function findProduct(brandCfg, scraped) {
  const sku = String(scraped.sku || "").trim();
  const alts = [
    sku,
    scraped.officialSku,
    scraped.imsSku,
    scraped.styleCode,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim());

  for (const candidate of alts) {
    const direct = await Product.findOne({
      sku: new RegExp(`^${escapeRegex(candidate)}$`, "i"),
    });
    if (direct) {
      if (!includePublished && direct.isPublished === true) return null;
      return direct;
    }
  }

  const keys = new Set(alts.map((a) => skuKey(brandCfg.id, a)).filter(Boolean));
  const candidates = await Product.find({ brand: brandCfg.brandRe }).select(
    "_id sku isPublished"
  );
  const hit = candidates.find((p) => {
    const k = skuKey(brandCfg.id, p.sku);
    return keys.has(k);
  });
  if (!hit) return null;
  if (!includePublished && hit.isPublished === true) return null;
  return Product.findById(hit._id);
}

async function applyBrand(brandCfg) {
  const { products, sources } = loadOkBySku(brandCfg.dirs);
  const summary = {
    brand: brandCfg.id,
    sources,
    okInBatch: products.length,
    matched: 0,
    updated: 0,
    noOp: 0,
    skippedPublished: 0,
    missing: [],
    errors: [],
    fillTotals: {},
  };

  if (products.length === 0) {
    summary.note = "no ok products in batch dirs";
    return summary;
  }

  const defaultBrand =
    products[0]?.brand ||
    brandCfg.id
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  for (const scraped of products) {
    const sku = String(scraped.sku).trim();
    try {
      const doc = await findProduct(brandCfg, scraped);
      if (!doc) {
        // Distinguish published-skip vs truly missing
        const any = await Product.findOne({
          sku: new RegExp(`^${escapeRegex(sku)}$`, "i"),
        }).select("_id isPublished sku");
        if (any && any.isPublished === true && !includePublished) {
          summary.skippedPublished += 1;
        } else {
          summary.missing.push(sku);
        }
        continue;
      }

      summary.matched += 1;
      const { incoming } = prepareIncoming(scraped, defaultBrand);
      const existing = doc.toObject();
      const merge = mergeProductFields(existing, incoming, {
        forceOverwrite: false,
      });
      delete merge.patch.isPublished;

      if (
        (!existing.slug || !String(existing.slug).trim()) &&
        !merge.patch.slug
      ) {
        const brand = merge.patch.brand || existing.brand;
        const skuVal = merge.patch.sku || existing.sku;
        if (brand && skuVal) {
          merge.patch.slug = generateProductSlug(brand, skuVal);
          if (!merge.fill.includes("slug")) merge.fill.push("slug");
        }
      }

      if (doPublish) {
        const title =
          merge.patch.title || existing.title || "";
        const imgs =
          merge.patch.images ||
          existing.images ||
          [];
        const hasImg =
          (Array.isArray(imgs) && imgs.length > 0) ||
          Boolean(existing.imageUrl);
        if (String(title).trim() && hasImg && existing.isPublished !== true) {
          merge.patch.isPublished = true;
          if (!merge.fill.includes("isPublished")) {
            merge.fill.push("isPublished");
          }
        }
      }

      if (Object.keys(merge.patch).length === 0) {
        summary.noOp += 1;
        continue;
      }

      for (const f of merge.fill) {
        summary.fillTotals[f] = (summary.fillTotals[f] || 0) + 1;
      }

      if (dryRun) {
        summary.updated += 1;
        console.log(
          `  [${brandCfg.id}] ${sku}: DRY fill [${merge.fill.join(", ")}]`
        );
        continue;
      }

      const updated = await Product.findByIdAndUpdate(
        doc._id,
        { $set: merge.patch },
        { new: true, runValidators: true }
      );
      summary.updated += 1;
      if (
        migrateUrlsToDoSpacesInBackground &&
        merge.patch.images &&
        Array.isArray(merge.patch.images) &&
        merge.patch.images.length > 0
      ) {
        migrateUrlsToDoSpacesInBackground(updated._id, merge.patch.images);
      }
      console.log(
        `  [${brandCfg.id}] ${sku}: filled ${merge.fill.length} [${merge.fill.join(", ")}]`
      );
    } catch (err) {
      summary.errors.push({ sku, message: err.message || String(err) });
      console.error(`  [${brandCfg.id}] ${sku}: ERROR ${err.message}`);
    }
  }

  return summary;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI missing in backend/.env");
    process.exit(1);
  }

  const brands = BRAND_BATCHES.filter(
    (b) => !brandFilter || b.id === brandFilter || b.id.includes(brandFilter)
  );

  console.log(
    JSON.stringify({
      dryRun,
      includePublished,
      publish: doPublish,
      brands: brands.map((b) => b.id),
      policy: "staff-wins-fill-empty; unpublished only; no auto-publish",
    })
  );

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("mongo_host", mongoose.connection.host);

  const perBrand = [];
  for (const brandCfg of brands) {
    console.log(`\n=== ${brandCfg.id} ===`);
    const summary = await applyBrand(brandCfg);
    perBrand.push(summary);
    console.log(
      JSON.stringify({
        brand: summary.brand,
        okInBatch: summary.okInBatch,
        matched: summary.matched,
        updated: summary.updated,
        noOp: summary.noOp,
        skippedPublished: summary.skippedPublished,
        missing: summary.missing.length,
        errors: summary.errors.length,
      })
    );
  }

  await mongoose.disconnect();

  const totals = perBrand.reduce(
    (acc, s) => {
      acc.okInBatch += s.okInBatch;
      acc.matched += s.matched;
      acc.updated += s.updated;
      acc.noOp += s.noOp;
      acc.skippedPublished += s.skippedPublished;
      acc.missing += s.missing.length;
      acc.errors += s.errors.length;
      return acc;
    },
    {
      okInBatch: 0,
      matched: 0,
      updated: 0,
      noOp: 0,
      skippedPublished: 0,
      missing: 0,
      errors: 0,
    }
  );

  console.log("\n=== TOTALS ===");
  console.log(JSON.stringify({ totals, perBrand }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
