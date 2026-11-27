"use strict";

/**
 * Victorinox (victorinox.com) enrichment — Next.js / Amplience storefront.
 *
 * PDP: https://www.victorinox.com/en/Products/.../p/{sku}/
 * Short resolve: https://www.victorinox.com/en/p/{sku}/ (redirects to full path)
 *
 * IMS SKUs are numeric item numbers (242095). Resolve order:
 *   1. options.officialUrl / CSV official_url / REF_URLS
 *   2. /en/p/{sku}/ short URL
 *   3. In-memory sitemap (sitemap/dynamic/en.xml) by /p/{sku}
 *   4. Fixtures under fixtures/victorinox-{sku}.html
 *   5. On official miss: Collective → Tata Cliq → JIT → TGT Luxe → Ethos
 *
 * Specs from Product Details label spans + __NEXT_DATA__ commerce.
 * Images from imageengine.victorinox.com (WAT_{sku}_* only).
 * Prefer official CDN. No auto-publish.
 */

const path = require("path");
const fs = require("fs");
const { fetchText, sleep } = require("../lib/http");
const { buildSeo } = require("../lib/seo");
const {
  enrichFromRetailerChain,
  SOURCE: RETAILER_SOURCE,
} = require("../lib/retailerFallback");
const {
  normalizeProductFields,
  normalizeCaseSize,
  normalizeGender,
} = require("../lib/normalize");

const BRAND = "Victorinox";
const SITE_ORIGIN = "https://www.victorinox.com";
const LOCALE = "en";
const SOURCE_OFFICIAL = "victorinox";
const SOURCE_COLLECTIVE = RETAILER_SOURCE.COLLECTIVE;
const SOURCE_TATA = RETAILER_SOURCE.TATA;
const SOURCE_TGT = RETAILER_SOURCE.TGT;
const SOURCE_ETHOS = RETAILER_SOURCE.ETHOS;

const OFFICIAL_FAIL_CODES = new Set([
  "not_found",
  "fetch_failed",
  "error",
]);

/** Known official PDPs (compact → URL). */
const REF_URLS = {
  "242095":
    "https://www.victorinox.com/en/Products/Watches/Business-Watches/Maverick-Quartz/p/242095/",
};

const SITEMAP_URLS = [
  `${SITE_ORIGIN}/sitemap/dynamic/${LOCALE}.xml`,
  `${SITE_ORIGIN}/sitemap/${LOCALE}.xml`,
];

const ATTR_MAP = {
  "item number": "officialSku",
  diameter: "caseSize",
  "case material": "caseMaterial",
  "bracelet material": "strapMaterial",
  "bracelet colour": "strapColor",
  "bracelet color": "strapColor",
  "case colour": "dialColor",
  "case color": "dialColor",
  "water resistance": "waterResistance",
  warranty: "warrantyPeriod",
};

/** @type {Map<string, string>|null} compactSku → preferred PDP URL */
let sitemapIndex = null;
let sitemapIndexPromise = null;

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

