/**
 * Selling-price anomaly detection vs competitor / reference prices.
 *
 * References typically come from:
 *   - Product.oldPrice (MRP / compare-at)
 *   - Enrichment priceSource.amount / priceSource.mrp (official, Tata, Helios,
 *     JIT, Amazon.in, Collective, Ethos, TGT, etc.)
 *
 * Levels:
 *   - soft  → staff must explicitly confirm before go-live
 *   - hard  → block go-live (extreme outlier; likely typo)
 *
 * ₹0 / missing price is handled separately by storeEligibility.
 */

const SOFT_LOW_RATIO = 0.5; // below 50% of cheapest ref
const SOFT_HIGH_RATIO = 1.5; // above 150% of highest ref
const HARD_LOW_RATIO = 0.2; // below 20% of cheapest ref
const HARD_HIGH_RATIO = 3.0; // above 3× highest ref

const CODE_CONFIRM = "PRICE_ANOMALY_CONFIRM";
const CODE_BLOCK = "PRICE_ANOMALY_BLOCK";

function toFinitePrice(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function formatInr(n) {
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Normalize a list of { source, amount } into unique positive amounts + labels.
 * @param {Array<{ source?: string, label?: string, amount?: number, mrp?: number }>} refs
 */
function normalizeRefs(refs) {
  const out = [];
  const seen = new Set();
  for (const r of refs || []) {
    if (!r || typeof r !== "object") continue;
    const source = String(r.source || r.label || "reference").trim() || "reference";
    for (const [key, raw] of [
      ["amount", r.amount],
      ["mrp", r.mrp],
    ]) {
      const amount = toFinitePrice(raw);
      if (amount == null) continue;
      const dedupe = `${source}:${key}:${amount}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        source,
        kind: key,
        amount,
        label: `${source} ${key === "mrp" ? "MRP" : "price"} ${formatInr(amount)}`,
      });
    }
  }
  return out;
}

/**
 * @param {number|string} sellingPrice
 * @param {Array} refs - raw reference price entries
 * @returns {null | {
 *   level: 'soft'|'hard',
 *   kind: 'too_low'|'too_high',
 *   code: string,
 *   sellingPrice: number,
 *   competitorMin: number,
 *   competitorMax: number,
 *   sources: Array,
 *   ratioToMin: number|null,
 *   ratioToMax: number|null,
 *   message: string,
 * }}
 */
function detectPriceAnomaly(sellingPrice, refs) {
  const price = toFinitePrice(sellingPrice);
  if (price == null) return null;

  const sources = normalizeRefs(refs);
  if (sources.length === 0) return null;

  const amounts = sources.map((s) => s.amount);
  const competitorMin = Math.min(...amounts);
  const competitorMax = Math.max(...amounts);
  const ratioToMin = competitorMin > 0 ? price / competitorMin : null;
  const ratioToMax = competitorMax > 0 ? price / competitorMax : null;

  const rangeLabel = `competitor/reference range ${formatInr(competitorMin)}–${formatInr(competitorMax)}`;

  let level = null;
  let kind = null;

  if (ratioToMin != null && ratioToMin < HARD_LOW_RATIO) {
    level = "hard";
    kind = "too_low";
  } else if (ratioToMax != null && ratioToMax > HARD_HIGH_RATIO) {
    level = "hard";
    kind = "too_high";
  } else if (ratioToMin != null && ratioToMin < SOFT_LOW_RATIO) {
    level = "soft";
    kind = "too_low";
  } else if (ratioToMax != null && ratioToMax > SOFT_HIGH_RATIO) {
    level = "soft";
    kind = "too_high";
  }

  if (!level) return null;

  const message =
    kind === "too_low"
      ? `Selling price ${formatInr(price)} looks ${level === "hard" ? "extremely" : "unusually"} low vs ${rangeLabel}`
      : `Selling price ${formatInr(price)} looks ${level === "hard" ? "extremely" : "unusually"} high vs ${rangeLabel}`;

  return {
    level,
    kind,
    code: level === "hard" ? CODE_BLOCK : CODE_CONFIRM,
    sellingPrice: price,
    competitorMin,
    competitorMax,
    sources,
    ratioToMin,
    ratioToMax,
    message,
  };
}

/**
 * Evaluate anomaly for a product-like doc + optional enrichment refs.
 * @param {object} doc
 * @param {{ refs?: Array, confirmPriceAnomaly?: boolean }} options
 * @returns {{ ok: true } | { ok: false, httpStatus: number, anomaly: object, message: string }}
 */
function evaluatePublishPriceAnomaly(doc, options = {}) {
  const refs = Array.isArray(options.refs) ? options.refs : [];
  const anomaly = detectPriceAnomaly(doc?.price, refs);
  if (!anomaly) return { ok: true };

  if (anomaly.level === "hard") {
    return {
      ok: false,
      httpStatus: 400,
      anomaly,
      message: `${anomaly.message}. Fix the price before going live.`,
    };
  }

  if (options.confirmPriceAnomaly === true) {
    return { ok: true, anomaly, confirmed: true };
  }

  return {
    ok: false,
    httpStatus: 409,
    anomaly,
    message: `${anomaly.message}. Confirm to continue anyway.`,
  };
}

function anomalyResponsePayload(result) {
  if (!result || result.ok) return null;
  return {
    success: false,
    code: result.anomaly.code,
    message: result.message,
    data: {
      anomaly: result.anomaly,
      requiresConfirmation: result.anomaly.level === "soft",
    },
  };
}

module.exports = {
  SOFT_LOW_RATIO,
  SOFT_HIGH_RATIO,
  HARD_LOW_RATIO,
  HARD_HIGH_RATIO,
  CODE_CONFIRM,
  CODE_BLOCK,
  toFinitePrice,
  formatInr,
  normalizeRefs,
  detectPriceAnomaly,
  evaluatePublishPriceAnomaly,
  anomalyResponsePayload,
};
