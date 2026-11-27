/**
 * Collect competitor / reference prices for anomaly checks.
 *
 * Sources (no live scrape — publish stays fast):
 *   1. Product.oldPrice (MRP / compare-at set by staff or enrichment)
 *   2. Enrichment batch/output products.json priceSource (official, Tata,
 *      Helios, JIT, Amazon.in, Collective, Ethos, TGT, …)
 */

const fs = require("fs");
const path = require("path");
const { toFinitePrice } = require("./priceAnomaly");

const ENRICHMENT_OUTPUT_DIRS = [
  path.join(__dirname, "../scripts/enrichment/output"),
  path.join(__dirname, "../../scripts/enrichment/output"),
];

let cache = {
  fingerprint: "",
  bySku: new Map(),
};

function compactSku(sku) {
  return String(sku || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function outputFingerprint() {
  const parts = [];
  for (const dir of ENRICHMENT_OUTPUT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const productsPath = path.join(dir, name, "products.json");
      try {
        const st = fs.statSync(productsPath);
        parts.push(`${productsPath}:${st.mtimeMs}:${st.size}`);
      } catch {
        /* skip */
      }
    }
  }
  return parts.sort().join("|");
}

function sourceLabel(item) {
  const raw = String(item?.source || item?.priceSource?.label || "").trim();
  if (!raw) return "enrichment";
  const map = {
    tatacliq: "Tata Cliq",
    helios: "Helios",
    justintime: "Just In Time",
    thecollective: "The Collective",
    collective: "The Collective",
    tgtluxe: "TGT Luxe",
    ethos: "Ethos",
    amazon: "Amazon.in",
    amazon_in: "Amazon.in",
  };
  return map[raw.toLowerCase()] || raw;
}

function indexProductsFile(filePath, bySku) {
  if (!fs.existsSync(filePath)) return;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return;
  }
  const list = Array.isArray(raw) ? raw : raw.products || [];
  for (const item of list) {
    if (!item || item.status !== "ok") continue;
    const ps = item.priceSource;
    const amount = toFinitePrice(ps?.amount);
    const mrp = toFinitePrice(ps?.mrp);
    if (amount == null && mrp == null) continue;
    const keys = new Set(
      [item.sku, item.officialSku, item.styleCode, item.matchedStyle, item.imsSku]
        .map(compactSku)
        .filter(Boolean)
    );
    const entry = {
      source: sourceLabel(item),
      amount,
      mrp,
    };
    for (const key of keys) {
      if (!bySku.has(key)) bySku.set(key, entry);
    }
  }
}

function loadEnrichmentPriceIndex() {
  const fingerprint = outputFingerprint();
  if (fingerprint && fingerprint === cache.fingerprint && cache.bySku.size > 0) {
    return cache.bySku;
  }
  const bySku = new Map();
  for (const dir of ENRICHMENT_OUTPUT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      indexProductsFile(path.join(dir, name, "products.json"), bySku);
    }
  }
  cache = { fingerprint, bySku };
  return bySku;
}

/**
 * @param {object} product - IMS product (or merged preview)
 * @returns {Array<{ source: string, amount?: number, mrp?: number }>}
 */
function collectCompetitorPriceRefs(product) {
  const refs = [];
  const oldPrice = toFinitePrice(product?.oldPrice);
  if (oldPrice != null) {
    refs.push({ source: "MRP / compare-at", mrp: oldPrice });
  }

  const key = compactSku(product?.sku || product?.modelNumber);
  if (key) {
    const hit = loadEnrichmentPriceIndex().get(key);
    if (hit) {
      refs.push({
        source: hit.source,
        amount: hit.amount,
        mrp: hit.mrp,
      });
    }
  }

  // Optional scrape bag on the product (if a future path persists it)
  const ps = product?.priceSource;
  if (ps && typeof ps === "object") {
    refs.push({
      source: sourceLabel({ source: product.source, priceSource: ps }),
      amount: ps.amount,
      mrp: ps.mrp,
    });
  }

  return refs;
}

/** Test helper — reset enrichment file cache. */
function _resetCompetitorPriceCache() {
  cache = { fingerprint: "", bySku: new Map() };
}

module.exports = {
  compactSku,
  collectCompetitorPriceRefs,
  loadEnrichmentPriceIndex,
  _resetCompetitorPriceCache,
};