function absUrl(url, base = SITE_ORIGIN) {
  if (!url) return "";
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function decodeEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
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

function match1(html, re) {
  const m = String(html || "").match(re);
  return m ? decodeEntities(m[1].trim()) : "";
}

function shortPdpUrl(sku) {
  const { compact } = normalizeSku(sku);
  return `${SITE_ORIGIN}/${LOCALE}/p/${compact}/`;
}

function skuFromPdpUrl(url) {
  const m = String(url || "").match(/\/p\/([0-9]{5,8})\/?(?:\?|#|$)/i);
  return m ? m[1].toUpperCase() : null;
}

async function loadSitemapIndex(options = {}) {
  if (sitemapIndex) return sitemapIndex;
  if (sitemapIndexPromise) return sitemapIndexPromise;

  sitemapIndexPromise = (async () => {
    const map = new Map();
    const preferWatch = (url) => /\/Products\/Watches\//i.test(url);
    for (const smUrl of SITEMAP_URLS) {
      try {
        const res = await fetchText(smUrl, {
          timeoutMs: options.timeoutMs || 60000,
          retries: 1,
        });
        if (!res.ok || !res.text) continue;
        // Sitemap index → follow dynamic children once
        const childLocs = [
          ...String(res.text).matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gi),
        ].map((m) => decodeEntities(m[1].trim()));
        const locs = [
          ...String(res.text).matchAll(/<url>\s*<loc>([^<]+)<\/loc>/gi),
        ].map((m) => decodeEntities(m[1].trim()));
        const toScan = locs.length
          ? locs
          : (
              await Promise.all(
                childLocs.slice(0, 4).map(async (child) => {
                  try {
                    const r = await fetchText(child, {
                      timeoutMs: options.timeoutMs || 60000,
                      retries: 1,
                    });
                    if (!r.ok || !r.text) return [];
                    return [
                      ...String(r.text).matchAll(/<loc>([^<]+)<\/loc>/gi),
                    ].map((m) => decodeEntities(m[1].trim()));
                  } catch {
                    return [];
                  }
                })
              )
            ).flat();
        for (const loc of toScan) {
          const sku = skuFromPdpUrl(loc);
          if (!sku) continue;
          const prev = map.get(sku);
          if (!prev || (preferWatch(loc) && !preferWatch(prev))) {
            map.set(sku, loc);
          }
        }
      } catch {
        /* try next sitemap */
      }
    }
    sitemapIndex = map;
    return map;
  })();

  try {
    return await sitemapIndexPromise;
  } catch (err) {
    sitemapIndexPromise = null;
    throw err;
  }
}

async function resolveProductUrl(sku, options = {}) {
  if (options.officialUrl) return options.officialUrl;
  const { compact } = normalizeSku(sku);
  if (options.refUrls && options.refUrls[compact]) {
    return options.refUrls[compact];
  }
  if (REF_URLS[compact]) return REF_URLS[compact];
  // Short /en/p/{sku}/ resolves via server redirect — primary discovery
  if (!options.skipShortUrl) return shortPdpUrl(sku);
  try {
    const idx = await loadSitemapIndex({
      timeoutMs: options.timeoutMs || 60000,
    });
    if (idx.get(compact)) return idx.get(compact);
  } catch {
    /* fall through */
  }
  return shortPdpUrl(sku);
}

function extractJsonLdProduct(html) {
  const blocks = String(html || "").match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!blocks) return null;
  for (const block of blocks) {
    const raw = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(raw);
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        if (item && (item["@type"] === "Product" || item.sku || item.mpn)) {
          return item;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function extractNextCommerce(html) {
  const m = String(html || "").match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    const root = data?.props?.pageProps?.data;
    const master =
      root?.data?.dataSources?.__master?.data?.dataSource?.data?.[
        "products/product"
      ]?.data?.commerce;
    if (master && master.code) return master;
    // Walk for first commerce-like object with galleryImages + code
    let found = null;
    const walk = (o, depth = 0) => {
      if (found || depth > 10 || !o) return;
      if (Array.isArray(o)) {
        for (const v of o.slice(0, 40)) walk(v, depth + 1);
        return;
      }
      if (typeof o !== "object") return;
      if (
        o.code &&
        (o.galleryImages || o.primaryImage) &&
        (o.name || o.baseName)
      ) {
        found = o;
        return;
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(root);
    return found;
  } catch {
    return null;
  }
}

function extractDetailAttrs(html) {
  const attrs = {};
  const re =
    />([A-Za-z][^:<]{1,60}):\s*<\/span>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const label = stripTags(m[1]).replace(/\s+/g, " ").trim().toLowerCase();
    const value = stripTags(m[2]).replace(/\s+/g, " ").trim();
    if (!label || !value) continue;
    if (!attrs[label]) attrs[label] = value;
  }
  return attrs;
}

function extractDescription(html, commerce) {
  if (commerce?.description) {
    const d = stripTags(commerce.description);
    if (d.length >= 40) return d;
  }
  const ld = extractJsonLdProduct(html);
  if (ld?.description) {
    const d = stripTags(ld.description);
    if (d.length >= 40) return d;
  }
  const og = match1(
    html,
    /property=["']og:description["']\s+content=["']([^"']+)/i
  );
  if (og && og.length >= 40) return og;
  const narrative = String(html || "").match(
    /<(?:p|div)[^>]*>\s*((?:The highlight|Reliable)[\s\S]{60,2500}?)\s*<\/(?:p|div)>/i
  );
  if (narrative) {
    const d = stripTags(narrative[1]);
    if (d.length >= 40) return d;
  }
  return og || "";
}

function galleryUrlsFromCommerce(commerce) {
  const urls = [];
  const pushNode = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      urls.push(node);
      return;
    }
    const sources = node?.default?.sources;
    if (Array.isArray(sources)) {
      for (const s of sources) if (typeof s === "string") urls.push(s);
    }
  };
  if (commerce?.primaryImage) pushNode(commerce.primaryImage);
  if (Array.isArray(commerce?.galleryImages)) {
    for (const g of commerce.galleryImages) pushNode(g);
  }
  return urls;
}

function canonicalizeImage(url) {
  if (!url) return "";
  let u = decodeEntities(String(url).trim()).replace(/\\\//g, "/");
  try {
    const parsed = new URL(u, SITE_ORIGIN);
    if (!/victorinox\.com$/i.test(parsed.hostname)) return "";
    // Drop transform query params — stable imageengine asset
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

function extractImages(html, skuCompact, commerce) {
  const urls = [];
  const seen = new Set();
  const compact = String(skuCompact || "").toUpperCase();
  const token = `WAT_${compact}_`;

  const push = (raw) => {
    const u = canonicalizeImage(raw);
    if (!u) return;
    if (!/imageengine\.victorinox\.com/i.test(u)) return;
    const base = (u.split("/").pop() || "").toUpperCase();
    if (compact && !base.includes(token) && !base.includes(compact)) return;
    // Prefer non-query canonical already; skip digital-only lifestyle last
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  for (const u of galleryUrlsFromCommerce(commerce)) push(u);

  const ld = extractJsonLdProduct(html);
  if (ld) {
    const imgs = Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : [];
    for (const img of imgs) push(typeof img === "string" ? img : img?.url);
  }

  const og = match1(html, /property=["']og:image["']\s+content=["']([^"']+)/i);
  push(og);

  const hits = String(html || "").match(
    /https?:\/\/imageengine\.victorinox\.com\/transform\/[a-f0-9-]+\/WAT_[0-9]+_[A-Z0-9_-]+/gi
  );
  if (hits) for (const h of hits) push(h);

  return urls
    .sort((a, b) => {
      const score = (u) => {
        const f = (u.split("/").pop() || "").toUpperCase();
        let s = 0;
        if (/_S1(?:$|_)/.test(f)) s += 20;
        if (/_NV(?:$|_)/.test(f)) s += 12;
        if (/_P(?:$|_)/.test(f)) s += 10;
        if (/_SI2/.test(f)) s += 8;
        if (/_SI(?:$|_)/.test(f)) s += 7;
        if (/_BA/.test(f)) s += 6;
        if (/_FR/.test(f)) s += 5;
        if (/DIGITAL-ONLY|_LS/.test(f)) s -= 5;
        return s;
      };
      return score(b) - score(a);
    })
    .slice(0, 12);
}

function extractGender(html, commerce) {
  const cats = [];
  if (Array.isArray(commerce?.categories)) {
    for (const c of commerce.categories) {
      if (c?.name) cats.push(c.name);
      if (c?.code) cats.push(c.code);
    }
  }
  if (commerce?.rootCategory?.name) cats.push(commerce.rootCategory.name);
  const hay = `${cats.join(" ")} ${stripTags(html).slice(0, 4000)}`.toLowerCase();
  if (/women'?s|ladies|\bwoman\b|tp-womens/i.test(hay)) return "Women";
  if (/men'?s|\bman\b|\bgent|tp-mens/i.test(hay)) return "Men";
  return "";
}

function extractMovement(html, description, attrs) {
  const hay = `${description || ""} ${JSON.stringify(attrs)} ${stripTags(html).slice(0, 8000)}`;
  const m = hay.match(
    /\b((?:quartz|automatic|mechanical)(?:\s+movement)?(?:\s+ronda\s+\d+)?)/i
  );
  if (m) return m[1].replace(/\s+/g, " ").trim();
  if (/ronda\s+\d+/i.test(hay)) {
    const r = hay.match(/ronda\s+\d+/i);
    return r ? `Quartz ${r[0]}` : "";
  }
  return "";
}

function extractWarranty(html, description) {
  const hay = `${description || ""} ${String(html || "")}`;
  const m = hay.match(/\b(\d+)\s*[- ]?years?\s*(?:\+|plus)?\s*warranty/i);
  if (m) return `${m[1]} years`;
  const m2 = hay.match(/victorinox\s+(\d+)\s*[- ]?year/i);
  if (m2) return `${m2[1]} years`;
  return "";
}

function isVictorinoxPdpHtml(html) {
  if (!html || html.length < 2000) return false;
  if (/victorinox/i.test(html) && /__NEXT_DATA__/i.test(html)) return true;
  if (/property=["']og:type["']\s+content=["']product["']/i.test(html)) {
    return /victorinox/i.test(html);
  }
  return false;
}

function mapProduct(html, skuInput, sourceUrl) {
  const sku = normalizeSku(skuInput);
  const commerce = extractNextCommerce(html);
  const attrs = extractDetailAttrs(html);
  const ld = extractJsonLdProduct(html);

  const mapped = {};
  for (const [label, field] of Object.entries(ATTR_MAP)) {
    if (attrs[label]) mapped[field] = attrs[label];
  }

  let title =
    (commerce && (commerce.name || commerce.baseName)) ||
    (ld && ld.name) ||
    match1(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    match1(html, /property=["']og:title["']\s+content=["']([^"']+)/i) ||
    "";
  title = stripTags(title)
    .replace(/^check this out:\s*/i, "")
    .replace(/\s*[-–]\s*\d{5,8}\s*$/i, "")
    .trim();
  if (title && !/^victorinox\b/i.test(title)) {
    title = `${BRAND} ${title}`;
  }

  const description = extractDescription(html, commerce);
  const images = extractImages(html, sku.compact, commerce);
  const gender = extractGender(html, commerce);
  const movement = extractMovement(html, description, attrs);
  const warrantyRaw =
    mapped.warrantyPeriod || extractWarranty(html, description);
  const collection =
    commerce?.itemCollection ||
    match1(html, /itemCollection["']?\s*[:=]\s*["']([^"']+)/i) ||
    "";

  if (/stainless\s*steel/i.test(mapped.caseMaterial || "")) {
    mapped.caseMaterial = "Stainless Steel";
  }
  if (/stainless\s*steel/i.test(mapped.strapMaterial || "")) {
    mapped.strapMaterial = "Stainless Steel";
  }

  const caseSize = normalizeCaseSize(mapped.caseSize || attrs.diameter || "");
  const waterRaw = mapped.waterResistance || attrs["water resistance"] || "";

  const {
    product: normalized,
    mapped: fieldMapped,
    unmapped: fieldUnmapped,
  } = normalizeProductFields({
    status: "ok",
    brand: BRAND,
    sku: sku.compact,
    officialSku: mapped.officialSku || commerce?.code || ld?.sku || sku.compact,
    title,
    description,
    caseMaterial: mapped.caseMaterial || "",
    caseSize: caseSize || mapped.caseSize || "",
    dialColor: mapped.dialColor || "",
    waterResistance: waterRaw || "",
    movement: movement || "",
    strapMaterial: mapped.strapMaterial || "",
    strapColor: mapped.strapColor || "",
    gender: gender || "",
    warrantyPeriod: warrantyRaw || "",
    category: "Luxury",
    price: null,
    oldPrice: null,
    priceSource: null,
    images,
    sourceUrl,
    source: SOURCE_OFFICIAL,
    scrapedAt: new Date().toISOString(),
    rawAttributes: attrs,
    extras: {
      collection: collection || "",
      height: attrs.height || "",
      weight: attrs.weight || "",
      lugWidth: attrs["lug width"] || "",
      dialFinish: attrs["dial finish"] || "",
      bezelMaterial: attrs["bezel material"] || "",
      closure: attrs.closure || "",
      countryOfOrigin: attrs["country of origin"] || "",
    },
  });

  if (gender && !normalized.gender) {
    normalized.gender = normalizeGender(gender) || "";
  }

  normalized.fieldMapped = fieldMapped;
  normalized.fieldUnmapped = fieldUnmapped;
  normalized.warnings = normalized.warnings || [];

  if (!normalized.description || normalized.description.length < 40) {
    normalized.warnings.push("description_short_or_missing");
  }
  if (!normalized.images.length) {
    normalized.warnings.push("no_sku_images");
  }
  if (!Object.keys(attrs).length && !commerce) {
    normalized.warnings.push("tech_attrs_missing");
  }
  if (fieldUnmapped && Object.keys(fieldUnmapped).length) {
    normalized.warnings.push("unmapped_constrained_fields");
  }

  Object.assign(
    normalized,
    buildSeo(normalized, { metaDescription: description })
  );
  return normalized;
}

function fixturePathForSku(fixtureDir, sku) {
  if (!fixtureDir) return null;
  const { compact } = normalizeSku(sku);
  for (const name of [
    `victorinox-${compact}.html`,
    `${compact}.html`,
    `${compact.toLowerCase()}.html`,
  ]) {
    const candidate = path.join(fixtureDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readFixtureHtml(filePath, officialUrl) {
  const html = fs.readFileSync(filePath, "utf8");
  return {
    html,
    sourceUrl:
      officialUrl ||
      match1(html, /property=["']og:url["']\s+content=["']([^"']+)/i) ||
      `file://${path.resolve(filePath)}`,
    fromFixture: true,
  };
}

async function fetchProductHtml(sku, options = {}) {
  if (options.htmlPath) {
    return readFixtureHtml(options.htmlPath, options.officialUrl);
  }
  if (options.preferFixture) {
    const fp = fixturePathForSku(options.fixtureDir, sku);
    if (fp) return readFixtureHtml(fp, options.officialUrl);
  }

  const url = await resolveProductUrl(sku, options);
  if (!url) {
    const fp = fixturePathForSku(options.fixtureDir, sku);
    if (fp) return readFixtureHtml(fp, options.officialUrl);
    throw Object.assign(
      new Error(`not_found: no Victorinox PDP URL for ${sku}`),
      { code: "not_found", sourceUrl: null }
    );
  }

  const res = await fetchText(url, { timeoutMs: options.timeoutMs || 45000 });
  if (
    !res.ok ||
    !res.text ||
    res.text.length < 2000 ||
    !isVictorinoxPdpHtml(res.text)
  ) {
    // Retry via sitemap if short URL failed
    if (!options._sitemapRetried) {
      try {
        const idx = await loadSitemapIndex({
          timeoutMs: options.timeoutMs || 60000,
        });
        const { compact } = normalizeSku(sku);
        const smUrl = idx.get(compact);
        if (smUrl && smUrl !== url) {
          return fetchProductHtml(sku, {
            ...options,
            officialUrl: smUrl,
            _sitemapRetried: true,
          });
        }
      } catch {
        /* fall through */
      }
    }
    const fp = fixturePathForSku(options.fixtureDir, sku);
    if (fp) return readFixtureHtml(fp, options.officialUrl || url);
    throw Object.assign(
      new Error(`fetch_failed: HTTP ${res.status || "?"} for ${url}`),
      { code: "fetch_failed", sourceUrl: url }
    );
  }
  return {
    html: res.text,
    sourceUrl: res.url || url,
    fromFixture: false,
  };
}

async function enrichFromRetailerFallback(sku, options = {}) {
  const { product } = await enrichFromRetailerChain(sku, {
    ...options,
    brandHint: BRAND,
    preset: "luxury",
    fixtureDir: options.fixtureDir || path.join(__dirname, "..", "fixtures"),
  });
  return product;
}

async function enrichSku(sku, options = {}) {
  const normalized = normalizeSku(sku);

  if (
    options.collectiveOnly ||
    options.tataCliqOnly ||
    options.tgtLuxeOnly ||
    options.ethosOnly
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

  try {
    const { html, sourceUrl, fromFixture } = await fetchProductHtml(
      sku,
      options
    );
    const hay = html.toUpperCase().replace(/[.\-_\s]/g, "");
    if (!hay.includes(normalized.compact)) {
      if (!options.skipRetailerFallback) {
        const retailer = await enrichFromRetailerFallback(sku, options);
        if (retailer && retailer.status === "ok") return retailer;
      }
      return {
        status: "not_found",
        sku: normalized.compact,
        brand: BRAND,
        source: SOURCE_OFFICIAL,
        reason: "SKU not present on Victorinox PDP",
        sourceUrl,
        scrapedAt: new Date().toISOString(),
      };
    }
    const mapped = mapProduct(html, sku, sourceUrl);
    mapped.fetchMode = fromFixture ? "fixture" : "live";
    if (options.delayMs) await sleep(options.delayMs);
    return mapped;
  } catch (err) {
    if (
      !options.skipRetailerFallback &&
      OFFICIAL_FAIL_CODES.has(err.code || "error")
    ) {
      const retailer = await enrichFromRetailerFallback(sku, options);
      if (retailer && retailer.status === "ok") return retailer;
    }
    return {
      status: err.code || "error",
      sku: normalized.compact,
      brand: BRAND,
      source: SOURCE_OFFICIAL,
      reason: err.message,
      sourceUrl: err.sourceUrl || null,
      scrapedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  BRAND,
  SITE_ORIGIN,
  SOURCE_OFFICIAL,
  SOURCE_COLLECTIVE,
  SOURCE_TATA,
  SOURCE_TGT,
  SOURCE_ETHOS,
  REF_URLS,
  ATTR_MAP,
  normalizeSku,
  skuMatchKeys,
  resolveProductUrl,
  loadSitemapIndex,
  skuFromPdpUrl,
  shortPdpUrl,
  extractDetailAttrs,
  extractImages,
  extractDescription,
  mapProduct,
  fetchProductHtml,
  enrichFromRetailerFallback,
  enrichSku,
};
