"use strict";

/**
 * Alba India Shopify (alba-watches.co.in).
 *
 * Seiko sub-brand India store. Handles like `{sku-lower}-green-dial-…`.
 * Discovery: REF / URL → suggest.json → handle guess → products.json catalog.
 */

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

const ALBA_IN_ORIGIN = "https://alba-watches.co.in";
const SOURCE_ID = "alba-in";

/** @type {Map<string, {handle: string, title: string, sku: string}>|null} */
let catalogCache = null;
let catalogCachePromise = null;

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

function absUrl(url, base = ALBA_IN_ORIGIN) {
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
  return `${ALBA_IN_ORIGIN}/products/${h}`;
}

function productJsonUrl(handleOrUrl) {
  const raw = String(handleOrUrl || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const u = absUrl(raw);
    const m = u.match(/\/products\/([^/?#]+)/i);
    if (!m) return null;
    return `${ALBA_IN_ORIGIN}/products/${m[1]}.json`;
  }
  return `${ALBA_IN_ORIGIN}/products/${raw.replace(/^\/+|\/+$/g, "")}.json`;
}

function normalizeAlbaInUrl(urlOrHandle) {
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

function pushImage(urls, seen, raw) {
  if (!raw) return;
  let u = String(raw).split("?")[0].trim();
  u = absUrl(u);
  if (!/\.(jpe?g|png|webp)$/i.test(u)) return;
  if (/logo|icon|sprite|banner|favicon/i.test(u)) return;
  if (seen.has(u)) return;
  seen.add(u);
  urls.push(u);
}

function extractImagesForVariant(product, variant) {
  const urls = [];
  const seen = new Set();
  const featured =
    variant?.featured_image?.src ||
    (typeof variant?.featured_image === "string"
      ? variant.featured_image
      : null);
  pushImage(urls, seen, featured);

  const variantId = variant?.id;
  const images = Array.isArray(product?.images) ? product.images : [];
  for (const img of images) {
    if (typeof img === "string") {
      pushImage(urls, seen, img);
      continue;
    }
    const vids = img?.variant_ids || [];
    if (
      variantId &&
      Array.isArray(vids) &&
      vids.length &&
      !vids.includes(variantId)
    ) {
      continue;
    }
    pushImage(urls, seen, img?.src);
  }
  // If variant-filtered gallery was empty aside from featured, take full gallery
  if (urls.length <= 1) {
    for (const img of images) {
      pushImage(urls, seen, typeof img === "string" ? img : img?.src);
    }
  }
  if (!urls.length && product?.image?.src) {
    pushImage(urls, seen, product.image.src);
  }
  return urls.slice(0, 12);
}

function pickVariant(shopifyProduct, compact) {
  const variants = shopifyProduct?.variants || [];
  if (!variants.length) return {};
  const hit =
    variants.find((v) => compactSku(v.sku) === compact) ||
    variants.find((v) =>
      compactSku(`${v.sku || ""} ${v.title || ""}`).includes(compact)
    ) ||
    null;
  return hit || variants[0] || {};
}

function inferFromTitle(title, handle) {
  const hay = `${title || ""} ${handle || ""}`.toLowerCase();
  let gender = "";
  if (/\bwomen|ladies|lady|womens\b/i.test(hay)) gender = "Women";
  else if (/\bmen|mens|male\b/i.test(hay)) gender = "Men";

  let movement = "";
  if (/\bautomatic\b/i.test(hay)) movement = "Automatic";
  else if (/\bquartz\b/i.test(hay)) movement = "Quartz";
  else if (/\bchronograph\b/i.test(hay)) movement = "Quartz";

  const sizeM = hay.match(/\b(\d{2})\s*mm\b/i);
  const caseSize = sizeM ? `${sizeM[1]} mm` : "";

  let dialColor = "";
  const dialM = hay.match(
    /\b(black|blue|white|silver|green|gold|brown|grey|gray|champagne|rose\s*gold)\b/i
  );
  if (dialM) dialColor = dialM[1];

  return { gender, movement, caseSize, dialColor };
}

function skuInHaystack(sku, ...parts) {
  const compact = compactSku(sku);
  if (!compact) return false;
  const hay = compactSku(parts.filter(Boolean).join(" "));
  return hay.includes(compact);
}

async function suggestBySku(sku, options = {}) {
  const compact = compactSku(sku);
  if (!compact) return null;
  const suggestUrl =
    `${ALBA_IN_ORIGIN}/search/suggest.json?q=${encodeURIComponent(compact)}` +
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
    for (const p of products) {
      if (skuInHaystack(compact, p.title, p.handle, p.url)) {
        return {
          url: pdpUrlFromHandle(p.handle),
          handle: p.handle,
          via: "alba_in_suggest",
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function loadCatalogIndex(options = {}) {
  if (catalogCache) return catalogCache;
  if (catalogCachePromise) return catalogCachePromise;

  catalogCachePromise = (async () => {
    const bySku = new Map();
    for (let page = 1; page <= 20; page++) {
      const url = `${ALBA_IN_ORIGIN}/products.json?limit=250&page=${page}`;
      try {
        const res = await fetchText(url, {
          timeoutMs: options.timeoutMs || 30000,
          headers: { Accept: "application/json" },
        });
        if (!res.ok || !res.text) break;
        const data = JSON.parse(res.text);
        const products = data.products || [];
        if (!products.length) break;
        for (const p of products) {
          const handle = String(p.handle || "");
          const title = String(p.title || "");
          for (const v of p.variants || []) {
            const variantSku = compactSku(v.sku || "");
            if (!variantSku) continue;
            if (!bySku.has(variantSku)) {
              bySku.set(variantSku, {
                handle,
                title,
                sku: variantSku,
              });
            }
          }
          // Handle often starts with sku-lower-
          const handleSku = handle.match(/^([a-z0-9]+)-/i);
          if (handleSku) {
            const k = compactSku(handleSku[1]);
            if (k && !bySku.has(k)) {
              bySku.set(k, { handle, title, sku: k });
            }
          }
        }
        if (products.length < 250) break;
      } catch {
        break;
      }
      if (options.delayMs) await sleep(Math.min(options.delayMs, 200));
    }
    catalogCache = bySku;
    return bySku;
  })();

  try {
    return await catalogCachePromise;
  } finally {
    catalogCachePromise = null;
  }
}

async function resolveAlbaInUrlBySku(sku, options = {}) {
  const compact = compactSku(sku);
  if (!compact) return null;

  const forced =
    options.albaInUrl ||
    options.officialIndiaUrl ||
    options.officialUrl ||
    null;
  if (forced) {
    const url = normalizeAlbaInUrl(forced);
    if (url) {
      return {
        url,
        handle: url.split("/products/")[1],
        via: "alba_in_url",
      };
    }
  }

  if (options.refUrls && options.refUrls[compact]) {
    const url = normalizeAlbaInUrl(options.refUrls[compact]);
    if (url) return { url, handle: url.split("/products/")[1], via: "ref_url" };
  }

  const suggested = await suggestBySku(sku, options);
  if (suggested) return suggested;

  // Direct handle guesses
  const guesses = [
    String(compact).toLowerCase(),
    `alba-${String(compact).toLowerCase()}`,
  ];
  for (const handle of guesses) {
    const probe = productJsonUrl(handle);
    try {
      const res = await fetchText(probe, {
        timeoutMs: options.timeoutMs || 15000,
        headers: { Accept: "application/json" },
      });
      if (res.ok && res.text && /"product"\s*:/.test(res.text)) {
        return { url: pdpUrlFromHandle(handle), handle, via: "handle_guess" };
      }
    } catch {
      /* next */
    }
  }

  try {
    const catalog = await loadCatalogIndex(options);
    const hit = catalog.get(compact);
    if (hit?.handle) {
      return {
        url: pdpUrlFromHandle(hit.handle),
        handle: hit.handle,
        via: "alba_in_catalog",
      };
    }
  } catch {
    /* ignore */
  }

  return null;
}

async function fetchAlbaInProductJson(urlOrHandle, options = {}) {
  const pdp = normalizeAlbaInUrl(urlOrHandle);
  if (!pdp) {
    throw Object.assign(new Error("alba-watches.co.in: missing URL"), {
      code: "not_found",
    });
  }
  const m = pdp.match(/\/products\/([^/?#]+)/i);
  if (!m) {
    throw Object.assign(
      new Error(`alba-watches.co.in: not a product URL: ${pdp}`),
      { code: "not_found" }
    );
  }
  const handle = m[1];
  const jsonUrl = productJsonUrl(handle);
  const res = await fetchText(jsonUrl, {
    timeoutMs: options.timeoutMs || 30000,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !res.text) {
    throw Object.assign(
      new Error(
        `alba-watches.co.in fetch_failed: HTTP ${res.status || "?"} for ${jsonUrl}`
      ),
      { code: "fetch_failed", sourceUrl: pdp }
    );
  }
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw Object.assign(
      new Error(`alba-watches.co.in not_found: invalid JSON at ${jsonUrl}`),
      { code: "not_found", sourceUrl: pdp }
    );
  }
  const product = data && data.product;
  if (!product || !product.handle) {
    throw Object.assign(
      new Error(
        `alba-watches.co.in not_found: no product payload at ${jsonUrl}`
      ),
      { code: "not_found", sourceUrl: pdp }
    );
  }
  return {
    product,
    sourceUrl: pdpUrlFromHandle(product.handle) || pdp,
    handle: product.handle,
  };
}

function mapAlbaInProduct(shopifyProduct, skuInput, sourceUrl, options = {}) {
  const brandHint = options.brandHint || "Alba";
  const compact = compactSku(skuInput);
  const variant = pickVariant(shopifyProduct, compact);
  const attrs = extractShopifyAttrs(shopifyProduct.body_html || "");
  const inferred = inferFromTitle(
    shopifyProduct.title,
    shopifyProduct.handle
  );
  const variantSku = compactSku(variant.sku || "");
  const officialSku = variantSku || compact;

  let title = stripTags(shopifyProduct.title || "");
  // Prefer SKU-prefixed title when Cosmic-style shared title
  if (
    variant.title &&
    variant.title !== "Default Title" &&
    !skuInHaystack(compact, title)
  ) {
    title = `${brandHint} ${variant.title} ${officialSku}`.trim();
  } else if (title && !new RegExp(`^${brandHint}\\b`, "i").test(title)) {
    if (!skuInHaystack(compact, title)) {
      title = `${brandHint} ${title}`.trim();
    } else if (!/^Alba\b/i.test(title)) {
      title = `${brandHint} ${title}`.replace(
        new RegExp(`^${compact}\\b`, "i"),
        `${brandHint} ${compact}`
      );
    }
  }
  if (!title) title = `${brandHint} ${officialSku}`;

  let description = stripTags(shopifyProduct.body_html || "");
  if (description.length < 40) {
    description = [
      title,
      inferred.movement && `${inferred.movement} movement`,
      inferred.caseSize && `${inferred.caseSize} case`,
      inferred.gender,
    ]
      .filter(Boolean)
      .join(". ");
  }

  const images = extractImagesForVariant(shopifyProduct, variant);
  const priceAmount =
    variant.price != null && variant.price !== ""
      ? Number(variant.price)
      : null;

  const { product, mapped: fieldMapped, unmapped: fieldUnmapped } =
    normalizeProductFields({
      status: "ok",
      brand: brandHint,
      sku: compact || officialSku,
      officialSku,
      title,
      description,
      caseMaterial:
        normalizeCaseMaterial(attrs["case material"] || "") || "",
      caseShape: normalizeCaseShape(attrs["case shape"] || "") || "",
      caseSize:
        normalizeCaseSize(
          attrs["case size"] || attrs["dial size"] || attrs.diameter || ""
        ) ||
        normalizeCaseSize(inferred.caseSize) ||
        "",
      dialColor:
        normalizeDialColor(
          attrs["dial color"] || attrs["dial colour"] || ""
        ) ||
        normalizeDialColor(inferred.dialColor) ||
        "",
      waterResistance: normalizeWaterResistance(
        attrs["water resistance"] || attrs.water || ""
      ),
      movement:
        normalizeMovement(attrs.movement || "") || inferred.movement || "",
      strapMaterial: normalizeStrapMaterial(
        attrs["strap material"] || attrs["band material"] || ""
      ),
      strapColor: normalizeStrapColor(
        attrs["strap color"] || attrs["band color"] || ""
      ),
      gender:
        normalizeGender(attrs.gender || "") || inferred.gender || "",
      warrantyPeriod: attrs.warranty || "",
      category: /chronograph/i.test(title) ? "Chronograph" : "",
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
        variantTitle: variant.title || "",
        handle: shopifyProduct.handle || "",
      },
      extras: {
        handle: shopifyProduct.handle || "",
        resolveVia: options.resolveVia || "",
        shopifyProductId: shopifyProduct.id || "",
        variantId: variant.id || "",
      },
    });

  product.fieldMapped = fieldMapped;
  product.fieldUnmapped = fieldUnmapped;
  product.warnings = product.warnings || [];
  if (!product.description || product.description.length < 40) {
    product.warnings.push("description_short_or_missing");
  }
  if (!product.images.length) product.warnings.push("no_sku_images");
  product.warnings.push("india_shopify_alba_watches_co_in");
  return product;
}

async function enrichFromAlbaIn(sku, options = {}) {
  const brandHint = options.brandHint || "Alba";
  const compact = compactSku(sku);

  let resolved = null;
  if (options.resolveBySku !== false) {
    resolved = await resolveAlbaInUrlBySku(sku, options);
  }

  if (!resolved?.url) {
    return {
      status: "not_found",
      sku: compact,
      brand: brandHint,
      source: SOURCE_ID,
      reason: "alba-watches.co.in: no PDP for SKU",
      scrapedAt: new Date().toISOString(),
    };
  }

  const { product: shopifyProduct, sourceUrl } = await fetchAlbaInProductJson(
    resolved.url,
    options
  );
  const product = mapAlbaInProduct(shopifyProduct, sku, sourceUrl, {
    ...options,
    brandHint,
    resolveVia: resolved.via || "",
  });
  product.fetchMode = "live";

  const variantSkus = (shopifyProduct.variants || []).map((v) =>
    compactSku(v.sku)
  );
  const hay = [
    product.officialSku,
    product.title,
    shopifyProduct.handle,
    ...variantSkus,
  ]
    .join(" ")
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
  if (compact && !hay.includes(compact)) {
    return {
      status: "not_found",
      sku: compact,
      brand: brandHint,
      source: SOURCE_ID,
      reason: "SKU not present on alba-watches.co.in product",
      sourceUrl,
      scrapedAt: new Date().toISOString(),
    };
  }

  product.sku = compact || product.sku;
  if (options.delayMs) await sleep(options.delayMs);
  return product;
}

module.exports = {
  ALBA_IN_ORIGIN,
  SOURCE_ID,
  compactSku,
  normalizeAlbaInUrl,
  pdpUrlFromHandle,
  productJsonUrl,
  suggestBySku,
  resolveAlbaInUrlBySku,
  fetchAlbaInProductJson,
  mapAlbaInProduct,
  enrichFromAlbaIn,
  loadCatalogIndex,
};
