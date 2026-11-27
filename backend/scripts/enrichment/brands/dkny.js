"use strict";

/**
 * DKNY enrichment — JIT-first India retailer chain.
 *
 * Official DKNY watch PDPs are inconsistent for Node; Just In Time
 * (justintime.in) carries stock with Shopify JSON. Preset: jit_first
 * (same pattern as Phillip Plein).
 *
 * SKU form on JIT: DK1G135M0055, DK1L024M0135, …
 * Cert slides are usually the last gallery image (DKNY_Certificate_*).
 */

const path = require("path");
const { sleep } = require("../lib/http");
const { buildSeo } = require("../lib/seo");
const {
  enrichFromRetailerChain,
  recoverAfterOfficialMiss,
  SOURCE: RETAILER_SOURCE,
  JUSTINTIME_REF_URLS,
} = require("../lib/retailerFallback");

const BRAND = "DKNY";
const SITE_ORIGIN = "https://www.dkny.com";
const SOURCE_OFFICIAL = "dkny";
const SOURCE_COLLECTIVE = RETAILER_SOURCE.COLLECTIVE;
const SOURCE_TATA = RETAILER_SOURCE.TATA;
const SOURCE_TGT = RETAILER_SOURCE.TGT;
const SOURCE_ETHOS = RETAILER_SOURCE.ETHOS;
const SOURCE_JUSTINTIME = RETAILER_SOURCE.JUSTINTIME;

const SOFT_MISS_HINT =
  "DKNY official missing; retailer chain missed — pass --jit-url or save fixtures/";

/** Known Just In Time PDPs (compact SKU → URL). */
const JIT_REF_URLS = {
  DK1G135M0055:
    "https://justintime.in/products/dkny-everyday-men-quartz-black-dial-analog-stainless-steel-watch-dk1g135m0055",
  DK1L024M0135:
    "https://justintime.in/products/dkny-eastside-mini-women-quartz-silver-dial-analog-stainless-steel-watch-dk1l024m0135",
  DK1L029M0055:
    "https://justintime.in/products/dkny-nolita-midi-women-quartz-silver-dial-analog-stainless-steel-watch-dk1l029m0055",
  DK1L105M0065:
    "https://justintime.in/products/dkny-evening-women-quartz-dark-green-dial-analog-stainless-steel-watch-dk1l105m0065",
};

/** Official PDPs when discoverable (compact → URL). */
const REF_URLS = {};

function normalizeSku(raw) {
  const original = String(raw || "").trim();
  const compact = original.toUpperCase().replace(/[.\-_\s]/g, "");
  const styleCandidates = [...new Set([compact, original].filter(Boolean))];
  return {
    compact,
    ims: compact,
    style: compact,
    original,
    typoFrom: null,
    nearMatchMethod: null,
    styleCandidates,
  };
}

function skuMatchKeys(raw) {
  const n = normalizeSku(raw);
  return [
    ...new Set(
      n.styleCandidates.map((s) =>
        String(s)
          .toUpperCase()
          .replace(/[.\-_\s]/g, "")
      )
    ),
  ];
}

function polishRetailerProduct(product, normalized) {
  if (!product || product.status !== "ok") return product;
  product.brand = BRAND;
  product.sku = normalized.compact;
  if (!product.officialSku) product.officialSku = normalized.compact;

  let title = String(product.title || "").trim();
  title = title.replace(/^DKNY\b/i, BRAND).trim();
  if (title && !new RegExp(`^${BRAND}\\b`, "i").test(title)) {
    title = `${BRAND} ${title}`;
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
    preset: options.preset || "jit_first",
    styleCandidates: normalized.styleCandidates,
    justInTimeUrl:
      options.justInTimeUrl ||
      options.jitUrl ||
      JIT_REF_URLS[normalized.compact] ||
      null,
    justInTimeRefUrls: {
      ...JUSTINTIME_REF_URLS,
      ...JIT_REF_URLS,
      ...(options.justInTimeRefUrls || {}),
      ...(options.jitRefUrls || {}),
    },
    fixtureDir:
      options.fixtureDir || path.join(__dirname, "..", "fixtures"),
  });
  if (!product) return null;
  return polishRetailerProduct(product, normalized);
}

async function enrichSku(sku, options = {}) {
  const normalized = normalizeSku(sku);

  if (
    options.collectiveOnly ||
    options.tataCliqOnly ||
    options.tgtLuxeOnly ||
    options.ethosOnly ||
    options.justInTimeOnly ||
    options.jitOnly
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

  if (options.officialUrl || options.htmlPath) {
    return recoverAfterOfficialMiss(
      sku,
      {
        code: "not_found",
        reason: "Official PDP not scraped; using India retailer chain",
        brand: BRAND,
        sku: normalized.compact,
        source: SOURCE_OFFICIAL,
        sourceUrl: options.officialUrl || null,
      },
      {
        ...options,
        brand: BRAND,
        brandHint: BRAND,
        sku: normalized.compact,
        preset: "jit_first",
        styleCandidates: normalized.styleCandidates,
        justInTimeUrl:
          options.justInTimeUrl ||
          options.jitUrl ||
          JIT_REF_URLS[normalized.compact] ||
          null,
        justInTimeRefUrls: {
          ...JUSTINTIME_REF_URLS,
          ...JIT_REF_URLS,
          ...(options.justInTimeRefUrls || {}),
        },
        softMissHint: SOFT_MISS_HINT,
        sourceOfficial: SOURCE_OFFICIAL,
        fixtureDir:
          options.fixtureDir || path.join(__dirname, "..", "fixtures"),
      }
    ).then((product) => polishRetailerProduct(product, normalized));
  }

  if (!options.skipRetailerFallback) {
    const retailer = await enrichFromRetailerFallback(sku, options);
    if (retailer && retailer.status === "ok") {
      if (options.delayMs) await sleep(options.delayMs);
      return retailer;
    }
  }

  return {
    status: "not_found",
    sku: normalized.compact,
    brand: BRAND,
    source: SOURCE_OFFICIAL,
    reason: SOFT_MISS_HINT,
    sourceUrl: null,
    scrapedAt: new Date().toISOString(),
  };
}

module.exports = {
  BRAND,
  SITE_ORIGIN,
  SOURCE_OFFICIAL,
  SOURCE_COLLECTIVE,
  SOURCE_TATA,
  SOURCE_TGT,
  SOURCE_ETHOS,
  SOURCE_JUSTINTIME,
  REF_URLS,
  JIT_REF_URLS,
  normalizeSku,
  skuMatchKeys,
  polishRetailerProduct,
  enrichFromRetailerFallback,
  enrichSku,
};
