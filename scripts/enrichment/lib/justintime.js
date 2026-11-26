"use strict";

/**
 * Just In Time (justintime.in) Shopify helpers — India retailer fallback.
 * Especially useful for Casio India codes (ED676, A2474) where official
 * casio.com is CF/Akamai-blocked for Node.
 *
 * Discovery: REF_URLS → /search/suggest.json → /products/{handle}.json
 * Handles slug patterns like …-ed676-efr-539de-8avudf.
 */

const path = require("path");
const fs = require("fs");
const { fetchText, sleep } = require("./http");
const {
  normalizeProductFields,
  normalizeCaseSize,
  normalizeDialColor,
  normalizeCaseMaterial,
  normalizeStrapMaterial,
  normalizeMovement,
  normalizeCaseShape,
  normalizeGender,
  normalizeStrapColor,
  normalizeWaterResistance,
} = require("./normalize");

const JIT_ORIGIN = "https://justintime.in";
const SOURCE_ID = "justintime";

/** Known Just In Time PDPs (compact India code / model → URL). */
const REF_URLS = {
  ED676:
    "https://justintime.in/products/casio-edifice-men-quartz-grey-dial-chronograph-stainless-steel-watch-ed676-efr-539de-8avudf",
  "EFR-539DE-8AV":
    "https://justintime.in/products/casio-edifice-men-quartz-grey-dial-chronograph-stainless-steel-watch-ed676-efr-539de-8avudf",
  "EFR-539DE-8AVUDF":
    "https://justintime.in/products/casio-edifice-men-quartz-grey-dial-chronograph-stainless-steel-watch-ed676-efr-539de-8avudf",
  PWPUA0925:
    "https://justintime.in/products/the-hexagon-phantom-men-quartz-silver-dial-analog-stainless-steel-watch-pwpua0925",
  PWPUA1025:
    "https://justintime.in/products/the-hexagon-phantom-men-quartz-black-dial-analog-stainless-steel-watch-pwpua1025",
  // IMS uses digit 0; JIT lists letter O
  PW0AA0722:
    "https://justintime.in/products/philipp-plein-men-quartz-blue-dial-analog-stainless-steel-watch-pwoaa0722",
  PWOAA0722:
    "https://justintime.in/products/philipp-plein-men-quartz-blue-dial-analog-stainless-steel-watch-pwoaa0722",
};

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

function absUrl(url, base = JIT_ORIGIN) {
  if (!url) return "";
  const raw = String(url).trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, base).href.split("#")[0].split("?")[0];
  } catch {
    return raw;
  }
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pdpUrlFromHandle(handle) {
  const h = String(handle || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!h) return null;
  return `${JIT_ORIGIN}/products/${h}`;
}

