#!/usr/bin/env node
"use strict";

/**
 * Strip retailer "Certificate of Authenticity" gallery pollution (JIT / etc.)
 * that shows third-party branding (JUST IN TIME, justintime.in, …).
 *
 * Detection:
 *   1. URL/filename heuristics (Certificate, authenticity, …)
 *   2. 8×8 greyscale hashes of known JIT cert templates (raw + Spaces pipeline)
 *
 *   node scripts/enrichment/strip-retailer-certificate-images.js --dry-run
 *   node scripts/enrichment/strip-retailer-certificate-images.js --published-only
 *   node scripts/enrichment/strip-retailer-certificate-images.js --brand Casio --published-only
 *   node scripts/enrichment/strip-retailer-certificate-images.js --skus D205,ED676
 *   node scripts/enrichment/strip-retailer-certificate-images.js --resume
 *
 * Priority default: published first (Casio / JIT-enriched first), then rest.
 * Durable progress under output/retailer-cert-strip/. Never empties a gallery
 * when other non-cert images remain; fixes seoImage if it pointed at a removed slot.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
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
const sharp = backendRequire("sharp");

const OUT_DIR = path.join(__dirname, "output/retailer-cert-strip");
const PROGRESS_PATH = path.join(OUT_DIR, "progress.jsonl");
const HASHES_PATH = path.join(OUT_DIR, "known-hashes.json");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.json");

/** Filename / path tokens that mark retailer authenticity certificates */
const CERT_URL_RE =
  /certificate|authenticity|guaranteed[_-]?authentic|authorised[_-]?seller|authorized[_-]?seller|dkny[_-]?certificate|[_-]cert(?:ificate)?(?:[_-]|$)/i;

