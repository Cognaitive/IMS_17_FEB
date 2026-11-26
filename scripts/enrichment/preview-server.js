#!/usr/bin/env node
"use strict";

/**
 * Local enrichment scrape preview UI (dev / verification only).
 *
 *   node preview-server.js
 *   open http://localhost:5056
 *
 * GET  /api/results           — index of batch / prior scrape outputs
 * GET  /api/results/:sku      — one SKU from batch (or latest preview)
 * GET  /api/brand-progress    — per-brand Done / Left / Failed vs input CSVs
 * GET  /api/merge-policy      — documented staff-wins merge rules
 * POST /api/merge-preview     — fill vs skip given scraped + existing product
 * POST /api/scrape { brand?, sku, downloadImages?, useFixture? }
 * serves output images under /media/*
 *
 * Brands: Balmain | Titan | Timex | Tissot | Fossil | Casio | Seiko | Longines | Rado | Emporio Armani | Armani Exchange | Earnshaw | Alexandre Christie — select in UI or pass body.brand.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const balmain = require("./brands/balmain");
const titan = require("./brands/titan");
const timex = require("./brands/timex");
const tissot = require("./brands/tissot");
const fossil = require("./brands/fossil");
const casio = require("./brands/casio");
const seiko = require("./brands/seiko");
const longines = require("./brands/longines");
const rado = require("./brands/rado");
const emporioArmani = require("./brands/emporio-armani");
const armaniExchange = require("./brands/armani-exchange");
const earnshaw = require("./brands/earnshaw");
const alexandreChristie = require("./brands/alexandre-christie");
const michaelKors = require("./brands/michael-kors");
const { fetchBuffer, sleep, imageExtFromBuffer } = require("./lib/http");
const {
  MERGE_POLICY,
  buildMergePreview,
  scrapedToIncoming,
} = require("./lib/merge");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5056;
const FIXTURES = path.join(ROOT, "fixtures");
const OUTPUT_ROOT = path.join(ROOT, "output");
const PREVIEW_HTML = path.join(ROOT, "preview.html");
const INPUT_ROOT = path.join(ROOT, "input");
const BALMAIN_BATCH_DIR = path.join(OUTPUT_ROOT, "balmain-batch");
const TITAN_BATCH_DIR = path.join(OUTPUT_ROOT, "titan-batch");
const TIMEX_BATCH_DIR = path.join(OUTPUT_ROOT, "timex-batch");
const TISSOT_BATCH_DIR = path.join(OUTPUT_ROOT, "tissot-batch");
const FOSSIL_BATCH_DIR = path.join(OUTPUT_ROOT, "fossil-batch");
const CASIO_BATCH_DIR = path.join(OUTPUT_ROOT, "casio-batch");
const SEIKO_BATCH_DIR = path.join(OUTPUT_ROOT, "seiko-batch");
const LONGINES_BATCH_DIR = path.join(OUTPUT_ROOT, "longines-batch");
const RADO_BATCH_DIR = path.join(OUTPUT_ROOT, "rado-batch");
const EMPORIO_ARMANI_BATCH_DIR = path.join(OUTPUT_ROOT, "emporio-armani-batch");
const ARMANI_EXCHANGE_BATCH_DIR = path.join(OUTPUT_ROOT, "armani-exchange-batch");
const EARNSHAW_BATCH_DIR = path.join(OUTPUT_ROOT, "earnshaw-batch");
const ALEXANDRE_CHRISTIE_BATCH_DIR = path.join(
  OUTPUT_ROOT,
  "alexandre-christie-batch"
);
const MICHAEL_KORS_BATCH_DIR = path.join(OUTPUT_ROOT, "michael-kors-batch");
/** @deprecated Prefer BALMAIN_BATCH_DIR / TITAN_BATCH_DIR — kept for health payload */
const BATCH_DIR = TITAN_BATCH_DIR;
const APPROVED_PATH = path.join(OUTPUT_ROOT, "review-approved.json");
const IMS_BASE = (process.env.IMS_API_BASE || "http://127.0.0.1:5055").replace(
  /\/$/,
  ""
);

/**
 * Brands tracked on the Done / Left / Failed progress board.
 * Batch dirs are tried in order (first with products.json wins).
 */
const PROGRESS_BRANDS = [
  {
    id: "balmain",
    label: "Balmain",
    csv: path.join(INPUT_ROOT, "balmain-skus.csv"),
    batchDirs: [
      BALMAIN_BATCH_DIR,
      path.join(OUTPUT_ROOT, "balmain-batch-archived"),
    ],
  },
  {
    id: "titan",
    label: "Titan",
    csv: path.join(INPUT_ROOT, "titan-skus.csv"),
    batchDirs: [TITAN_BATCH_DIR],
  },
  {
    id: "timex",
    label: "Timex",
    csv: path.join(INPUT_ROOT, "timex-skus.csv"),
    batchDirs: [TIMEX_BATCH_DIR],
  },
  {
    id: "tissot",
    label: "Tissot",
    csv: path.join(INPUT_ROOT, "tissot-skus.csv"),
    batchDirs: [
      TISSOT_BATCH_DIR,
      path.join(OUTPUT_ROOT, "tissot-live-proof"),
      path.join(OUTPUT_ROOT, "tissot-proof"),
    ],
  },
  {
    id: "fossil",
    label: "Fossil",
    csv: path.join(INPUT_ROOT, "fossil-skus.csv"),
    batchDirs: [FOSSIL_BATCH_DIR, path.join(OUTPUT_ROOT, "fossil-proof")],
  },
  {
    id: "casio",
    label: "Casio",
    csv: path.join(INPUT_ROOT, "casio-skus.csv"),
    batchDirs: [CASIO_BATCH_DIR, path.join(OUTPUT_ROOT, "casio-proof")],
  },
  {
    id: "seiko",
    label: "Seiko",
    csv: path.join(INPUT_ROOT, "seiko-skus.csv"),
    batchDirs: [
      SEIKO_BATCH_DIR,
      path.join(OUTPUT_ROOT, "seiko-proof"),
    ],
  },
  {
    id: "longines",
    label: "Longines",
    csv: path.join(INPUT_ROOT, "longines-skus.csv"),
    batchDirs: [
      LONGINES_BATCH_DIR,
      path.join(OUTPUT_ROOT, "longines-proof"),
    ],
  },
  {
    id: "rado",
    label: "Rado",
    csv: path.join(INPUT_ROOT, "rado-skus.csv"),
    batchDirs: [
      RADO_BATCH_DIR,
      path.join(OUTPUT_ROOT, "rado-proof"),
    ],
  },
  {
    id: "emporio-armani",
    label: "Emporio Armani",
    csv: path.join(INPUT_ROOT, "emporio-armani-skus.csv"),
    batchDirs: [
      EMPORIO_ARMANI_BATCH_DIR,
      path.join(OUTPUT_ROOT, "emporio-armani-proof"),
    ],
  },
  {
    id: "armani-exchange",
    label: "Armani Exchange",
    csv: path.join(INPUT_ROOT, "armani-exchange-skus.csv"),
    batchDirs: [
      ARMANI_EXCHANGE_BATCH_DIR,
      path.join(OUTPUT_ROOT, "armani-exchange-proof"),
    ],
  },
  {
    id: "earnshaw",
    label: "Earnshaw",
    csv: path.join(INPUT_ROOT, "earnshaw-skus.csv"),
    batchDirs: [
      EARNSHAW_BATCH_DIR,
      path.join(OUTPUT_ROOT, "earnshaw-proof"),
    ],
  },
  {
    id: "alexandre-christie",
    label: "Alexandre Christie",
    csv: path.join(INPUT_ROOT, "alexandre-christie-skus.csv"),
    batchDirs: [
      ALEXANDRE_CHRISTIE_BATCH_DIR,
      path.join(OUTPUT_ROOT, "alexandre-christie-proof"),
    ],
  },
  {
    id: "michael-kors",
    label: "Michael Kors",
    csv: path.join(INPUT_ROOT, "michael-kors-skus.csv"),
    batchDirs: [
      MICHAEL_KORS_BATCH_DIR,
      path.join(OUTPUT_ROOT, "michael-kors-proof"),
    ],
  },
];

