"use strict";

/**
 * Staff mismatch copilot: enrich a SKU from a pasted competitor PDP URL
 * (Tata / JIT / Helios / Collective / TGT / Ethos).
 */

const { enrichFromTataCliq } = require("./tatacliq");
const { enrichFromJustInTime } = require("./justintime");
const { enrichFromHelios } = require("./helios");
const { enrichFromCollective } = require("./thecollective");
const { enrichFromTgtLuxe } = require("./tgtluxe");
const { enrichFromEthos } = require("./ethos");
const { auditProductImages } = require("./retailerImageHygiene");

const SUPPORTED =
  "Tata Cliq, Just In Time, Helios, The Collective, TGT Luxe, or Ethos";

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]/g, "");
}

function detectRetailerFromUrl(url) {
  let host = "";
  try {
    host = new URL(String(url || "").trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes("tatacliq")) return "tatacliq";
  if (host.includes("justintime")) return "justintime";
  if (host.includes("helioswatchstore") || /(^|\.)helios\./.test(host))
    return "helios";
  if (host.includes("thecollective")) return "collective";
  if (host.includes("tgtluxe")) return "tgtluxe";
  if (host.includes("ethoswatches") || host.includes("ethos")) return "ethos";
  return null;
}

/**
 * @param {string} sku
 * @param {string} url
 * @param {{ brandHint?: string, timeoutMs?: number }} [options]
 */
async function enrichFromCompetitorUrl(sku, url, options = {}) {
  const sourceUrl = String(url || "").trim();
  if (!sourceUrl) {
    return { status: "error", reason: "Competitor URL is required" };
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { status: "error", reason: "Invalid URL", sourceUrl };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { status: "error", reason: "URL must be http(s)", sourceUrl };
  }

  const retailer = detectRetailerFromUrl(sourceUrl);
  if (!retailer) {
    return {
      status: "error",
      reason: `Unsupported retailer URL. Paste a PDP from ${SUPPORTED}.`,
      sourceUrl,
    };
  }

  const brandHint = options.brandHint || "Watch";
  const timeoutMs = options.timeoutMs;
  const compact = compactSku(sku);
  const common = { brandHint, timeoutMs, resolveBySku: false };

  let result;
  if (retailer === "tatacliq") {
    result = await enrichFromTataCliq(compact, {
      ...common,
      tataCliqUrl: sourceUrl,
    });
  } else if (retailer === "justintime") {
    result = await enrichFromJustInTime(compact, {
      ...common,
      justInTimeUrl: sourceUrl,
    });
  } else if (retailer === "helios") {
    result = await enrichFromHelios(compact, {
      ...common,
      heliosUrl: sourceUrl,
    });
  } else if (retailer === "collective") {
    result = await enrichFromCollective(compact, {
      ...common,
      collectiveUrl: sourceUrl,
    });
  } else if (retailer === "tgtluxe") {
    result = await enrichFromTgtLuxe(compact, {
      ...common,
      tgtLuxeUrl: sourceUrl,
    });
  } else if (retailer === "ethos") {
    result = await enrichFromEthos(compact, {
      ...common,
      ethosUrl: sourceUrl,
    });
  } else {
    return {
      status: "error",
      reason: `Unsupported retailer URL. Paste a PDP from ${SUPPORTED}.`,
      sourceUrl,
    };
  }

  if (result && result.status === "ok") {
    if (!result.source) result.source = retailer;
    auditProductImages(result);
  }
  return result;
}

module.exports = {
  SUPPORTED,
  compactSku,
  detectRetailerFromUrl,
  enrichFromCompetitorUrl,
};