function productJsonUrl(handleOrUrl) {
  const raw = String(handleOrUrl || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const u = absUrl(raw);
    const m = u.match(/\/products\/([^/?#]+)/i);
    if (!m) return null;
    return `${JIT_ORIGIN}/products/${m[1]}.json`;
  }
  return `${JIT_ORIGIN}/products/${raw.replace(/^\/+|\/+$/g, "")}.json`;
}

function normalizeJitUrl(urlOrHandle) {
  const raw = String(urlOrHandle || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const u = absUrl(raw);
    const m = u.match(/\/products\/([^/?#]+)/i);
    if (m) return pdpUrlFromHandle(m[1]);
    return u;
  }
  if (raw.startsWith("/products/")) return absUrl(raw);
  if (/^[a-z0-9][a-z0-9-]*$/i.test(raw)) return pdpUrlFromHandle(raw);
  return null;
}

function resolveRefUrl(compact, options = {}) {
  return (
    options.justInTimeUrl ||
    options.jitUrl ||
    (options.justInTimeRefUrls && options.justInTimeRefUrls[compact]) ||
    (options.jitRefUrls && options.jitRefUrls[compact]) ||
    REF_URLS[compact] ||
    null
  );
}

async function suggestBySku(sku, options = {}) {
  const compact = compactSku(sku);
  if (!compact) return null;
  const q = encodeURIComponent(compact);
  const suggestUrl =
    `${JIT_ORIGIN}/search/suggest.json?q=${q}` +
    "&resources%5Btype%5D=product&resources%5Blimit%5D=10";
  try {
    const res = await fetchText(suggestUrl, {
      timeoutMs: options.timeoutMs || 20000,
      headers: { Accept: "application/json" },
    });
    if (!res.ok || !res.text) return null;
    const data = JSON.parse(res.text);
    const products =
      data?.resources?.results?.products ||
      data?.resources?.products ||
      [];
    const hayCompact = (p) =>
      `${p.handle || ""} ${p.title || ""} ${p.url || ""}`
        .toUpperCase()
        .replace(/[.\-_\s]/g, "");
    const hit =
      products.find((p) => hayCompact(p).includes(compact)) ||
      products.find((p) =>
        String(p.handle || "")
          .toLowerCase()
          .includes(String(sku).toLowerCase())
      ) ||
      null;
    if (hit?.handle) {
      return { url: pdpUrlFromHandle(hit.handle), via: "suggest" };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function zeroOhAliases(compact) {
  const c = compactSku(compact);
  if (!c) return [];
  const out = new Set([c]);
  if (/0/.test(c)) out.add(c.replace(/0/g, "O"));
  if (/O/.test(c)) out.add(c.replace(/O/g, "0"));
  return [...out];
}

async function resolveJustInTimeUrlBySku(sku, options = {}) {
  const compact = compactSku(sku);
  const ref = resolveRefUrl(compact, options);
  if (ref) return { url: normalizeJitUrl(ref), via: "ref_url" };

  // Also try model aliases from options (+ 0/O variants for Plein-style refs)
  const aliases = [
    options.model,
    options.officialSku,
    ...(options.styleCandidates || []),
    ...zeroOhAliases(compact),
  ]
    .filter(Boolean)
    .map(compactSku);
  for (const a of [...new Set(aliases)]) {
    const r = REF_URLS[a] || resolveRefUrl(a, options);
    if (r) return { url: normalizeJitUrl(r), via: "ref_alias" };
  }

  if (options.resolveBySku === false) return null;
  for (const q of [...new Set([sku, compact, ...zeroOhAliases(compact)])]) {
    const suggested = await suggestBySku(q, options);
    if (suggested?.url) return suggested;
    await sleep(options.delayMs || 150);
  }
  return null;
}

async function fetchJustInTimeProductJson(pdpUrl, options = {}) {
  const jsonUrl = productJsonUrl(pdpUrl);
  if (!jsonUrl) {
    throw Object.assign(new Error("justintime: invalid PDP URL"), {
      code: "not_found",
    });
  }
  const res = await fetchText(jsonUrl, {
    timeoutMs: options.timeoutMs || 25000,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !res.text) {
    throw Object.assign(
      new Error(`justintime: product JSON HTTP ${res.status || 0}`),
      { code: "fetch_failed", sourceUrl: pdpUrl }
    );
  }
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw Object.assign(new Error("justintime: invalid JSON"), {
      code: "fetch_failed",
      sourceUrl: pdpUrl,
    });
  }
  const product = data.product || data;
  if (!product || !product.handle) {
    throw Object.assign(new Error("justintime: product missing"), {
      code: "not_found",
      sourceUrl: pdpUrl,
    });
  }
  return {
    product,
    sourceUrl: pdpUrlFromHandle(product.handle) || normalizeJitUrl(pdpUrl),
  };
}

function extractImagesFromProductJson(product) {
  const urls = [];
  const seen = new Set();
  const push = (raw) => {
    if (!raw) return;
    let u = String(raw).split("?")[0].trim();
    u = absUrl(u);
    if (!/\.(jpe?g|png|webp)$/i.test(u)) return;
    if (/logo|icon|sprite|banner|favicon/i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };
  if (product.image?.src) push(product.image.src);
  for (const img of product.images || []) push(img.src);
  return urls.slice(0, 12);
}

function extractShopifyAttrs(bodyHtml) {
  const attrs = {};
  const html = String(bodyHtml || "");
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html))) {
    const text = stripTags(m[1]).replace(/\s+/g, " ").trim();
    const kv = text.match(/^([^:]+?)\s*:\s*(.+)$/);
    if (!kv) continue;
    const label = kv[1].toLowerCase().trim();
    const value = kv[2].trim();
    if (label && value) attrs[label] = value;
  }
  return attrs;
}

/** Pull India code + model from JIT handle/title (…-ed676-efr-539de-8avudf). */
function extractCodesFromHandle(handle, title) {
  const hay = `${handle || ""} ${title || ""}`;
  const india =
    (hay.match(/\b((?:ED|A|D|G|EQ|EF)\d{3,5})\b/i) || [])[1] || "";
  const model =
    (hay.match(
      /\b((?:EFR|MTP|LTP|AE|GA|GW|GBM|EQB|ECB)[\w\-]*\d[\w\-]*)\b/i
    ) || [])[1] || "";
  return {
    indiaCode: india ? india.toUpperCase() : "",
    model: model ? model.toUpperCase().replace(/UDF$/i, "") : "",
  };
}

function mapJustInTimeProduct(shopifyProduct, skuInput, sourceUrl, options = {}) {
  const brandHint = options.brandHint || "Watch";
  const compact = compactSku(skuInput);
  const variant = (shopifyProduct.variants || [])[0] || {};
  const attrs = extractShopifyAttrs(shopifyProduct.body_html);
  const codes = extractCodesFromHandle(
    shopifyProduct.handle,
    shopifyProduct.title
  );
  const officialSku =
    codes.model ||
    String(variant.sku || "").trim().toUpperCase() ||
    compact;
  const title =
    stripTags(shopifyProduct.title || "") ||
    `${brandHint} ${officialSku}`;
  const description = stripTags(shopifyProduct.body_html || "");
  const images = extractImagesFromProductJson(shopifyProduct);
  const priceAmount =
    variant.price != null && variant.price !== ""
      ? Number(variant.price)
      : null;

  const dialColor =
    normalizeDialColor(attrs["dial color"] || attrs["dial colour"] || "") ||
    (/grey|gray/i.test(title) ? "Grey" : "") ||
    (/blue/i.test(title) ? "Blue" : "");
  const movement =
    normalizeMovement(attrs.movement || "") ||
    (/quartz/i.test(`${title} ${description}`) ? "Quartz" : "");
  const gender =
    normalizeGender(attrs.gender || "") ||
    (/women|ladies|lady/i.test(title) ? "Women" : "Men");

  const { product, mapped: fieldMapped, unmapped: fieldUnmapped } =
    normalizeProductFields({
      status: "ok",
      brand: brandHint,
      sku: compact || officialSku,
      officialSku,
      title,
      description,
      caseMaterial:
        normalizeCaseMaterial(attrs["case material"] || "") ||
        (/stainless/i.test(title) ? "Stainless Steel" : ""),
      caseShape: normalizeCaseShape(attrs["case shape"] || "") || "",
      caseSize: normalizeCaseSize(
        attrs["case size"] || attrs["dial size"] || attrs.diameter || ""
      ),
      dialColor,
      waterResistance: normalizeWaterResistance(
        attrs["water resistance"] || attrs.water || ""
      ),
      movement,
      strapMaterial:
        normalizeStrapMaterial(
          attrs["strap material"] || attrs["band material"] || ""
        ) ||
        (/leather/i.test(title) ? "Leather" : "") ||
        (/stainless|steel/i.test(title) ? "Stainless Steel" : ""),
      strapColor: normalizeStrapColor(
        attrs["strap color"] || attrs["band color"] || ""
      ),
      gender,
      warrantyPeriod: attrs.warranty || "2 years",
      category: /edifice|chronograph/i.test(title) ? "Chronograph" : "Analog",
      price: null,
      oldPrice: null,
      priceSource:
        priceAmount != null && Number.isFinite(priceAmount)
          ? {
              amount: priceAmount,
              mrp:
                variant.compare_at_price != null &&
                variant.compare_at_price !== ""
                  ? Number(variant.compare_at_price)
                  : null,
              currency: "INR",
              label: `₹${Number(priceAmount).toLocaleString("en-IN")}`,
            }
          : null,
      images,
      sourceUrl:
        sourceUrl || pdpUrlFromHandle(shopifyProduct.handle) || null,
      source: SOURCE_ID,
      scrapedAt: new Date().toISOString(),
      rawAttributes: {
        ...attrs,
        variantSku: variant.sku || "",
        handle: shopifyProduct.handle || "",
        indiaCode: codes.indiaCode,
        modelFromHandle: codes.model,
      },
      extras: {
        handle: shopifyProduct.handle || "",
        indiaCode: codes.indiaCode,
        model: codes.model || officialSku,
        resolveVia: options.resolveVia || "",
      },
    });

  product.fieldMapped = fieldMapped;
  product.fieldUnmapped = fieldUnmapped;
  product.warnings = product.warnings || [];
  if (!product.description || product.description.length < 40) {
    product.warnings.push("description_short_or_missing");
  }
  if (!product.images.length) product.warnings.push("no_sku_images");
  if (codes.indiaCode && codes.indiaCode !== compact) {
    product.warnings.push(`jit_india_code_${codes.indiaCode}`);
  }
  return product;
}

function fixtureJsonPath(fixtureDir, sku) {
  if (!fixtureDir) return null;
  const compact = compactSku(sku);
  const names = [
    `jit-${compact}.json`,
    `justintime-${compact}.json`,
    `${compact}.jit.json`,
  ];
  for (const name of names) {
    const p = path.join(fixtureDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function enrichFromJustInTime(sku, options = {}) {
  const brandHint = options.brandHint || "Watch";
  const compact = compactSku(sku);

  if (options.preferFixture || options.jitJsonPath) {
    const jp =
      options.jitJsonPath ||
      fixtureJsonPath(options.fixtureDir, sku);
    if (jp) {
      const raw = JSON.parse(fs.readFileSync(jp, "utf8"));
      const shopifyProduct = raw.product || raw;
      const sourceUrl =
        options.justInTimeUrl ||
        pdpUrlFromHandle(shopifyProduct.handle) ||
        resolveRefUrl(compact, options);
      const product = mapJustInTimeProduct(
        shopifyProduct,
        sku,
        sourceUrl,
        { ...options, brandHint, resolveVia: "fixture" }
      );
      product.fetchMode = "fixture";
      return product;
    }
  }

  let resolved = null;
  if (options.justInTimeUrl || options.jitUrl) {
    resolved = {
      url: normalizeJitUrl(options.justInTimeUrl || options.jitUrl),
      via: "jit_url",
    };
  } else if (options.resolveBySku !== false) {
    resolved = await resolveJustInTimeUrlBySku(sku, options);
  }

  if (!resolved?.url) {
    return {
      status: "not_found",
      sku: compact,
      brand: brandHint,
      source: SOURCE_ID,
      reason:
        "justintime: no PDP URL (pass justInTimeUrl or enable SKU search)",
      scrapedAt: new Date().toISOString(),
    };
  }

  const { product: shopifyProduct, sourceUrl } =
    await fetchJustInTimeProductJson(resolved.url, options);
  const product = mapJustInTimeProduct(shopifyProduct, sku, sourceUrl, {
    ...options,
    brandHint,
    resolveVia: resolved.via || "",
  });
  product.fetchMode = "live";

  const hay = [
    product.officialSku,
    product.title,
    shopifyProduct.handle,
    shopifyProduct.variants?.[0]?.sku,
    product.extras?.indiaCode,
    product.extras?.model,
  ]
    .join(" ")
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
  const candidateKeys = [
    compact,
    ...zeroOhAliases(compact),
    ...(options.styleCandidates || []).map(compactSku),
  ].filter(Boolean);
  const hayHit = candidateKeys.some((k) => hay.includes(k));
  if (compact && !hayHit) {
    // Model-only match (ED676 page when searching EFR-539DE-8AV)
    const modelKey = compactSku(product.officialSku);
    if (!modelKey || !hay.includes(modelKey)) {
      return {
        status: "not_found",
        sku: compact,
        brand: brandHint,
        source: SOURCE_ID,
        reason: "SKU not present on Just In Time product",
        sourceUrl,
        scrapedAt: new Date().toISOString(),
      };
    }
  }
  // Preserve IMS compact SKU when JIT lists O/0 variant
  product.sku = compact || product.sku;
  if (
    compact &&
    product.officialSku &&
    compactSku(product.officialSku) !== compact &&
    zeroOhAliases(compact).includes(compactSku(product.officialSku))
  ) {
    product.warnings = product.warnings || [];
    product.warnings.push(
      `jit_near_match_${compactSku(product.officialSku)}`
    );
    product.typoFrom = compact;
    product.matchedStyle = compactSku(product.officialSku);
    product.nearMatchMethod = "zero_oh";
  }

  if (options.delayMs) await sleep(options.delayMs);
  return product;
}

module.exports = {
  JIT_ORIGIN,
  SOURCE_ID,
  REF_URLS,
  compactSku,
  zeroOhAliases,
  normalizeJitUrl,
  pdpUrlFromHandle,
  productJsonUrl,
  suggestBySku,
  resolveJustInTimeUrlBySku,
  fetchJustInTimeProductJson,
  mapJustInTimeProduct,
  enrichFromJustInTime,
  extractCodesFromHandle,
};