/** Brands removed from the review sidebar after approved DB push. */
function loadApprovedReviewBrands() {
  try {
    if (!fs.existsSync(APPROVED_PATH)) return new Set();
    const raw = JSON.parse(fs.readFileSync(APPROVED_PATH, "utf8"));
    const brands = Array.isArray(raw?.brands) ? raw.brands : [];
    return new Set(
      brands.map((b) => String(b || "").trim().toLowerCase()).filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function isArchivedOutputDir(name) {
  return /archived/i.test(String(name || ""));
}

function productBrandKey(product) {
  const brand = String(product?.brand || "").trim().toLowerCase();
  if (
    /^alexandre\s*christie$/.test(brand) ||
    /^alexandra\s*christie$/.test(brand)
  ) {
    return "alexandre-christie";
  }
  if (/^emporio\s*armani$/.test(brand)) return "emporio-armani";
  if (/^armani\s*exchange$/.test(brand)) return "armani-exchange";
  if (/^thomas\s*earnshaw$/.test(brand)) return "earnshaw";
  if (/^michael\s*kors$/.test(brand)) return "michael-kors";
  if (brand) return brand;
  const src = String(product?.source || "").toLowerCase();
  if (src === "balmainwatches" || src === "tatacliq") {
    // Tata Cliq is also a Longines India fallback — prefer brand field
    if (/^longines$/i.test(String(product?.brand || ""))) return "longines";
    if (/^alexandre\s*christie$/i.test(String(product?.brand || ""))) {
      return "alexandre-christie";
    }
    if (/^michael\s*kors$/i.test(String(product?.brand || ""))) {
      return "michael-kors";
    }
    return "balmain";
  }
  if (src === "thecollective" || src === "tgtluxe" || src === "ethos") {
    if (/^rado$/i.test(String(product?.brand || ""))) return "rado";
    if (/^emporio\s*armani$/i.test(String(product?.brand || ""))) {
      return "emporio-armani";
    }
    if (/^armani\s*exchange$/i.test(String(product?.brand || ""))) {
      return "armani-exchange";
    }
    if (/^earnshaw$/i.test(String(product?.brand || ""))) return "earnshaw";
    if (/^alexandre\s*christie$/i.test(String(product?.brand || ""))) {
      return "alexandre-christie";
    }
    if (/^michael\s*kors$/i.test(String(product?.brand || ""))) {
      return "michael-kors";
    }
    return "longines";
  }
  if (src === "titan") return "titan";
  if (src === "timexindia" || src === "timex") return "timex";
  if (src === "tissot") return "tissot";
  if (src === "fossil") return "fossil";
  if (src === "casio") return "casio";
  if (src === "seiko") return "seiko";
  if (src === "longines") return "longines";
  if (src === "rado") return "rado";
  if (src === "emporio-armani" || src === "armani") return "emporio-armani";
  if (src === "armani-exchange") return "armani-exchange";
  if (src === "earnshaw") return "earnshaw";
  if (src === "alexandre-christie") return "alexandre-christie";
  if (src === "michael-kors" || src === "michaelkors") return "michael-kors";
  if (src === "amazon" && /^emporio\s*armani$/i.test(String(product?.brand || ""))) {
    return "emporio-armani";
  }
  if (src === "amazon" && /^armani\s*exchange$/i.test(String(product?.brand || ""))) {
    return "armani-exchange";
  }
  const sku = String(product?.sku || "").toUpperCase();
  if (/^TWEG/i.test(sku)) return "timex";
  if (/^T\d{10,}/i.test(sku)) return "tissot";
  // Earnshaw ES-####-## (compact ES + 6 digits) before Fossil ES####
  if (/^ES-?\d{4}-?\d{2}$/i.test(sku) || /^ES\d{6}$/i.test(sku)) {
    return "earnshaw";
  }
  if (/^MK\d{3,}/i.test(sku)) return "michael-kors";
  if (/^(FS|ES|ME|BQ|CE)\d/i.test(sku)) return "fossil";
  if (/^(D|G|A|I)\d{2,}/i.test(sku)) return "casio";
  if (/^(SPB|SRPE|SRPK|SRPL|SSA|SSC|SSJ|SSK|SUR|SWR|HBJ|HBC|HCB|HCC|HDB|HAB)/i.test(sku)) {
    return "seiko";
  }
  if (/^L\d/i.test(sku)) return "longines";
  if (/^R\d{6,}/i.test(sku)) return "rado";
  if (/^AX\d{4,}/i.test(sku)) return "armani-exchange";
  if (/^AR\d{4,}/i.test(sku)) return "emporio-armani";
  if (/^NU/i.test(sku) || /^NT/i.test(sku) || /^\d{4,}/.test(sku)) {
    return "titan";
  }
  if (/^B\d/i.test(sku)) return "balmain";
  return "";
}

function shouldHideFromReview(product) {
  const approved = loadApprovedReviewBrands();
  const brand = productBrandKey(product);
  return Boolean(brand && approved.has(brand));
}

const BRANDS = {
  balmain: {
    id: "balmain",
    label: "Balmain",
    enrichSku: balmain.enrichSku,
    normalizeSku: balmain.normalizeSku,
    defaultSku: "B48303382",
  },
  titan: {
    id: "titan",
    label: "Titan",
    enrichSku: titan.enrichSku,
    normalizeSku: titan.normalizeSku,
    defaultSku: "NU95198WM01",
  },
  timex: {
    id: "timex",
    label: "Timex",
    enrichSku: timex.enrichSku,
    normalizeSku: timex.normalizeSku,
    defaultSku: "TWEG26300",
  },
  tissot: {
    id: "tissot",
    label: "Tissot",
    enrichSku: tissot.enrichSku,
    normalizeSku: tissot.normalizeSku,
    defaultSku: "T1564103337100",
  },
  fossil: {
    id: "fossil",
    label: "Fossil",
    enrichSku: fossil.enrichSku,
    normalizeSku: fossil.normalizeSku,
    defaultSku: "FS5512",
  },
  casio: {
    id: "casio",
    label: "Casio",
    enrichSku: casio.enrichSku,
    normalizeSku: casio.normalizeSku,
    defaultSku: "D275",
  },
  seiko: {
    id: "seiko",
    label: "Seiko",
    enrichSku: seiko.enrichSku,
    normalizeSku: seiko.normalizeSku,
    defaultSku: "HAB011J1",
  },
  longines: {
    id: "longines",
    label: "Longines",
    enrichSku: longines.enrichSku,
    normalizeSku: longines.normalizeSku,
    defaultSku: "L81154716",
  },
  rado: {
    id: "rado",
    label: "Rado",
    enrichSku: rado.enrichSku,
    normalizeSku: rado.normalizeSku,
    defaultSku: "R48921703",
  },
  "emporio-armani": {
    id: "emporio-armani",
    label: "Emporio Armani",
    enrichSku: emporioArmani.enrichSku,
    normalizeSku: emporioArmani.normalizeSku,
    defaultSku: "AR70021",
  },
  "armani-exchange": {
    id: "armani-exchange",
    label: "Armani Exchange",
    enrichSku: armaniExchange.enrichSku,
    normalizeSku: armaniExchange.normalizeSku,
    defaultSku: "AX5742",
  },
  earnshaw: {
    id: "earnshaw",
    label: "Earnshaw",
    enrichSku: earnshaw.enrichSku,
    normalizeSku: earnshaw.normalizeSku,
    defaultSku: "ES-8334-44",
  },
  "alexandre-christie": {
    id: "alexandre-christie",
    label: "Alexandre Christie",
    enrichSku: alexandreChristie.enrichSku,
    normalizeSku: alexandreChristie.normalizeSku,
    defaultSku: "2B58BFBROBO",
  },
  "michael-kors": {
    id: "michael-kors",
    label: "Michael Kors",
    enrichSku: michaelKors.enrichSku,
    normalizeSku: michaelKors.normalizeSku,
    defaultSku: "MK7688",
  },
};

const REF_URLS = {
  B48303382:
    "https://www.balmainwatches.com/en/balmain-sedirea-woman-swiss-quartz-watch-31mm-sapphire-b48303382.html",
  NU95198WM01:
    "https://www.titan.co.in/product/titan-purple-dial-analog-watch-for-women-95198wm01.html",
  "95198WM01":
    "https://www.titan.co.in/product/titan-purple-dial-analog-watch-for-women-95198wm01.html",
  TWEG26300: "https://shop.timexindia.com/products/tweg26300",
  TWEG27002:
    "https://shop.timexindia.com/products/timex-harborside-round-43mm-black-dial-analog-men-watch-tweg27002",
  T1564103337100: "https://www.tissotwatches.com/en-in/T1564103337100.html",
  T1504172209100: "https://www.tissotwatches.com/en-in/T1504172209100.html",
  FS5512:
    "https://www.fossil.in/products/neutra-chronograph-amber-leather-watch/FS5512.html",
  ES5498:
    "https://www.fossil.in/products/harlow-three-hand-green-leather-and-rose-gold-tone-stainless-steel-watch/ES5498.html",
  HAB011J1:
    "https://seikowatches.co.in/products/seiko-145th-anniversary-limited-edition-astron-in-edo-purple-hab011j1",
  SPB121J1: "https://seikowatches.co.in/products/prospex-automatic-watch-spb121j1",
  HBJ005P1:
    "https://seikowatches.co.in/products/seiko-145th-anniversary-limited-edition-prospex-speedtimer-in-edo-purple-hbj005p1",
  L81154716:
    "https://www.longines.com/en-in/p/watch-longines-primaluna-l8-115-4-71-6",
  L81154916:
    "https://www.longines.com/en-in/p/watch-longines-primaluna-l8-115-4-91-6",
  R48921703:
    "https://www.rado.com/en_in/florence-diamonds-r48921703.html",
  AR70021:
    "https://www.armani.com/en/emporio-armani/quartz-watch-cod-AR70021-NLP-NLC/",
  AX5742:
    "https://www.armani.com/en-in/armani-exchange/quartz-watch-cod-AX5742-NLP-NLC/",
  ES833444:
    "https://thomas-earnshaw.com/products/engineer-arkwright-skeleton-automatic-trafalgar-teal-es-8334-44",
  "ES-8334-44":
    "https://thomas-earnshaw.com/products/engineer-arkwright-skeleton-automatic-trafalgar-teal-es-8334-44",
  "2B58BFBROBO":
    "https://luxury.tatacliq.com/alexandre-christie-passion-quartz-multifunction-women-36-mm-2b58bfbrobo/p-mp000000032996347",
  MK7688:
    "https://www.michaelkors.com/mini-lexington-black-tone-watch/MK7688.html",
};

const BRAND_LABEL = {
  balmain: "Balmain",
  titan: "Titan",
  timex: "Timex",
  tissot: "Tissot",
  fossil: "Fossil",
  casio: "Casio",
  seiko: "Seiko",
  longines: "Longines",
  rado: "Rado",
  "emporio-armani": "Emporio Armani",
  "armani-exchange": "Armani Exchange",
  earnshaw: "Earnshaw",
  "alexandre-christie": "Alexandre Christie",
  "michael-kors": "Michael Kors",
};

/** India-only / missing official PDP — Tata Cliq Luxury fallback URLs (Balmain) */
const TATA_CLIQ_URLS = {
  B41023124:
    "https://luxury.tatacliq.com/balmain-classic-r-men-41-mm/p-mp000000008717054",
  "2B58BFBROBO":
    "https://luxury.tatacliq.com/alexandre-christie-passion-quartz-multifunction-women-36-mm-2b58bfbrobo/p-mp000000032996347",
};

function resolveBrand(raw) {
  let key = String(raw || "balmain")
    .trim()
    .toLowerCase();
  if (key === "ax" || key === "armani exchange") key = "armani-exchange";
  if (key === "emporio armani") key = "emporio-armani";
  if (key === "thomas earnshaw") key = "earnshaw";
  if (key === "alexandre christie" || key === "alexandra christie") {
    key = "alexandre-christie";
  }
  if (key === "michael kors" || key === "mk") key = "michael-kors";
  return BRANDS[key] || BRANDS.balmain;
}

function compactForBrand(brand, skuRaw) {
  const n = brand.normalizeSku(skuRaw);
  return n.compact || n.ims || String(skuRaw || "").toUpperCase();
}

function priceNoteFor(product) {
  if (!product || !product.priceSource || !product.priceSource.label) return null;
  const cur = String(product.priceSource.currency || "").toUpperCase();
  if (product.source === "titan") {
    return `${product.priceSource.label} on titan.co.in (INR; not written to IMS by default)`;
  }
  if (product.source === "timexindia" || product.source === "timex") {
    return `${product.priceSource.label} on shop.timexindia.com (INR; not written to IMS by default)`;
  }
  if (product.source === "tissot") {
    return `${product.priceSource.label} on tissotwatches.com (INR; not written to IMS by default)`;
  }
  if (product.source === "fossil") {
    return `${product.priceSource.label} on fossil.in (INR; not written to IMS by default)`;
  }
  if (product.source === "casio") {
    return `${product.priceSource.label} on casio.com (not written to IMS by default)`;
  }
  if (
    product.source === "seiko" ||
    product.source === "seiko-india" ||
    product.source === "seiko-global"
  ) {
    const host = /seikowatches\.co\.in/i.test(product.sourceUrl || "")
      ? "seikowatches.co.in"
      : "seikowatches.com";
    return `${product.priceSource.label} on ${host} (INR; not written to IMS by default)`;
  }
  if (product.source === "longines") {
    return `${product.priceSource.label} on longines.com (INR; not written to IMS by default)`;
  }
  if (product.source === "rado") {
    return `${product.priceSource.label} on rado.com (INR; not written to IMS by default)`;
  }
  if (product.source === "emporio-armani") {
    return `${product.priceSource.label} on armani.com (${cur || "USD"}; not written to IMS by default)`;
  }
  if (product.source === "armani-exchange") {
    return `${product.priceSource.label} on armani.com (${cur || "USD"}; not written to IMS by default)`;
  }
  if (product.source === "earnshaw") {
    return `${product.priceSource.label} on thomas-earnshaw.com (${cur || "USD"}; not written to IMS by default)`;
  }
  if (product.source === "michael-kors") {
    return `${product.priceSource.label} on michaelkors.com (${cur || "USD"}; not written to IMS by default)`;
  }
  if (product.source === "amazon") {
    return `${product.priceSource.label} on Amazon.in (INR; not written to IMS by default)`;
  }
  if (product.source === "thecollective") {
    return `${product.priceSource.label} on thecollective.in (INR; not written to IMS by default)`;
  }
  if (product.source === "tgtluxe") {
    return `${product.priceSource.label} on tgtluxe.com (INR; not written to IMS by default)`;
  }
  if (cur === "INR" || product.source === "tatacliq") {
    return `${product.priceSource.label} on Tata Cliq (INR; not written to IMS by default)`;
  }
  return `${product.priceSource.label} on brand site (CHF ≠ INR; not written to IMS by default)`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function downloadImages(product, imagesDir) {
  const skuDir = path.join(imagesDir, product.sku);
  // Replace prior downloads so wrong/related SKU files cannot linger
  fs.rmSync(skuDir, { recursive: true, force: true });
  ensureDir(skuDir);
  const local = [];
  let referer = "https://www.longines.com/";
  try {
    if (product.sourceUrl) referer = new URL(product.sourceUrl).origin + "/";
  } catch {
    /* keep default */
  }
  if (product.source === "tgtluxe") referer = "https://tgtluxe.com/";
  if (product.source === "thecollective") {
    referer = "https://www.thecollective.in/";
  }
  if (product.source === "tatacliq") {
    referer = "https://luxury.tatacliq.com/";
  }
  if (product.source === "ethos") {
    referer = "https://www.ethoswatches.com/";
  }
  if (product.source === "emporio-armani" || product.source === "armani-exchange") {
    referer = "https://www.armani.com/";
  }
  if (product.source === "amazon") referer = "https://www.amazon.in/";
  if (product.source === "tissot") referer = "https://www.tissotwatches.com/";
  for (let i = 0; i < (product.images || []).length; i++) {
    const url = product.images[i];
    try {
      const { buffer, contentType } = await fetchBuffer(url, {
        headers: {
          Referer: referer,
          Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5",
        },
      });
      const ext = imageExtFromBuffer(buffer, url, contentType);
      const file = path.join(skuDir, `${String(i + 1).padStart(2, "0")}${ext}`);
      fs.writeFileSync(file, buffer);
      local.push(file);
    } catch (err) {
      console.warn(`  image download failed: ${url} (${err.message})`);
    }
    await sleep(400);
  }
  return local;
}

function toPublicImagePath(absPath) {
  const rel = path.relative(OUTPUT_ROOT, absPath).split(path.sep).join("/");
  if (rel.startsWith("..")) return null;
  return `/media/${rel}`;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, obj) {
  send(res, status, obj, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

function contentTypeFor(filePath, buffer) {
  // Prefer magic bytes for images — CDN often saves WebP under .png/.jpg names
  if (buffer && Buffer.isBuffer(buffer) && buffer.length >= 12) {
    const sniffed = imageExtFromBuffer(buffer, filePath, "");
    const byMagic = {
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".avif": "image/avif",
    };
    if (byMagic[sniffed]) return byMagic[sniffed];
  }
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
  };
  return map[ext] || "application/octet-stream";
}

function safeMediaPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.replace(/^\/media\/?/, ""));
  const abs = path.resolve(OUTPUT_ROOT, decoded);
  if (!abs.startsWith(OUTPUT_ROOT + path.sep) && abs !== OUTPUT_ROOT) return null;
  return abs;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function readProductsJson(dir) {
  const file = path.join(dir, "products.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function localImagesForSku(batchDir, sku) {
  const skuDir = path.join(batchDir, "images", sku);
  if (!fs.existsSync(skuDir) || !fs.statSync(skuDir).isDirectory()) return [];
  return fs
    .readdirSync(skuDir)
    .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort()
    .map((f) => toPublicImagePath(path.join(skuDir, f)))
    .filter(Boolean);
}

function productImageUrls(product, batchDir) {
  if (product.localImages && product.localImages.length) {
    const mapped = product.localImages.map(toPublicImagePath).filter(Boolean);
    if (mapped.length) return mapped;
  }
  const fromDisk = localImagesForSku(batchDir, product.sku);
  if (fromDisk.length) return fromDisk;
  return product.images || [];
}

function summarizeProduct(product, source) {
  return {
    sku: product.sku,
    status: product.status || "unknown",
    title: product.title || null,
    reason: product.reason || null,
    imageCount: Array.isArray(product.images) ? product.images.length : 0,
    localImageCount: Array.isArray(product.localImages)
      ? product.localImages.length
      : 0,
    source,
    productSource: product.source || null,
    scrapedAt: product.scrapedAt || null,
    nearMatch: product.nearMatch === true,
    matchedStyle: product.matchedStyle || product.styleCode || null,
    typoFrom: product.typoFrom || null,
    imsSku: product.imsSku || null,
    confidence: product.confidence || null,
  };
}

/**
 * Prefer active brand batches; also surface latest preview-* / live-* runs.
 * Approved brands (see output/review-approved.json) and *-archived dirs are
 * excluded from the review sidebar.
 */
function collectResultIndex() {
  const bySku = new Map();
  const approved = loadApprovedReviewBrands();

  function ingest(dir, source, mtime) {
    if (isArchivedOutputDir(source)) return;
    const products = readProductsJson(dir);
    if (!products) return;
    for (const p of products) {
      if (!p || !p.sku) continue;
      if (shouldHideFromReview(p)) continue;
      const sku = String(p.sku).toUpperCase();
      const prev = bySku.get(sku);
      if (!prev || mtime >= prev.mtime) {
        bySku.set(sku, {
          ...summarizeProduct(p, source),
          brand: p.brand || null,
          mtime,
          dir: path.relative(ROOT, dir),
        });
      }
    }
  }

  const primaryBatches = [
    { dir: TITAN_BATCH_DIR, source: "titan-batch", brand: "titan" },
    { dir: BALMAIN_BATCH_DIR, source: "balmain-batch", brand: "balmain" },
    { dir: TIMEX_BATCH_DIR, source: "timex-batch", brand: "timex" },
    { dir: TISSOT_BATCH_DIR, source: "tissot-batch", brand: "tissot" },
    { dir: FOSSIL_BATCH_DIR, source: "fossil-batch", brand: "fossil" },
    { dir: CASIO_BATCH_DIR, source: "casio-batch", brand: "casio" },
    { dir: SEIKO_BATCH_DIR, source: "seiko-batch", brand: "seiko" },
    { dir: LONGINES_BATCH_DIR, source: "longines-batch", brand: "longines" },
    { dir: RADO_BATCH_DIR, source: "rado-batch", brand: "rado" },
    {
      dir: EMPORIO_ARMANI_BATCH_DIR,
      source: "emporio-armani-batch",
      brand: "emporio-armani",
    },
    {
      dir: ARMANI_EXCHANGE_BATCH_DIR,
      source: "armani-exchange-batch",
      brand: "armani-exchange",
    },
    {
      dir: EARNSHAW_BATCH_DIR,
      source: "earnshaw-batch",
      brand: "earnshaw",
    },
    {
      dir: ALEXANDRE_CHRISTIE_BATCH_DIR,
      source: "alexandre-christie-batch",
      brand: "alexandre-christie",
    },
    {
      dir: MICHAEL_KORS_BATCH_DIR,
      source: "michael-kors-batch",
      brand: "michael-kors",
    },
  ];
  for (const b of primaryBatches) {
    if (approved.has(b.brand)) continue;
    if (!fs.existsSync(b.dir) || !fs.statSync(b.dir).isDirectory()) continue;
    if (isArchivedOutputDir(b.source)) continue;
    const pj = path.join(b.dir, "products.json");
    if (!fs.existsSync(pj)) continue;
    ingest(b.dir, b.source, fs.statSync(pj).mtimeMs);
  }

  const knownBatchNames = new Set(primaryBatches.map((b) => b.source));
  if (fs.existsSync(OUTPUT_ROOT)) {
    for (const name of fs.readdirSync(OUTPUT_ROOT)) {
      if (knownBatchNames.has(name)) {
        continue;
      }
      if (isArchivedOutputDir(name)) continue;
      const dir = path.join(OUTPUT_ROOT, name);
      let st;
      try {
        st = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const pj = path.join(dir, "products.json");
      if (!fs.existsSync(pj)) continue;
      ingest(dir, name, fs.statSync(pj).mtimeMs);
    }
  }

  const results = [...bySku.values()]
    .map(({ mtime, ...rest }) => rest)
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.length - ok;

  const activeBatchDir = fs.existsSync(path.join(TIMEX_BATCH_DIR, "products.json"))
    ? TIMEX_BATCH_DIR
    : fs.existsSync(path.join(TITAN_BATCH_DIR, "products.json"))
      ? TITAN_BATCH_DIR
      : fs.existsSync(path.join(BALMAIN_BATCH_DIR, "products.json"))
        ? BALMAIN_BATCH_DIR
        : null;

  return {
    batchDir: activeBatchDir ? path.relative(ROOT, activeBatchDir) : null,
    titanBatchDir: fs.existsSync(TITAN_BATCH_DIR)
      ? path.relative(ROOT, TITAN_BATCH_DIR)
      : null,
    balmainBatchDir: fs.existsSync(BALMAIN_BATCH_DIR)
      ? path.relative(ROOT, BALMAIN_BATCH_DIR)
      : null,
    timexBatchDir: fs.existsSync(TIMEX_BATCH_DIR)
      ? path.relative(ROOT, TIMEX_BATCH_DIR)
      : null,
    tissotBatchDir: fs.existsSync(TISSOT_BATCH_DIR)
      ? path.relative(ROOT, TISSOT_BATCH_DIR)
      : null,
    fossilBatchDir: fs.existsSync(FOSSIL_BATCH_DIR)
      ? path.relative(ROOT, FOSSIL_BATCH_DIR)
      : null,
    casioBatchDir: fs.existsSync(CASIO_BATCH_DIR)
      ? path.relative(ROOT, CASIO_BATCH_DIR)
      : null,
    seikoBatchDir: fs.existsSync(SEIKO_BATCH_DIR)
      ? path.relative(ROOT, SEIKO_BATCH_DIR)
      : null,
    longinesBatchDir: fs.existsSync(LONGINES_BATCH_DIR)
      ? path.relative(ROOT, LONGINES_BATCH_DIR)
      : null,
    approvedBrands: [...approved],
    count: results.length,
    ok,
    failed,
    results,
  };
}

function findProductForSku(skuRaw) {
  // Try both brand normalizers so Titan NU… and Balmain B… resolve
  const compactCandidates = new Set();
  for (const b of Object.values(BRANDS)) {
    compactCandidates.add(compactForBrand(b, skuRaw));
  }
  compactCandidates.add(String(skuRaw || "").toUpperCase());
  // Titan / Timex typo aliases (9210QM01 ↔ 90210QM01, TW2Y…1K ↔ …IK)
  try {
    for (const k of titan.skuMatchKeys(skuRaw)) {
      compactCandidates.add(k);
    }
  } catch {
    /* ignore */
  }
  try {
    for (const k of timex.skuMatchKeys(skuRaw)) {
      compactCandidates.add(k);
    }
  } catch {
    /* ignore */
  }
  const candidates = [];

  if (fs.existsSync(TIMEX_BATCH_DIR) && !isArchivedOutputDir("timex-batch")) {
    candidates.push({ dir: TIMEX_BATCH_DIR, source: "timex-batch", priority: 0 });
  }
  if (fs.existsSync(TISSOT_BATCH_DIR) && !isArchivedOutputDir("tissot-batch")) {
    candidates.push({ dir: TISSOT_BATCH_DIR, source: "tissot-batch", priority: 0 });
  }
  if (fs.existsSync(FOSSIL_BATCH_DIR) && !isArchivedOutputDir("fossil-batch")) {
    candidates.push({ dir: FOSSIL_BATCH_DIR, source: "fossil-batch", priority: 0 });
  }
  if (fs.existsSync(CASIO_BATCH_DIR) && !isArchivedOutputDir("casio-batch")) {
    candidates.push({ dir: CASIO_BATCH_DIR, source: "casio-batch", priority: 0 });
  }
  if (fs.existsSync(SEIKO_BATCH_DIR) && !isArchivedOutputDir("seiko-batch")) {
    candidates.push({ dir: SEIKO_BATCH_DIR, source: "seiko-batch", priority: 0 });
  }
  if (fs.existsSync(LONGINES_BATCH_DIR) && !isArchivedOutputDir("longines-batch")) {
    candidates.push({
      dir: LONGINES_BATCH_DIR,
      source: "longines-batch",
      priority: 0,
    });
  }
  if (fs.existsSync(TITAN_BATCH_DIR) && !isArchivedOutputDir("titan-batch")) {
    candidates.push({ dir: TITAN_BATCH_DIR, source: "titan-batch", priority: 1 });
  }
  if (
    fs.existsSync(BALMAIN_BATCH_DIR) &&
    !isArchivedOutputDir("balmain-batch")
  ) {
    candidates.push({
      dir: BALMAIN_BATCH_DIR,
      source: "balmain-batch",
      priority: 1,
    });
  }

  const knownPrimaryBatches = new Set([
    "balmain-batch",
    "titan-batch",
    "timex-batch",
    "tissot-batch",
    "fossil-batch",
    "casio-batch",
    "seiko-batch",
    "longines-batch",
  ]);
  if (fs.existsSync(OUTPUT_ROOT)) {
    for (const name of fs.readdirSync(OUTPUT_ROOT)) {
      if (knownPrimaryBatches.has(name)) {
        continue;
      }
      if (isArchivedOutputDir(name)) continue;
      const dir = path.join(OUTPUT_ROOT, name);
      if (!fs.existsSync(path.join(dir, "products.json"))) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(path.join(dir, "products.json")).mtimeMs;
      } catch {
        /* ignore */
      }
      candidates.push({ dir, source: name, priority: 1, mtime });
    }
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.mtime || 0) - (a.mtime || 0);
  });

  for (const c of candidates) {
    const products = readProductsJson(c.dir);
    if (!products) continue;
    const product = products.find((p) => {
      if (!p || !p.sku) return false;
      const skuUp = String(p.sku).toUpperCase();
      if (compactCandidates.has(skuUp)) return true;
      const styleUp = String(p.styleCode || "").toUpperCase();
      if (styleUp && compactCandidates.has(styleUp)) return true;
      const typo = String(p.typoFrom || "").toUpperCase();
      if (typo && compactCandidates.has(typo)) return true;
      const aliases = Array.isArray(p.imsSkuAliases) ? p.imsSkuAliases : [];
      return aliases.some((a) => compactCandidates.has(String(a).toUpperCase()));
    });
    if (product) {
      return {
        product,
        source: c.source,
        outDir: path.relative(ROOT, c.dir),
        imageUrls: productImageUrls(product, c.dir),
      };
    }
  }
  return null;
}

/**
 * Lightweight CSV SKU reader (sku / ref / reference column).
 * Handles quoted fields so Seiko title commas do not shift columns.
 */
function parseSkuCsvRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  function splitCsvLine(line) {
    const cols = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const skuIdx = headers.findIndex(
    (h) => h === "sku" || h === "ref" || h === "reference"
  );
  if (skuIdx < 0) {
    if (headers.length === 1 && !/sku|ref/i.test(headers[0])) {
      return lines
        .map((l) => String(l.trim()).toUpperCase())
        .filter(Boolean)
        .map((sku) => ({ sku }));
    }
    return [];
  }
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const sku = String(cols[skuIdx] || "")
      .trim()
      .toUpperCase();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    rows.push({ sku });
  }
  return rows;
}

function resolveProgressBatchDir(batchDirs) {
  for (const dir of batchDirs || []) {
    if (!dir) continue;
    const pj = path.join(dir, "products.json");
    if (fs.existsSync(pj)) {
      return dir;
    }
  }
  return null;
}

function readNotFoundSkus(batchDir) {
  const file = path.join(batchDir, "not_found.json");
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.notFound)
          ? data.notFound
          : [];
    return list
      .map((row) => {
        if (!row) return null;
        if (typeof row === "string") return String(row).toUpperCase();
        return String(row.sku || row.imsSku || row.ref || "").toUpperCase() || null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isOkStatus(status) {
  return String(status || "").toLowerCase() === "ok";
}

/** Uppercase compact key for progress matching. */
function progressKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

/**
 * All keys that should resolve a SKU for brand-progress (Titan/Timex typo aliases).
 * e.g. NU134QL01 ↔ 134QL01 ↔ 90134QL01 ↔ NU90134QL01
 */
function progressSkuKeys(brandId, raw) {
  const keys = new Set();
  const base = progressKey(raw);
  if (base) keys.add(base);
  try {
    if (brandId === "titan") {
      for (const k of titan.skuMatchKeys(raw)) keys.add(progressKey(k));
    } else if (brandId === "timex") {
      for (const k of timex.skuMatchKeys(raw)) keys.add(progressKey(k));
    } else if (brandId === "longines") {
      for (const k of longines.skuMatchKeys(raw)) keys.add(progressKey(k));
    }
  } catch {
    /* ignore */
  }
  return [...keys].filter(Boolean);
}

/**
 * Index keys for a batch product: primary sku + style + typo/near-match aliases.
 */
function progressProductKeys(brandId, product) {
  const keys = new Set();
  for (const raw of [
    product.sku,
    product.officialSku,
    product.styleCode,
    product.matchedStyle,
    product.typoFrom,
    product.imsSku,
    ...(Array.isArray(product.imsSkuAliases) ? product.imsSkuAliases : []),
  ]) {
    const k = progressKey(raw);
    if (k) keys.add(k);
  }
  for (const seed of [product.sku, product.typoFrom, product.imsSku].filter(Boolean)) {
    for (const k of progressSkuKeys(brandId, seed)) keys.add(k);
  }
  return [...keys].filter(Boolean);
}

function resolveProgressHit(bySku, brandId, sku) {
  const up = progressKey(sku);
  if (up && bySku.has(up)) return bySku.get(up);
  for (const k of progressSkuKeys(brandId, sku)) {
    if (bySku.has(k)) return bySku.get(k);
  }
  return null;
}

/**
 * Per-brand Done / Left / Failed from input CSV universe + batch outputs.
 * Done = products.json status ok; Failed = non-ok batch row or not_found.json;
 * Left = in CSV (or universe) but not yet in done/failed.
 * Titan/Timex typo + near-match aliases (imsSkuAliases / skuMatchKeys) count as done.
 */
function collectBrandProgress() {
  const brands = [];

  for (const def of PROGRESS_BRANDS) {
    const csvRows = parseSkuCsvRows(def.csv);
    const csvPath = fs.existsSync(def.csv)
      ? path.relative(ROOT, def.csv)
      : null;
    const batchDir = resolveProgressBatchDir(def.batchDirs);
    const batchRel = batchDir ? path.relative(ROOT, batchDir) : null;
    const products = batchDir ? readProductsJson(batchDir) || [] : [];
    const notFoundSkus = batchDir ? readNotFoundSkus(batchDir) : [];

    /** @type {Map<string, { sku: string, status: string, title: string|null, reason: string|null, source: string|null }>} */
    const bySku = new Map();
    /** Primary batch SKUs already indexed (for universe extras). */
    const primaryEntries = [];

    for (const p of products) {
      if (!p || !p.sku) continue;
      const sku = progressKey(p.sku);
      if (!sku) continue;
      const entry = {
        sku,
        status: p.status || "unknown",
        title: p.title || null,
        reason: p.reason || null,
        source: batchRel,
      };
      primaryEntries.push(entry);
      for (const k of progressProductKeys(def.id, p)) {
        if (!bySku.has(k)) bySku.set(k, entry);
      }
    }
    for (const raw of notFoundSkus) {
      const sku = progressKey(raw);
      if (!sku) continue;
      if (resolveProgressHit(bySku, def.id, sku)) continue;
      const entry = {
        sku,
        status: "not_found",
        title: null,
        reason: "listed in not_found.json",
        source: batchRel,
      };
      primaryEntries.push(entry);
      for (const k of progressSkuKeys(def.id, sku)) {
        if (!bySku.has(k)) bySku.set(k, entry);
      }
    }

    // Universe = CSV SKUs + batch/not_found primaries not already matched via aliases
    const universe = new Set(csvRows.map((r) => progressKey(r.sku)).filter(Boolean));
    const claimedPrimaries = new Set();
    for (const sku of universe) {
      const hit = resolveProgressHit(bySku, def.id, sku);
      if (hit) claimedPrimaries.add(hit.sku);
    }
    for (const entry of primaryEntries) {
      if (!claimedPrimaries.has(entry.sku)) {
        universe.add(entry.sku);
        claimedPrimaries.add(entry.sku);
      }
    }

    const done = [];
    const failed = [];
    const left = [];

    for (const sku of [...universe].sort()) {
      const hit = resolveProgressHit(bySku, def.id, sku);
      if (!hit) {
        left.push({ sku, status: "pending", title: null, reason: null, source: null });
        continue;
      }
      // Keep the universe/CSV SKU as the list identity (IMS typo form stays visible)
      const row = {
        sku,
        status: hit.status,
        title: hit.title,
        reason: hit.reason,
        source: hit.source,
        matchedSku: hit.sku !== sku ? hit.sku : undefined,
      };
      if (isOkStatus(hit.status)) {
        done.push(row);
      } else {
        failed.push(row);
      }
    }

    const hasCsv = csvRows.length > 0;
    const hasBatch = Boolean(batchDir && products.length);
    const available = hasCsv || hasBatch || notFoundSkus.length > 0;

    brands.push({
      id: def.id,
      label: def.label,
      available,
      csv: csvPath,
      batchDir: batchRel,
      total: universe.size,
      doneCount: done.length,
      leftCount: left.length,
      failedCount: failed.length,
      done,
      left,
      failed,
    });
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    brands,
  };
}

function handleBrandProgress(_req, res) {
  return sendJson(res, 200, collectBrandProgress());
}

function handleResultsIndex(_req, res) {
  return sendJson(res, 200, collectResultIndex());
}

function handleResultSku(req, res, skuParam) {
  const hit = findProductForSku(skuParam);
  if (!hit) {
    return sendJson(res, 404, {
      ok: false,
      error: `No saved result for SKU ${skuParam}`,
    });
  }
  const { product, source, outDir, imageUrls } = hit;
  const ok = product.status === "ok";
  return sendJson(res, ok ? 200 : 422, {
    ok,
    source,
    outDir,
    product,
    imageUrls,
    priceNote: priceNoteFor(product),
  });
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          Accept: "application/json",
          ...headers,
        },
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, body });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

/**
 * Best-effort fetch of an existing IMS product by SKU from local backend.
 * Requires auth token when IMS is protected (optional Authorization header / body.token).
 */
async function fetchImsProductBySku(sku, token) {
  const headers = {};
  if (token) headers.Authorization = token.startsWith("Bearer ")
    ? token
    : `Bearer ${token}`;

  try {
    const url = `${IMS_BASE}/api/products?search=${encodeURIComponent(
      sku
    )}&limit=20&page=1`;
    const res = await httpGetJson(url, headers);
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        authRequired: true,
        error: "IMS requires auth — paste a Bearer token or supply existing JSON",
        status: res.status,
      };
    }
    if (res.status >= 400) {
      return {
        ok: false,
        error: `IMS HTTP ${res.status}`,
        status: res.status,
      };
    }
    const products =
      (res.json && (res.json.products || res.json.data || res.json)) || [];
    const list = Array.isArray(products) ? products : [];
    const want = String(sku).toUpperCase();
    const hit =
      list.find((p) => String(p.sku || "").toUpperCase() === want) || null;
    return { ok: true, product: hit, searched: list.length };
  } catch (err) {
    return {
      ok: false,
      error: `IMS unreachable at ${IMS_BASE}: ${err.message}`,
    };
  }
}

