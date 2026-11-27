#!/usr/bin/env node
"use strict";

/**
 * Retailer image branding audit (hard gate).
 *
 * POLICY: Images from JIT / Helios / Watch Factory / Collective / Tata / Ethos /
 * TGT / any non-official retailerFallback source must pass this filter BEFORE
 * writing to Product.images, batch products.json, or migrate recover galleries.
 *
 * Fail-safe: drop certificate / retailer-logo authenticity slides; keep product photos.
 *
 * Detection:
 *   1. URL / filename / alt heuristics (Certificate, Just_In_Time, Fossil_Certificate, …)
 *   2. Optional 8×8 greyscale hashes of known JIT cert templates (raw + Spaces pipeline)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** Certificate / retailer authenticity slides — URL, path, or alt text */
const RETAILER_BRANDING_IMAGE_RE =
  /certificate|authenticity|guaranteed[_-]?authentic|authorised[_-]?seller|authorized[_-]?seller|just[_-]?in[_-]?time|justintime\.in|[_-]jit[_-]|fossil_certificate|timex_certificate|casio_certificate|alba_certificate|dkny[_-]?certificate|philip[-_]?plein_certificate|emporio[-_]?armani_certificate|certificate_of_authenticity|100%[_-]?genuine|genuine[_-]?product|titan[_-]?trust|buy[_-]?with[_-]?titan|secure[_-]?payment|helios[_-]?(?:logo|badge|trust)|trust[_-]?badge/i;

/**
 * Softer tokens applied only to the **last** gallery slot.
 * Retailer certificates (JIT / Helios / …) are usually the last picture.
 */
const LAST_SLOT_SOFT_CERT_RE =
  /certificate|authenticity|guaranteed|authori[sz]ed|genuine|trust[_-]?badge|coa(?:[_-]|$)|warranty[_-]?card|dkny[_-]?cert|_cert(?:ificate)?(?:[_-]|$)/i;

const DEFAULT_HASHES_PATH = path.join(
  __dirname,
  "../output/retailer-cert-strip/known-hashes.json"
);

let _hashSet = null;

function isRetailerBrandingUrl(url, alt = "") {
  const u = String(url || "");
  const a = String(alt || "");
  return RETAILER_BRANDING_IMAGE_RE.test(u) || RETAILER_BRANDING_IMAGE_RE.test(a);
}

/** True when the last gallery image looks like a cert (soft tokens). */
function isLastSlotLikelyCert(url, alt = "") {
  const blob = `${url || ""} ${alt || ""}`;
  return LAST_SLOT_SOFT_CERT_RE.test(blob);
}

function loadKnownCertHashes(hashesPath = DEFAULT_HASHES_PATH) {
  if (_hashSet) return _hashSet;
  _hashSet = new Set();
  try {
    if (fs.existsSync(hashesPath)) {
      const data = JSON.parse(fs.readFileSync(hashesPath, "utf8"));
      for (const h of data.hashes || []) {
        if (h) _hashSet.add(String(h));
      }
    }
  } catch {
    /* empty set — URL heuristics still apply */
  }
  return _hashSet;
}

function resetHashCache() {
  _hashSet = null;
}

async function imgHash8(buf, sharp) {
  const raw = await sharp(buf, { failOn: "none" })
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  return crypto.createHash("md5").update(raw).digest("hex").slice(0, 12);
}

function resolveSharp() {
  try {
    return require("sharp");
  } catch {
    try {
      const { createRequire } = require("module");
      const backendRequire = createRequire(
        path.join(__dirname, "../../../backend/package.json")
      );
      return backendRequire("sharp");
    } catch {
      return null;
    }
  }
}

/**
 * Sync filter — URL/alt only (use at scrape / batch write time).
 * @returns {{ kept: string[], dropped: { url: string, reason: string }[] }}
 */
function filterRetailerBrandingUrls(urls, options = {}) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  const list = (urls || [])
    .map((raw) => String(raw || "").trim())
    .filter(Boolean);
  const lastKey =
    list.length >= 2 ? list[list.length - 1].split("?")[0] : null;
  for (const url of list) {
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    const alt = options.alts && (options.alts[url] || options.alts[key]);
    if (isRetailerBrandingUrl(url, alt)) {
      dropped.push({ url, reason: "url_heuristic" });
      continue;
    }
    // Bias: last picture in watch galleries is often the retailer certificate
    if (
      options.skipLastSlotSoft !== true &&
      lastKey &&
      key === lastKey &&
      isLastSlotLikelyCert(url, alt)
    ) {
      dropped.push({ url, reason: "last_slot_soft" });
      continue;
    }
    kept.push(url);
  }
  return { kept, dropped };
}

/**
 * Async filter — URL heuristics + optional perceptual hash against known certs.
 * Pass `fetchBuffer(url) => Buffer` to enable hash checks (fail-safe: keep on fetch error).
 */
async function filterRetailerBrandingImages(urls, options = {}) {
  const sharp = options.sharp || resolveSharp();
  const hashes = options.skipHash
    ? new Set()
    : options.hashes || loadKnownCertHashes(options.hashesPath);
  const fetchBuffer = options.fetchBuffer || null;
  const { kept: urlKept, dropped } = filterRetailerBrandingUrls(urls, options);
  if (!fetchBuffer || !sharp || !hashes.size) {
    return { kept: urlKept, dropped };
  }

  const kept = [];
  for (const url of urlKept) {
    try {
      const buf = await fetchBuffer(url);
      if (buf && buf.length) {
        const h = await imgHash8(buf, sharp);
        if (hashes.has(h)) {
          dropped.push({ url, reason: `hash:${h}` });
          continue;
        }
      }
    } catch {
      /* fail-safe: keep product photo if probe fails */
    }
    kept.push(url);
  }
  return { kept, dropped };
}

/**
 * Mutate an enrichment product in place: strip branding slides from images[].
 * Adds warning `retailer_branding_images_stripped` when anything dropped.
 */
function auditProductImages(product, options = {}) {
  if (!product || typeof product !== "object") return product;
  const before = Array.isArray(product.images) ? product.images : [];
  const { kept, dropped } = filterRetailerBrandingUrls(before, options);
  if (dropped.length) {
    product.images = kept;
    product.warnings = product.warnings || [];
    if (!product.warnings.includes("retailer_branding_images_stripped")) {
      product.warnings.push("retailer_branding_images_stripped");
    }
    product.extras = product.extras || {};
    product.extras.brandingDropped = dropped.map((d) => ({
      reason: d.reason,
      url: String(d.url || "").slice(0, 160),
    }));
  }
  return product;
}

module.exports = {
  RETAILER_BRANDING_IMAGE_RE,
  LAST_SLOT_SOFT_CERT_RE,
  isRetailerBrandingUrl,
  isLastSlotLikelyCert,
  loadKnownCertHashes,
  resetHashCache,
  filterRetailerBrandingUrls,
  filterRetailerBrandingImages,
  auditProductImages,
  imgHash8,
};