/** Soft tokens — used only on the last gallery slot (certs usually last). */
const LAST_SLOT_SOFT_CERT_RE =
  /certificate|authenticity|guaranteed|authori[sz]ed|genuine|trust[_-]?badge|coa(?:[_-]|$)|warranty[_-]?card|dkny[_-]?cert|_cert(?:ificate)?(?:[_-]|$)/i;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    publishedOnly: false,
    includeUnpublished: true,
    brand: null,
    skus: null,
    limit: null,
    resume: false,
    urlOnly: false,
    rebuildHashes: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--published-only") {
      args.publishedOnly = true;
      args.includeUnpublished = false;
    } else if (a === "--include-unpublished") args.includeUnpublished = true;
    else if (a === "--resume") args.resume = true;
    else if (a === "--url-only") args.urlOnly = true;
    else if (a === "--rebuild-hashes") args.rebuildHashes = true;
    else if (a === "--brand") args.brand = argv[++i];
    else if (a === "--skus") {
      args.skus = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 0);
  }
  return args;
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getBuf(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = /^http:/i.test(url) ? http : https;
    const req = lib.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return getBuf(res.headers.location, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function imgHash8(buf) {
  const raw = await sharp(buf, { failOn: "none" })
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  return crypto.createHash("md5").update(raw).digest("hex").slice(0, 12);
}

/** Same sharp pipeline as doSpacesImageMigrator.uploadUrlToSpaces */
async function spacesProcess(buf) {
  return sharp(buf, { failOn: "none" })
    .trim({ threshold: 60 })
    .resize(800, 800, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .webp({ quality: 80 })
    .toBuffer();
}

function collectCertUrlsFromBatches() {
  const root = path.join(__dirname, "output");
  const found = new Set();
  function walk(dir, depth = 0) {
    if (depth > 4 || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name === "products.json" || name === "audit-published.json") {
        try {
          const data = JSON.parse(fs.readFileSync(p, "utf8"));
          const lists = [];
          if (Array.isArray(data)) lists.push(data);
          else {
            for (const k of [
              "products",
              "publishedExternal",
              "casioExternal",
              "candidates",
              "items",
            ]) {
              if (Array.isArray(data[k])) lists.push(data[k]);
            }
          }
          for (const arr of lists) {
            for (const prod of arr) {
              for (const u of prod.images || []) {
                if (CERT_URL_RE.test(String(u))) {
                  found.add(String(u).split("?")[0]);
                }
              }
            }
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  walk(root);
  return [...found];
}

async function buildKnownHashes(opts = {}) {
  if (!opts.rebuild && fs.existsSync(HASHES_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(HASHES_PATH, "utf8"));
      if (Array.isArray(cached.hashes) && cached.hashes.length >= 8) {
        console.log(
          `Loaded ${cached.hashes.length} known cert hashes from ${HASHES_PATH}`
        );
        return new Set(cached.hashes);
      }
    } catch {
      /* rebuild */
    }
  }

  const urls = collectCertUrlsFromBatches();
  console.log(`Building cert hashes from ${urls.length} template URL(s)…`);
  const hashes = new Set();
  let ok = 0;
  for (const u of urls) {
    try {
      const raw = await getBuf(u);
      hashes.add(await imgHash8(raw));
      hashes.add(await imgHash8(await spacesProcess(raw)));
      ok += 1;
      process.stderr.write(".");
    } catch (err) {
      process.stderr.write("x");
      console.warn(`\n  hash fail ${path.basename(u)}: ${err.message}`);
    }
    await sleep(40);
  }
  process.stderr.write("\n");
  const payload = {
    at: new Date().toISOString(),
    templateUrls: urls.length,
    hashedOk: ok,
    hashes: [...hashes],
  };
  fs.writeFileSync(HASHES_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${hashes.size} hashes → ${HASHES_PATH}`);
  return hashes;
}

function isCertUrl(url) {
  return CERT_URL_RE.test(String(url || ""));
}

async function isCertByHash(url, knownHashes, cache) {
  const key = String(url || "").split("?")[0];
  if (cache.has(key)) return cache.get(key);
  try {
    const buf = await getBuf(key);
    const h = await imgHash8(buf);
    const hit = knownHashes.has(h);
    cache.set(key, hit ? h : false);
    return hit ? h : false;
  } catch (err) {
    cache.set(key, false);
    return false;
  }
}

function loadDoneSkus() {
  const done = new Set();
  if (!fs.existsSync(PROGRESS_PATH)) return done;
  for (const line of fs.readFileSync(PROGRESS_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.sku && (row.ok || row.action === "clean")) {
        done.add(compactSku(row.sku));
      }
    } catch {
      /* skip */
    }
  }
  return done;
}

function appendProgress(row) {
  fs.appendFileSync(PROGRESS_PATH, JSON.stringify(row) + "\n");
}

function priorityScore(p) {
  let score = 0;
  if (p.isPublished) score += 1000;
  if (/^casio$/i.test(String(p.brand || ""))) score += 200;
  const blob = [...(p.images || []), p.seoImage].join(" ");
  if (/justintime|shopify.*0692\/8321\/7683|Certificate/i.test(blob)) {
    score += 100;
  }
  if ((p.inventory || 0) > 0) score += 50;
  score += Math.min(20, (p.images || []).length);
  return score;
}

async function cleanProduct(product, opts, knownHashes, hashCache) {
  const before = [...(product.images || [])].filter(
    (u) => typeof u === "string" && u.trim()
  );
  if (!before.length) {
    return { action: "noop", removed: 0, reasons: [] };
  }

  const keep = [];
  const removed = [];
  const reasons = [];

  for (let i = 0; i < before.length; i++) {
    const url = before[i];
    let reason = null;
    const isLast = before.length >= 2 && i === before.length - 1;
    if (isCertUrl(url)) {
      reason = "url_heuristic";
    } else if (isLast && LAST_SLOT_SOFT_CERT_RE.test(String(url || ""))) {
      // Staff insight: retailer cert is usually the last watch gallery image
      reason = "last_slot_soft";
    } else if (!opts.urlOnly) {
      // Prefer hashing last slot (+ prior) + Shopify hosts; Casio: every slot.
      const nearEnd = i >= before.length - 2;
      const casioish = /^casio$/i.test(String(product.brand || ""));
      const shouldHash =
        isLast ||
        nearEnd ||
        casioish ||
        before.length <= 6 ||
        /shopify|justintime/i.test(url);
      if (shouldHash) {
        const h = await isCertByHash(url, knownHashes, hashCache);
        if (h) reason = `hash:${h}`;
      }
    }
    if (reason) {
      removed.push(url);
      reasons.push({ index: i, reason, url: url.slice(0, 160) });
    } else {
      keep.push(url);
    }
  }

  if (!removed.length) {
    // Still fix seoImage if it alone is a cert URL
    if (isCertUrl(product.seoImage) && before.length) {
      const seoImage = before[0];
      if (!opts.dryRun) {
        await Product.updateOne(
          { _id: product._id },
          { $set: { seoImage } }
        );
      }
      return {
        action: "seo_fixed",
        removed: 0,
        reasons: [{ reason: "seo_url_heuristic", url: product.seoImage }],
        images: before,
        seoImage,
      };
    }
    return { action: "clean", removed: 0, reasons: [], images: before };
  }

  // Never leave empty when other good images remain — keep already ensures that.
  // If everything was a cert, gallery becomes [] (correct).
  let seoImage = product.seoImage || "";
  if (
    !seoImage ||
    removed.includes(seoImage) ||
    isCertUrl(seoImage) ||
    !keep.includes(seoImage)
  ) {
    seoImage = keep[0] || "";
  }

  if (!opts.dryRun) {
    await Product.updateOne(
      { _id: product._id },
      { $set: { images: keep, seoImage } }
    );
  }

  return {
    action: "stripped",
    removed: removed.length,
    kept: keep.length,
    reasons,
    images: keep,
    seoImage,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  ensureOutDir();

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI missing in backend/.env");
    process.exit(1);
  }

  const knownHashes = args.urlOnly
    ? new Set()
    : await buildKnownHashes({ rebuild: args.rebuildHashes });

  await mongoose.connect(process.env.MONGODB_URI);

  const filter = {};
  if (args.publishedOnly) filter.isPublished = true;
  if (args.brand) filter.brand = new RegExp(`^${args.brand}$`, "i");
  if (args.skus && args.skus.length) {
    filter.sku = {
      $in: args.skus.map(
        (s) =>
          new RegExp(
            `^${String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          )
      ),
    };
  }

  let products = await Product.find(filter)
    .select("sku brand title images seoImage isPublished inventory")
    .lean();

  products.sort((a, b) => priorityScore(b) - priorityScore(a));

  const done = args.resume ? loadDoneSkus() : new Set();
  if (done.size) {
    products = products.filter((p) => !done.has(compactSku(p.sku)));
    console.log(`Resume: skipping ${done.size} already-processed SKUs`);
  }
  if (args.limit) products = products.slice(0, args.limit);

  console.log(
    `Candidates: ${products.length} (publishedOnly=${args.publishedOnly} urlOnly=${args.urlOnly} dryRun=${args.dryRun})`
  );

  const hashCache = new Map();
  const results = [];
  let strippedProducts = 0;
  let removedImages = 0;
  let clean = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    process.stderr.write(
      `\r[${i + 1}/${products.length}] ${p.brand} ${p.sku}          `
    );
    let result;
    try {
      result = await cleanProduct(p, args, knownHashes, hashCache);
    } catch (err) {
      result = { action: "error", removed: 0, error: err.message };
    }

    const row = {
      at: new Date().toISOString(),
      ok: result.action !== "error",
      action: result.action,
      sku: p.sku,
      brand: p.brand,
      published: !!p.isPublished,
      removed: result.removed || 0,
      kept: result.kept,
      reasons: result.reasons,
      dryRun: args.dryRun,
    };
    appendProgress(row);
    results.push(row);

    if (result.action === "stripped" && result.removed) {
      strippedProducts += 1;
      removedImages += result.removed;
      console.log(
        `\n✓ ${p.isPublished ? "PUB" : "unp"} ${p.brand} ${p.sku}: -${result.removed} (kept ${result.kept}) [${(result.reasons || []).map((r) => r.reason).join(",")}]`
      );
    } else if (result.action === "clean" || result.action === "noop") {
      clean += 1;
    } else if (result.action === "error") {
      console.log(`\n✗ ${p.sku}: ${result.error}`);
    }

    if (!args.urlOnly && i % 20 === 19) await sleep(80);
  }

  process.stderr.write("\n");

  const sample = results
    .filter((r) => r.action === "stripped" && r.removed > 0)
    .slice(0, 25)
    .map((r) => `${r.brand} ${r.sku} (-${r.removed})`);

  const summary = {
    at: new Date().toISOString(),
    dryRun: args.dryRun,
    publishedOnly: args.publishedOnly,
    urlOnly: args.urlOnly,
    candidates: products.length,
    strippedProducts,
    removedImages,
    clean,
    sampleSkus: sample,
    hashes: knownHashes.size,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(summary);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