/**
 * Demo-only staff product for merge preview when IMS is unavailable.
 * Brand-aware — never return a Balmain stub for Titan (or vice versa).
 * Always label as demo sample (not the real IMS row for this SKU).
 */
function sampleExistingProduct(sku, brandKey) {
  const key = String(brandKey || "balmain")
    .trim()
    .toLowerCase();
  const note = "demo sample (not this SKU)";

  if (key === "titan") {
    return {
      sku: sku || "NU95198WM01",
      brand: "Titan",
      title: "Demo sample · staff Titan title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Stainless Steel",
      dialColor: "",
      waterResistance: "",
      movement: "Quartz",
      gender: "Female",
      category: "",
      price: 12000,
      oldPrice: 0,
      inventory: 2,
      images: ["https://example.com/staff-uploaded-titan.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  if (key === "timex") {
    return {
      sku: sku || "TWEG26300",
      brand: "Timex",
      title: "Demo sample · staff Timex title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Stainless Steel",
      dialColor: "Blue",
      waterResistance: "",
      movement: "Quartz",
      gender: "Male",
      category: "Analog",
      price: 11995,
      oldPrice: 0,
      inventory: 2,
      images: ["https://example.com/staff-uploaded-timex.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  if (key === "tissot") {
    return {
      sku: sku || "T1564103337100",
      brand: "Tissot",
      title: "Demo sample · staff Tissot title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Stainless Steel",
      dialColor: "",
      waterResistance: "",
      movement: "Quartz",
      gender: "Male",
      category: "",
      price: 50500,
      oldPrice: 0,
      inventory: 1,
      images: ["https://example.com/staff-uploaded-tissot.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  if (key === "fossil") {
    return {
      sku: sku || "FS5512",
      brand: "Fossil",
      title: "Demo sample · staff Fossil title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Stainless Steel",
      dialColor: "Black",
      waterResistance: "",
      movement: "Quartz",
      gender: "Male",
      category: "Chronograph",
      price: 12995,
      oldPrice: 0,
      inventory: 1,
      images: ["https://example.com/staff-uploaded-fossil.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  if (key === "casio") {
    return {
      sku: sku || "D275",
      brand: "Casio",
      title: "Demo sample · staff Casio title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Resin",
      dialColor: "Black",
      waterResistance: "",
      movement: "",
      gender: "Unisex",
      category: "Digital",
      price: 2695,
      oldPrice: 0,
      inventory: 2,
      images: ["https://example.com/staff-uploaded-casio.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  if (key === "seiko") {
    return {
      sku: sku || "SPB121J1",
      brand: "Seiko",
      title: "Demo sample · staff Seiko title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Stainless Steel",
      dialColor: "",
      waterResistance: "",
      movement: "Automatic",
      gender: "Male",
      category: "",
      price: 75000,
      oldPrice: 0,
      inventory: 1,
      images: ["https://example.com/staff-uploaded-seiko.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  if (key === "longines") {
    return {
      sku: sku || "L81154716",
      brand: "Longines",
      title: "Demo sample · staff Longines title (not this SKU’s IMS row)",
      description:
        "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
      caseMaterial: "Stainless Steel",
      dialColor: "Ivory",
      waterResistance: "",
      movement: "Quartz",
      gender: "Female",
      category: "Luxury",
      price: 149000,
      oldPrice: 0,
      inventory: 1,
      images: ["https://example.com/staff-uploaded-longines.jpg"],
      seoTitle: "",
      seoDescription: "",
      _demoSample: true,
      _demoSampleNote: note,
    };
  }

  return {
    sku: sku || "B48303382",
    brand: "Balmain",
    title: "Demo sample · staff Balmain title (not this SKU’s IMS row)",
    description:
      "Demo sample description — uncheck Demo sample and enable Try live IMS for the real product.",
    caseMaterial: "Stainless steel",
    dialColor: "",
    waterResistance: "",
    movement: "Quartz",
    gender: "Female",
    category: "",
    price: 45000,
    oldPrice: 0,
    inventory: 2,
    images: ["https://example.com/staff-uploaded.jpg"],
    seoTitle: "",
    seoDescription: "",
    _demoSample: true,
    _demoSampleNote: note,
  };
}

function resolvePreviewBrandKey(body, scraped, skuRaw) {
  if (body && body.brand) {
    const id = resolveBrand(body.brand).id;
    if (id) return id;
  }
  const fromProduct = productBrandKey(scraped);
  if (fromProduct) return fromProduct;
  // SKU heuristics (same as productBrandKey)
  const sku = String(
    (scraped && scraped.sku) || skuRaw || ""
  ).toUpperCase();
  if (/^TWEG/i.test(sku)) return "timex";
  if (/^T\d{10,}/i.test(sku)) return "tissot";
  if (/^ES-?\d{4}-?\d{2}$/i.test(sku) || /^ES\d{6}$/i.test(sku)) {
    return "earnshaw";
  }
  if (/^MK\d{3,}/i.test(sku)) return "michael-kors";
  if (/^(FS|ES|ME|BQ|CE)\d/i.test(sku)) return "fossil";
  if (/^(D|G|A|I)\d{2,}/i.test(sku)) return "casio";
  if (/^(SPB|SRPE|SRPK|SRPL|SSA|SSC|SSJ|SSK|SUR|SWR|HBJ|HBC|HCB|HCC|HDB|HAB)/i.test(sku)) {
    return "seiko";
  }
  if (/^L\d/i.test(sku)) return "longines";
  if (/^R\d{6,}/i.test(sku)) return "rado";
  if (/^AX\d{4,}/i.test(sku)) return "armani-exchange";
  if (/^AR\d{4,}/i.test(sku)) return "emporio-armani";
  if (/^NU/i.test(sku) || /^NT/i.test(sku) || /^\d{4,}/.test(sku)) {
    return "titan";
  }
  if (/^B\d/i.test(sku)) return "balmain";
  return resolveBrand("balmain").id;
}

function isSuccessfulScrape(product) {
  if (!product || typeof product !== "object") return false;
  const status = String(product.status || "").toLowerCase();
  if (!status) {
    // Live scrape payloads may omit status when ok; require a title or images.
    return Boolean(
      product.title ||
        (Array.isArray(product.images) && product.images.length) ||
        product.description
    );
  }
  return status === "ok";
}

async function handleMergePreview(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
  }

  const forceOverwrite = Boolean(body.forceOverwrite);
  const useSample = Boolean(body.useSampleExisting);
  const wantIms =
    body.fetchIms === true ||
    body.ims === true ||
    // Legacy: when sample is off, default to attempting IMS
    (!useSample && body.fetchIms !== false && body.ims !== false);
  const skuRaw =
    (body.sku ||
      (body.scraped && body.scraped.sku) ||
      (body.product && body.product.sku) ||
      "") + "";

  let scraped = body.scraped || body.product || null;
  if (!scraped && skuRaw) {
    const hit = findProductForSku(skuRaw);
    scraped = hit ? hit.product : null;
  }
  if (!scraped) {
    return sendJson(res, 400, {
      ok: false,
      error: "Provide scraped/product JSON or a sku with a saved batch result",
      policy: MERGE_POLICY,
    });
  }

  // Failed / empty batch rows must not reuse another SKU's payload as incoming
  if (!isSuccessfulScrape(scraped)) {
    const sku = scraped.sku || skuRaw || "(unknown)";
    const reason =
      scraped.reason ||
      scraped.error ||
      `status=${scraped.status || "empty"}`;
    return sendJson(res, 200, {
      ok: false,
      error: `No incoming scrape for ${sku} — ${reason}. Incoming cleared (will not reuse another SKU).`,
      existingSource: null,
      incomingEmpty: true,
      preview: null,
    });
  }

  // Guard: request SKU must match scraped SKU when both are present
  // (allow Titan/Timex typo aliases e.g. 9210QM01 ↔ 90210QM01, …1K ↔ …IK)
  if (skuRaw && scraped.sku) {
    const reqUp = String(skuRaw).toUpperCase();
    const scrapedUp = String(scraped.sku).toUpperCase();
    let same = reqUp === scrapedUp;
    if (!same) {
      try {
        const keys = new Set([
          ...titan.skuMatchKeys(skuRaw).map((k) => String(k).toUpperCase()),
          ...timex.skuMatchKeys(skuRaw).map((k) => String(k).toUpperCase()),
        ]);
        same =
          keys.has(scrapedUp) ||
          keys.has(String(scraped.styleCode || "").toUpperCase()) ||
          keys.has(String(scraped.matchedStyle || "").toUpperCase()) ||
          (Array.isArray(scraped.imsSkuAliases) &&
            scraped.imsSkuAliases.some((a) => keys.has(String(a).toUpperCase())));
      } catch {
        same = false;
      }
    }
    if (!same) {
      return sendJson(res, 200, {
        ok: false,
        error: `Incoming SKU mismatch (requested ${skuRaw}, scraped ${scraped.sku}) — cleared.`,
        existingSource: null,
        incomingEmpty: true,
        preview: null,
      });
    }
  }

  const brandKey = resolvePreviewBrandKey(body, scraped, skuRaw);

  let existing = body.existing || null;
  let existingSource = body.existing ? "body" : null;
  let imsNote = null;

  // Prefer real IMS product by SKU when requested; sample only as last resort
  if (!existing && wantIms) {
    const token = body.token || body.imsToken || process.env.IMS_TOKEN || null;
    const ims = await fetchImsProductBySku(scraped.sku || skuRaw, token);
    if (ims.ok && ims.product) {
      existing = ims.product;
      existingSource = "ims";
    } else if (ims.ok && !ims.product) {
      existingSource = "ims-not-found";
      imsNote = `No IMS product for ${scraped.sku || skuRaw}`;
    } else {
      existingSource = ims.authRequired ? "ims-auth-required" : "ims-error";
      imsNote = ims.error || null;
    }
  }

  if (!existing && useSample) {
    existing = sampleExistingProduct(scraped.sku || skuRaw, brandKey);
    existingSource = "demo-sample (not this SKU)";
  }

  const brandLabel = BRAND_LABEL[brandKey] || "Balmain";
  const incoming = scrapedToIncoming(scraped, {
    brandNames: [brandLabel],
  });
  // Keep brand aligned with scrape (avoid defaulting missing brand to Balmain)
  if (!incoming.brand && scraped.brand) incoming.brand = scraped.brand;
  else if (!incoming.brand) {
    incoming.brand = brandLabel;
  }

  const preview = buildMergePreview(existing, incoming, { forceOverwrite });

  return sendJson(res, 200, {
    ok: true,
    existingSource,
    demoSample: Boolean(existing && existing._demoSample),
    imsBase: IMS_BASE,
    imsNote,
    existing: existing
      ? {
          sku: existing.sku,
          brand: existing.brand || null,
          title: existing.title,
          hasImages: Array.isArray(existing.images)
            ? existing.images.length > 0
            : Boolean(existing.imageUrl),
          price: existing.price,
          demoSample: Boolean(existing._demoSample),
        }
      : null,
    preview,
  });
}

function handleMergePolicy(_req, res) {
  return sendJson(res, 200, {
    ok: true,
    policy: MERGE_POLICY,
    publishOnApprove:
      MERGE_POLICY.publishOnApprove ||
      "Approved enrichment ⇒ isPublished true immediately (sold-out allowed).",
    note:
      "Scrape ≠ approve. Scan/Pull never sets isPublished. Approve & go live or apply-*-batch (approved brand) publishes when title + ≥1 image; inventory 0 OK.",
    forceOverwriteDefault: false,
    endpoints: {
      "GET /api/merge-policy": "This document",
      "POST /api/merge-preview": {
        body: {
          sku: "optional — load scraped from batch",
          scraped: "optional scraped product object",
          existing: "optional existing IMS product JSON",
          fetchIms: "try local IMS at IMS_API_BASE (default http://127.0.0.1:5055)",
          token: "optional Bearer token for IMS",
          useSampleExisting:
            "last-resort brand-aware demo sample (not this SKU) when IMS unavailable",
          forceOverwrite: "default false",
        },
      },
    },
  });
}

async function handleScrape(req, res) {
  const started = Date.now();
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
  }

  const brand = resolveBrand(body.brand);
  const skuRaw = String(body.sku || brand.defaultSku).trim();
  if (!skuRaw) {
    return sendJson(res, 400, { ok: false, error: "sku is required" });
  }

  const downloadImagesFlag = Boolean(body.downloadImages);
  const useFixture = Boolean(body.useFixture);
  const htmlPathOverride = body.htmlPath
    ? path.resolve(ROOT, body.htmlPath)
    : null;

  const compact = compactForBrand(brand, skuRaw);
  const skuNorm = brand.normalizeSku(skuRaw);
  const style = skuNorm.style || compact;
  const fixtureCandidates = [
    path.join(FIXTURES, `${compact}.html`),
    path.join(FIXTURES, `${style}.html`),
    path.join(FIXTURES, `titan-${style}.html`),
    path.join(FIXTURES, `titan-${compact}.html`),
    path.join(FIXTURES, `tissot-${compact}.html`),
    path.join(FIXTURES, `fossil-${compact}.html`),
    path.join(FIXTURES, `casio-${compact}.html`),
    path.join(FIXTURES, `seiko-${compact}.html`),
    path.join(FIXTURES, `longines-${compact}.html`),
    path.join(FIXTURES, `rado-${compact}.html`),
    path.join(FIXTURES, `emporio-armani-${compact}.html`),
    path.join(FIXTURES, `armani-exchange-${compact}.html`),
    path.join(FIXTURES, `ax-${compact}.html`),
    path.join(FIXTURES, `armani-${compact}.html`),
    path.join(FIXTURES, `amazon-${compact}.html`),
    path.join(FIXTURES, `earnshaw-${compact}.html`),
    path.join(FIXTURES, `earnshaw-${style}.html`),
    path.join(FIXTURES, `alexandre-christie-${compact}.html`),
    path.join(FIXTURES, `alexandra-christie-${compact}.html`),
    path.join(FIXTURES, `michael-kors-${compact}.html`),
    path.join(FIXTURES, `mk-${compact}.html`),
    path.join(FIXTURES, `tatacliq-${compact}.html`),
    path.join(FIXTURES, `timex-${compact}.html`),
  ];
  const fixtureDefault =
    fixtureCandidates.find((p) => fs.existsSync(p)) || null;
  const htmlPath =
    htmlPathOverride || (useFixture && fixtureDefault ? fixtureDefault : null);

  if (useFixture && !htmlPath) {
    return sendJson(res, 400, {
      ok: false,
      error: `No fixture for ${brand.label} ${compact} (tried fixtures/${compact}.html, ${brand.id}-${compact}.html, …)`,
      durationMs: Date.now() - started,
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(OUTPUT_ROOT, `preview-${compact}-${stamp}`);
  ensureDir(outDir);

  console.log(
    `[preview] ${brand.label} scrape ${compact} fixture=${Boolean(htmlPath)} downloadImages=${downloadImagesFlag}`
  );

  try {
    const enrichOpts = {
      officialUrl: REF_URLS[compact] || REF_URLS[style] || null,
      htmlPath,
      fixtureDir: FIXTURES,
      preferFixture: Boolean(htmlPath),
      delayMs: 1250,
      timeoutMs: 30000,
      allowGuessedUrl:
        brand.id === "titan" &&
        Boolean(REF_URLS[compact] || REF_URLS[style]),
    };
    if (brand.id === "balmain") {
      enrichOpts.tataCliqUrl =
        body.tataCliqUrl || TATA_CLIQ_URLS[compact] || null;
      enrichOpts.tataCliqOnly = Boolean(body.tataCliqOnly);
      enrichOpts.allowGuessedUrl = false;
    }
    if (brand.id === "emporio-armani") {
      enrichOpts.amazonUrl =
        body.amazonUrl ||
        emporioArmani.REF_AMAZON[compact] ||
        null;
      enrichOpts.amazonOnly = Boolean(body.amazonOnly);
      enrichOpts.skipAmazonFallback = Boolean(body.skipAmazonFallback);
      enrichOpts.refUrls = emporioArmani.REF_URLS;
      enrichOpts.refAmazon = emporioArmani.REF_AMAZON;
    }
    if (brand.id === "armani-exchange") {
      enrichOpts.amazonUrl =
        body.amazonUrl ||
        armaniExchange.REF_AMAZON[compact] ||
        null;
      enrichOpts.amazonOnly = Boolean(body.amazonOnly);
      enrichOpts.skipAmazonFallback = Boolean(body.skipAmazonFallback);
      enrichOpts.refUrls = armaniExchange.REF_URLS;
      enrichOpts.refAmazon = armaniExchange.REF_AMAZON;
    }
    if (brand.id === "alexandre-christie") {
      enrichOpts.tataCliqUrl =
        body.tataCliqUrl ||
        TATA_CLIQ_URLS[compact] ||
        alexandreChristie.TATA_CLIQ_REF_URLS[compact] ||
        null;
      enrichOpts.tataCliqOnly = Boolean(body.tataCliqOnly);
      enrichOpts.refUrls = alexandreChristie.REF_URLS;
      enrichOpts.tataCliqRefUrls = alexandreChristie.TATA_CLIQ_REF_URLS;
    }
    if (brand.id === "michael-kors") {
      enrichOpts.refUrls = michaelKors.REF_URLS;
      enrichOpts.officialUrl =
        body.officialUrl ||
        REF_URLS[compact] ||
        michaelKors.REF_URLS[compact] ||
        enrichOpts.officialUrl ||
        null;
    }

    const product = await brand.enrichSku(skuRaw, enrichOpts);

    if (product.status === "ok" && downloadImagesFlag) {
      const imagesDir = path.join(outDir, "images");
      product.localImages = await downloadImages(product, imagesDir);
    }

    fs.writeFileSync(
      path.join(outDir, "products.json"),
      JSON.stringify([product], null, 2)
    );

    const imageUrls =
      product.localImages && product.localImages.length
        ? product.localImages.map(toPublicImagePath).filter(Boolean)
        : product.images || [];

    const durationMs = Date.now() - started;
    const ok = product.status === "ok";

    return sendJson(res, ok ? 200 : 422, {
      ok,
      brand: brand.id,
      durationMs,
      outDir: path.relative(ROOT, outDir),
      product,
      imageUrls,
      priceNote: priceNoteFor(product),
    });
  } catch (err) {
    console.error("[preview] scrape error", err);
    return sendJson(res, 500, {
      ok: false,
      error: err.message || String(err),
      durationMs: Date.now() - started,
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      if (!fs.existsSync(PREVIEW_HTML)) {
        return send(res, 500, "preview.html missing", { "Content-Type": "text/plain" });
      }
      // no-store so samay-test / CF do not keep a stale preview.html where
      // brand-card overflow/hit-testing bugs look "unfixed" after deploy.
      return send(res, 200, fs.readFileSync(PREVIEW_HTML), {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/results") {
      return handleResultsIndex(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/brand-progress") {
      return handleBrandProgress(req, res);
    }

    const resultMatch = url.pathname.match(/^\/api\/results\/([^/]+)$/);
    if (req.method === "GET" && resultMatch) {
      return handleResultSku(req, res, decodeURIComponent(resultMatch[1]));
    }

    if (req.method === "POST" && url.pathname === "/api/scrape") {
      return handleScrape(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/merge-policy") {
      return handleMergePolicy(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/merge-preview") {
      return handleMergePreview(req, res);
    }

    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      const filePath = safeMediaPath(url.pathname);
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return send(res, 404, "Not found", { "Content-Type": "text/plain" });
      }
      const body = fs.readFileSync(filePath);
      return send(res, 200, body, {
        "Content-Type": contentTypeFor(filePath, body),
        "Cache-Control": "private, max-age=60",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        port: PORT,
        brands: Object.keys(BRANDS),
        batchDir: fs.existsSync(BATCH_DIR)
          ? path.relative(ROOT, BATCH_DIR)
          : null,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/brands") {
      return sendJson(res, 200, {
        ok: true,
        brands: Object.values(BRANDS).map((b) => ({
          id: b.id,
          label: b.label,
          defaultSku: b.defaultSku,
        })),
      });
    }

    send(res, 404, "Not found", { "Content-Type": "text/plain" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Enrichment scrape preview → http://localhost:${PORT}`);
  console.log(
    `Brands: ${Object.keys(BRANDS).join(", ")} | GET /api/results | GET /api/brand-progress | POST /api/scrape {brand,sku}`
  );
  console.log(`IMS compare base: ${IMS_BASE}`);
  console.log(`media from ${path.relative(process.cwd(), OUTPUT_ROOT)}/`);
});
