"use strict";

/**
 * Alba enrichment — India Shopify + retailer fallback.
 *
 * Official India store: https://alba-watches.co.in/ (Shopify; Node OK).
 * Handles like `{sku-lower}-green-dial-automatic-mens-sports-watch`.
 *
 * Resolve order:
 *   1. options.officialUrl / albaInUrl / CSV / REF_URLS
 *   2. alba-watches.co.in (suggest → handle guess → products.json catalog)
 *   3. Luxury retailer chain: Collective → Tata Cliq → JIT → TGT → Ethos
 *   (No shared Amazon.in helper for Alba — Armani-only amazon scrapers.)
 *
 * First SKU: AL4817X1 (Green Dial Automatic Men's Sports Watch)
 * Prefer brand-site CDN when available. No auto-publish.
 */

const path = require("path");
const { sleep } = require("../lib/http");
const { buildSeo } = require("../lib/seo");
const {
  enrichFromRetailerChain,
  SOURCE: RETAILER_SOURCE,
} = require("../lib/retailerFallback");
const {
  enrichFromAlbaIn,
  SOURCE_ID: SOURCE_ALBA_IN,
  ALBA_IN_ORIGIN,
} = require("../lib/albaIn");

const BRAND = "Alba";
const SITE_ORIGIN = ALBA_IN_ORIGIN;
const SOURCE_OFFICIAL = SOURCE_ALBA_IN;
const SOURCE_COLLECTIVE = RETAILER_SOURCE.COLLECTIVE;
const SOURCE_TATA = RETAILER_SOURCE.TATA;
const SOURCE_TGT = RETAILER_SOURCE.TGT;
const SOURCE_ETHOS = RETAILER_SOURCE.ETHOS;
const SOURCE_JIT = RETAILER_SOURCE.JUSTINTIME;

/** Known official PDPs (compact → URL). */
const REF_URLS = {
  AL4817X1:
    "https://alba-watches.co.in/products/al4817x1-green-dial-automatic-mens-sports-watch",
};

/** Known Tata Cliq Luxury PDPs (compact → URL). */
const TATA_CLIQ_REF_URLS = {};

function normalizeSku(raw) {
  const original = String(raw || "").trim();
  const compact = original.toUpperCase().replace(/[.\-_\s]/g, "");
  return {
    compact,
    ims: compact,
    style: compact,
    original,
    typoFrom: null,
    nearMatchMethod: null,
    styleCandidates: [...new Set([compact, original].filter(Boolean))],
  };
}

function skuMatchKeys(raw) {
  const n = normalizeSku(raw);
  return [
    ...new Set(
      [n.compact, n.style, n.original]
        .filter(Boolean)
        .map((s) => String(s).toUpperCase().replace(/[.\-_\s]/g, ""))
    ),
  ];
}

function polishProduct(product, normalized) {
  if (!product || product.status !== "ok") return product;
  product.brand = BRAND;
  product.sku = normalized.compact;
  if (!product.officialSku) product.officialSku = normalized.compact;

  let title = String(product.title || "").trim();
  title = title.replace(/^ALBA\b/i, BRAND).trim();
  if (title && !new RegExp(`^${BRAND}\\b`, "i").test(title)) {
    // Titles often start with SKU — prefix brand
    if (new RegExp(`^${normalized.compact}\\b`, "i").test(title)) {
      title = `${BRAND} ${title}`;
    } else {
      title = `${BRAND} ${title}`;
    }
  }
  product.title = title;

  Object.assign(product, buildSeo(product, { metaDescription: "" }));
  return product;
}

async function enrichFromRetailerFallback(sku, options = {}) {
  const normalized = normalizeSku(sku);
  const { product } = await enrichFromRetailerChain(sku, {
    ...options,
    brandHint: BRAND,
    preset: "luxury",
    tataCliqUrl:
      options.tataCliqUrl ||
      TATA_CLIQ_REF_URLS[normalized.compact] ||
      null,
    tataCliqRefUrls: {
      ...TATA_CLIQ_REF_URLS,
      ...(options.tataCliqRefUrls || {}),
    },
    fixtureDir:
      options.fixtureDir || path.join(__dirname, "..", "fixtures"),
  });
  if (!product) return null;
  return polishProduct(product, normalized);
}

async function enrichFromIndiaShopify(sku, options = {}) {
  const normalized = normalizeSku(sku);
  try {
    const product = await enrichFromAlbaIn(sku, {
      ...options,
      brandHint: BRAND,
      albaInUrl:
        options.albaInUrl ||
        options.officialUrl ||
        REF_URLS[normalized.compact] ||
        null,
      refUrls: { ...REF_URLS, ...(options.refUrls || {}) },
    });
    if (!product || product.status !== "ok") return product;
    return polishProduct(product, normalized);
  } catch (err) {
    return {
      status: err.code || "error",
      sku: normalized.compact,
      brand: BRAND,
      source: SOURCE_ALBA_IN,
      reason: err.message,
      sourceUrl: err.sourceUrl || null,
      scrapedAt: new Date().toISOString(),
    };
  }
}

async function enrichSku(sku, options = {}) {
  const normalized = normalizeSku(sku);

  if (options.albaInOnly || options.officialOnly) {
    const india = await enrichFromIndiaShopify(sku, options);
    if (india && india.status === "ok") return india;
    return {
      status: "not_found",
      sku: normalized.compact,
      brand: BRAND,
      source: SOURCE_ALBA_IN,
      reason: (india && india.reason) || "alba-watches.co.in-only scrape failed",
      sourceUrl: (india && india.sourceUrl) || null,
      scrapedAt: new Date().toISOString(),
    };
  }

  if (
    options.collectiveOnly ||
    options.tataCliqOnly ||
    options.tgtLuxeOnly ||
    options.ethosOnly ||
    options.justInTimeOnly
  ) {
    const retailer = await enrichFromRetailerFallback(sku, options);
    if (retailer && retailer.status === "ok") return retailer;
    return {
      status: "not_found",
      sku: normalized.compact,
      brand: BRAND,
      source: SOURCE_OFFICIAL,
      reason: "retailer-only scrape failed",
      sourceUrl: null,
      scrapedAt: new Date().toISOString(),
    };
  }

  if (!options.skipOfficial && !options.skipIndiaShopify) {
    const india = await enrichFromIndiaShopify(sku, options);
    if (india && india.status === "ok") return india;
  }

  if (!options.skipRetailerFallback) {
    const retailer = await enrichFromRetailerFallback(sku, options);
    if (retailer && retailer.status === "ok") return retailer;
  }

  return {
    status: "not_found",
    sku: normalized.compact,
    brand: BRAND,
    source: SOURCE_OFFICIAL,
    reason:
      "No alba-watches.co.in PDP and retailer chain missed — pass --tatacliq-url or add REF",
    sourceUrl: null,
    scrapedAt: new Date().toISOString(),
  };
}

module.exports = {
  BRAND,
  SITE_ORIGIN,
  ALBA_IN_ORIGIN,
  SOURCE_OFFICIAL,
  SOURCE_ALBA_IN,
  SOURCE_COLLECTIVE,
  SOURCE_TATA,
  SOURCE_TGT,
  SOURCE_ETHOS,
  SOURCE_JIT,
  REF_URLS,
  TATA_CLIQ_REF_URLS,
  normalizeSku,
  skuMatchKeys,
  polishProduct,
  enrichFromRetailerFallback,
  enrichFromIndiaShopify,
  enrichSku,
};
