"use strict";

/**
 * Helios Watch Store (helioswatchstore.com) — miss-recovery retailer fallback.
 *
 * SFCC / Demandware PDPs (Titan master catalog). Live Node often hits
 * Cloudflare 403 — prefer REF_URLS / fixtures/helios-{SKU}.html, then fall
 * through to Just In Time for downloadable CDN images.
 *
 * Gallery: dw/image/.../Catalog/{brand}/{SKU}_{n}.jpg — product angles + brand
 * packaging box are kept; trust/genuine badge assets are stripped via
 * retailerImageHygiene.
 */

const fs = require("fs");
const path = require("path");
const { fetchText, fetchBuffer, sleep } = require("./http");
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
const { isRetailerBrandingUrl } = require("./retailerImageHygiene");

const HELIOS_ORIGIN = "https://www.helioswatchstore.com";
const SOURCE_ID = "helios";

/** Known Helios PDPs (compact SKU → URL). */
const REF_URLS = {
  AX2194:
    "https://www.helioswatchstore.com/armani-exchange-men-hampton-round-grey-watches-ax2194.html",
  // Add more as Helios PDPs are confirmed (Node live fetch often CF-blocked)
};

function compactSku(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_\s]/g, "");
}

function absUrl(url, base = HELIOS_ORIGIN) {
  if (!url) return "";
  const raw = String(url).trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, base).href.split("#")[0];
  } catch {
    return raw;
  }
}

function decodeEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function match1(html, re) {
  const m = String(html || "").match(re);
  return m ? decodeEntities(m[1].trim()) : "";
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function normalizeHeliosUrl(urlOrPath) {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return absUrl(raw).split("?")[0];
  if (raw.startsWith("/")) return absUrl(raw).split("?")[0];
  if (/^[a-z0-9-]+\.html$/i.test(raw)) return absUrl(`/${raw}`);
  return null;
}

function isCloudflareChallenge(html, status) {
  if (status === 403 || status === 503) return true;
  const text = String(html || "");
  // Successful Helios PDPs still embed cf challenge-platform scripts — only
  // treat as a wall when the body is the interstitial (no Product payload).
  const hasProductPayload =
    /"@type"\s*:\s*"Product"/i.test(text) ||
    /Helios_Website_Main\/Catalog/i.test(text) ||
    /Sites-titan-master-catalog/i.test(text);
  if (hasProductPayload && text.length > 50000) return false;
  return (
    /Just a moment|cf-browser-verification|Attention Required/i.test(text) ||
    (/challenge-platform/i.test(text) && text.length < 20000)
  );
}

function looksLikeHeliosPdp(html) {
  const text = String(html || "");
  if (isCloudflareChallenge(text)) return false;
  return (
    /"@type"\s*:\s*"Product"/i.test(text) ||
    /Sites-titan-master-catalog|Helios_Website_Main\/Catalog/i.test(text) ||
    (/helioswatchstore/i.test(text) && /product-detail|pdp/i.test(text))
  );
}

function extractJsonLdProducts(html) {
  const out = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        if (!item) continue;
        if (item["@type"] === "Product") out.push(item);
        if (Array.isArray(item["@graph"])) {
          for (const g of item["@graph"]) {
            if (g && g["@type"] === "Product") out.push(g);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function upgradeHeliosImage(url) {
  let u = absUrl(url);
  if (!u) return "";
  // Drop SFCC resize query; migrator / browser can re-add sw/sh
  u = u.split("?")[0];
  return u;
}

/**
 * Keep only gallery assets for this SKU (exclude related-product carousels
 * and Helios/Titan trust / genuine badge art).
 */
function extractHeliosImages(html, sku, ld) {
  const compact = compactSku(sku);
  const urls = [];
  const seen = new Set();
  const push = (raw, alt = "") => {
    let url = upgradeHeliosImage(raw);
    if (!url) return;
    if (
      !/helioswatchstore\.com\/(?:dw\/image|media\/catalog\/product)/i.test(
        url
      ) &&
      !/static\.helioswatchstore\.com\/media\/catalog\/product/i.test(url)
    ) {
      return;
    }
    if (
      /logo|icon|sprite|banner|favicon|trust|genuine|secure.?payment|badge|emi|offer/i.test(
        url
      )
    ) {
      return;
    }
    if (isRetailerBrandingUrl(url, alt)) return;
    // Prefer SKU-named assets; allow generic catalog paths that include SKU
    const hay = url.toUpperCase().replace(/[.\-_\s]/g, "");
    if (compact && !hay.includes(compact)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  const ldImgs = ld && ld.image;
  const arr = Array.isArray(ldImgs) ? ldImgs : ldImgs ? [ldImgs] : [];
  for (const u of arr) push(u);

  const og = match1(html, /property="og:image"\s+content="([^"]+)"/i);
  if (og) push(og);

  const re =
    /https?:\/\/(?:www\.)?helioswatchstore\.com\/dw\/image\/[^"'\\\s>]+\.(?:jpe?g|png|webp)/gi;
  let m;
  while ((m = re.exec(html))) push(m[0]);

  const staticRe =
    /https?:\/\/static\.helioswatchstore\.com\/media\/catalog\/product\/[^"'\\\s>]+\.(?:jpe?g|png|webp)/gi;
  while ((m = staticRe.exec(html))) push(m[0]);

  // Prefer _1,_2… order when present
  urls.sort((a, b) => {
    const na = Number((a.match(/_(\d+)\.(?:jpe?g|png|webp)$/i) || [])[1] || 99);
    const nb = Number((b.match(/_(\d+)\.(?:jpe?g|png|webp)$/i) || [])[1] || 99);
    return na - nb;
  });

  return urls.slice(0, 12);
}

function extractLabeledSpecs(html) {
  const map = {};
  const text = stripTags(html);
  const labels = [
    "Brand",
    "Collection",
    "Series",
    "Model",
    "Model No",
    "Movement",
    "Case Size",
    "Case Shape",
    "Case Material",
    "Dial Colour",
    "Dial Color",
    "Strap Material",
    "Strap Colour",
    "Strap Color",
    "Gender",
    "Water Resistance",
    "Warranty",
  ];
  for (const label of labels) {
    const re = new RegExp(
      `${label.replace(/[()]/g, "\\$&")}\\s*[:\\-]?\\s*([^\\n]{1,80}?)(?=\\s+(?:${labels
        .map((l) => l.replace(/[()]/g, "\\$&"))
        .join("|")})|$)`,
      "i"
    );
    const m = text.match(re);
    if (m && m[1]) map[label] = m[1].trim();
  }
  return map;
}

function resolveRefUrl(compact, options = {}) {
  return (
    options.heliosUrl ||
    (options.heliosRefUrls && options.heliosRefUrls[compact]) ||
    REF_URLS[compact] ||
    null
  );
}

function fixtureHtmlPath(fixtureDir, sku) {
  if (!fixtureDir) return null;
  const compact = compactSku(sku);
  const names = [
    `helios-${compact}.html`,
    `helios-${compact.toLowerCase()}.html`,
    `${compact}.helios.html`,
  ];
  for (const name of names) {
    const p = path.join(fixtureDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function guessHeliosUrls(sku, options = {}) {
  const compact = compactSku(sku);
  if (!compact) return [];
  const lower = compact.toLowerCase();
  const brand = String(options.brandHint || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const urls = [];
  if (/armani-exchange|armani/.test(brand) || /^AX\d/i.test(compact)) {
    urls.push(
      `${HELIOS_ORIGIN}/armani-exchange-men-hampton-round-grey-watches-${lower}.html`
    );
    urls.push(`${HELIOS_ORIGIN}/armani-exchange-${lower}.html`);
  }
  urls.push(`${HELIOS_ORIGIN}/${lower}.html`);
  return [...new Set(urls)];
}

async function resolveHeliosUrlBySku(sku, options = {}) {
  const compact = compactSku(sku);
  const ref = resolveRefUrl(compact, options);
  if (ref) return { url: normalizeHeliosUrl(ref), via: "ref_url" };

  if (options.resolveBySku === false) return null;

  for (const url of guessHeliosUrls(compact, options).slice(0, 4)) {
    try {
      const page = await fetchText(url, {
        timeoutMs: options.timeoutMs || 25000,
        retries: 0,
        headers: { Referer: `${HELIOS_ORIGIN}/` },
      });
      if (isCloudflareChallenge(page.text, page.status)) continue;
      if (page.ok && looksLikeHeliosPdp(page.text)) {
        const hay = page.text.toUpperCase().replace(/[.\-_\s]/g, "");
        if (hay.includes(compact)) {
          return { url: page.url || url, via: "guess" };
        }
      }
    } catch {
      /* next */
    }
    await sleep(options.delayMs || 200);
  }

  // Site search (often CF-blocked for Node)
  try {
    const q = encodeURIComponent(compact);
    const searchUrl = `${HELIOS_ORIGIN}/search?q=${q}`;
    const res = await fetchText(searchUrl, {
      timeoutMs: options.timeoutMs || 20000,
      retries: 0,
      headers: { Referer: `${HELIOS_ORIGIN}/` },
    });
    if (res.ok && !isCloudflareChallenge(res.text, res.status)) {
      const re =
        /href="(https?:\/\/www\.helioswatchstore\.com\/[^"]+\.html)"/gi;
      let m;
      while ((m = re.exec(res.text))) {
        const cand = m[1].split("?")[0];
        if (cand.toUpperCase().includes(compact)) {
          return { url: cand, via: "search" };
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function mapHeliosProduct(html, skuInput, sourceUrl, options = {}) {
  const brandHint = options.brandHint || "Watch";
  const compact = compactSku(skuInput);
  const ld = extractJsonLdProducts(html)[0] || null;
  const specs = extractLabeledSpecs(html);

  const title =
    (ld && ld.name) ||
    match1(html, /property="og:title"\s+content="([^"]+)"/i)
      .replace(/\s*\|\s*Helios.*$/i, "")
      .replace(/\s*at Helios.*$/i, "") ||
    match1(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, " ") ||
    `${brandHint} ${compact}`;

  const description =
    (ld && (ld.description || (ld.offers && ld.offers.description))) ||
    match1(html, /property="og:description"\s+content="([^"]+)"/i) ||
    "";

  const images = extractHeliosImages(html, compact, ld);
  const offers = (ld && ld.offers) || {};
  const priceRaw =
    offers.price ||
    offers.lowPrice ||
    match1(html, /itemprop="price"[^>]*content="([^"]+)"/i);
  const priceAmount = priceRaw != null && priceRaw !== "" ? Number(priceRaw) : null;

  const dialColor =
    normalizeDialColor(
      specs["Dial Colour"] || specs["Dial Color"] || specs.Dial || ""
    ) ||
    (/grey|gray/i.test(title) ? "Grey" : "") ||
    (/blue/i.test(title) ? "Blue" : "");
  const gender =
    normalizeGender(specs.Gender || "") ||
    (/women|ladies|lady/i.test(title) ? "Women" : "Men");

  const { product, mapped: fieldMapped, unmapped: fieldUnmapped } =
    normalizeProductFields({
      status: "ok",
      brand: brandHint,
      sku: compact,
      officialSku: compact,
      title: stripTags(title).replace(/\s+/g, " ").trim(),
      description: stripTags(description).slice(0, 4000),
      caseMaterial:
        normalizeCaseMaterial(specs["Case Material"] || "") ||
        (/stainless|steel/i.test(`${title} ${description}`)
          ? "Stainless Steel"
          : ""),
      caseShape: normalizeCaseShape(specs["Case Shape"] || "") || "Round",
      caseSize: normalizeCaseSize(specs["Case Size"] || ""),
      dialColor,
      waterResistance: normalizeWaterResistance(
        specs["Water Resistance"] || ""
      ),
      movement:
        normalizeMovement(specs.Movement || "") ||
        (/quartz/i.test(`${title} ${description}`) ? "Quartz" : ""),
      strapMaterial:
        normalizeStrapMaterial(specs["Strap Material"] || "") ||
        (/leather/i.test(title) ? "Leather" : "") ||
        (/stainless|steel|bracelet/i.test(title) ? "Stainless Steel" : ""),
      strapColor: normalizeStrapColor(
        specs["Strap Colour"] || specs["Strap Color"] || ""
      ),
      gender,
      warrantyPeriod: specs.Warranty || "2 years",
      category: /chronograph/i.test(title) ? "Chronograph" : "Analog",
      price: null,
      oldPrice: null,
      priceSource:
        priceAmount != null && Number.isFinite(priceAmount)
          ? {
              amount: priceAmount,
              mrp: null,
              currency: "INR",
              label: `₹${Number(priceAmount).toLocaleString("en-IN")}`,
            }
          : null,
      images,
      sourceUrl: sourceUrl || null,
      source: SOURCE_ID,
      scrapedAt: new Date().toISOString(),
      rawAttributes: specs,
      extras: {
        resolveVia: options.resolveVia || "",
        heliosCfNote:
          "Helios CDN often CF-blocks Node downloads — migrate via browser/proxy or JIT fallthrough",
      },
    });

  product.fieldMapped = fieldMapped;
  product.fieldUnmapped = fieldUnmapped;
  product.warnings = product.warnings || [];
  if (!product.images.length) product.warnings.push("no_sku_images");
  if (!product.description || product.description.length < 40) {
    product.warnings.push("description_short_or_missing");
  }
  return product;
}

/**
 * Helios / SFCC image hosts are Cloudflare-gated for Node. Probe URLs;
 * return only those Node can download. Empty → fall through to JIT unless
 * allowBlockedImages (keep Helios URLs for offline browser migrate).
 */
async function filterDownloadableHeliosImages(urls, options = {}) {
  if (options.allowBlockedImages || options.skipImageProbe) {
    return urls || [];
  }
  const kept = [];
  for (const url of urls || []) {
    try {
      const probeUrl = /\?/.test(url) ? url : `${url}?sw=200&sh=200`;
      const { buffer, contentType } = await fetchBuffer(probeUrl, {
        timeoutMs: options.probeTimeoutMs || 12000,
        headers: { Referer: `${HELIOS_ORIGIN}/` },
      });
      const looksImage =
        buffer &&
        buffer.length > 2000 &&
        (/image\//i.test(contentType || "") ||
          (buffer[0] === 0xff && buffer[1] === 0xd8) ||
          (buffer[0] === 0x89 && buffer[1] === 0x50));
      if (looksImage) kept.push(url);
    } catch {
      /* CF / 403 */
    }
  }
  return kept;
}

async function finalizeHeliosProduct(product, options = {}) {
  if (!product || product.status !== "ok") return product;
  const rawImages = Array.isArray(product.images) ? product.images.slice() : [];
  if (!rawImages.length) return product;
  if (options.allowBlockedImages) return product;

  const downloadable = await filterDownloadableHeliosImages(rawImages, options);
  if (downloadable.length) {
    product.images = downloadable;
    return product;
  }

  // CDN blocked — do not leave Helios URLs in IMS; let JIT/Ethos continue.
  return {
    status: "blocked",
    sku: product.sku,
    brand: product.brand,
    source: SOURCE_ID,
    reason:
      "helios_cdn_blocked: gallery URLs found but Cloudflare blocks Node download — use fixture+browser migrate or JIT",
    sourceUrl: product.sourceUrl || null,
    scrapedAt: product.scrapedAt || new Date().toISOString(),
    extras: {
      ...(product.extras || {}),
      heliosImageUrls: rawImages,
      heliosTitle: product.title || null,
    },
  };
}

async function enrichFromHelios(sku, options = {}) {
  const brandHint = options.brandHint || "Watch";
  const compact = compactSku(sku);

  const fixture =
    options.heliosHtmlPath ||
    (options.preferFixture || options.fixtureDir
      ? fixtureHtmlPath(options.fixtureDir, sku)
      : fixtureHtmlPath(path.join(__dirname, "..", "fixtures"), sku));

  if (fixture && fs.existsSync(fixture)) {
    const html = fs.readFileSync(fixture, "utf8");
    if (!looksLikeHeliosPdp(html)) {
      return {
        status: "fetch_failed",
        sku: compact,
        brand: brandHint,
        source: SOURCE_ID,
        reason: "helios fixture is not a usable PDP",
        sourceUrl: resolveRefUrl(compact, options),
        scrapedAt: new Date().toISOString(),
      };
    }
    const sourceUrl =
      options.heliosUrl ||
      resolveRefUrl(compact, options) ||
      normalizeHeliosUrl(
        match1(html, /property="og:url"\s+content="([^"]+)"/i)
      );
    const product = mapHeliosProduct(html, sku, sourceUrl, {
      ...options,
      brandHint,
      resolveVia: "fixture",
    });
    product.fetchMode = "fixture";
    return finalizeHeliosProduct(product, options);
  }

  let resolved = null;
  try {
    resolved = await resolveHeliosUrlBySku(sku, options);
  } catch (err) {
    return {
      status: "fetch_failed",
      sku: compact,
      brand: brandHint,
      source: SOURCE_ID,
      reason: err.message,
      sourceUrl: null,
      scrapedAt: new Date().toISOString(),
    };
  }

  if (!resolved?.url) {
    return {
      status: "not_found",
      sku: compact,
      brand: brandHint,
      source: SOURCE_ID,
      reason: `not_found: no Helios PDP for ${compact}`,
      sourceUrl: null,
      scrapedAt: new Date().toISOString(),
    };
  }

  try {
    const page = await fetchText(resolved.url, {
      timeoutMs: options.timeoutMs || 30000,
      headers: { Referer: `${HELIOS_ORIGIN}/` },
    });
    if (isCloudflareChallenge(page.text, page.status)) {
      const fp = fixtureHtmlPath(options.fixtureDir, sku);
      if (fp) {
        const html = fs.readFileSync(fp, "utf8");
        const product = mapHeliosProduct(html, sku, resolved.url, {
          ...options,
          brandHint,
          resolveVia: "fixture_after_cf",
        });
        product.fetchMode = "fixture";
        product.warnings = product.warnings || [];
        product.warnings.push("helios_cloudflare_used_fixture");
        return finalizeHeliosProduct(product, options);
      }
      return {
        status: "blocked",
        sku: compact,
        brand: brandHint,
        source: SOURCE_ID,
        reason: "helios Cloudflare challenge — save fixtures/helios-{SKU}.html",
        sourceUrl: resolved.url,
        scrapedAt: new Date().toISOString(),
      };
    }
    if (!page.ok || !looksLikeHeliosPdp(page.text)) {
      return {
        status: "not_found",
        sku: compact,
        brand: brandHint,
        source: SOURCE_ID,
        reason: `helios PDP HTTP ${page.status || 0}`,
        sourceUrl: resolved.url,
        scrapedAt: new Date().toISOString(),
      };
    }
    const hay = page.text.toUpperCase().replace(/[.\-_\s]/g, "");
    if (!hay.includes(compact)) {
      return {
        status: "not_found",
        sku: compact,
        brand: brandHint,
        source: SOURCE_ID,
        reason: "SKU not present on Helios PDP",
        sourceUrl: resolved.url,
        scrapedAt: new Date().toISOString(),
      };
    }
    const product = mapHeliosProduct(page.text, sku, page.url || resolved.url, {
      ...options,
      brandHint,
      resolveVia: resolved.via || "live",
    });
    product.fetchMode = "live";
    return finalizeHeliosProduct(product, options);
  } catch (err) {
    return {
      status: err.code || "fetch_failed",
      sku: compact,
      brand: brandHint,
      source: SOURCE_ID,
      reason: err.message,
      sourceUrl: resolved.url,
      scrapedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  HELIOS_ORIGIN,
  SOURCE_ID,
  REF_URLS,
  compactSku,
  normalizeHeliosUrl,
  extractHeliosImages,
  mapHeliosProduct,
  resolveHeliosUrlBySku,
  enrichFromHelios,
  looksLikeHeliosPdp,
  isCloudflareChallenge,
};
