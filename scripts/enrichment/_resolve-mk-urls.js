#!/usr/bin/env node
"use strict";

/**
 * Resolve michaelkors.com PDP URLs for pending SKUs via Bing HTML.
 * Writes input/michael-kors-skus.csv + michael-kors-pending-skus.csv
 * and output/_pending-michael-kors.json
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SKUS = [
  "MK3215",
  "MK3640",
  "MK3836",
  "MK4817",
  "MK4823",
  "MK4829",
  "MK4844",
  "MK4846",
  "MK4926",
  "MK4962",
  "MK6110",
  "MK6356",
  "MK6408",
  "MK7323",
  "MK7541",
  "MK7573",
  "MK7583",
  "MK7636",
  "MK7673",
  "MK7674",
  "MK7677",
  "MK7681",
  "MK7682",
  "MK7688",
  "MK7689",
  "MK9107",
  "MK9108",
  "MK9193",
  "MK9220",
  "MK9224",
  "MK9267",
  "MK9282",
  "MK9289",
  "MK9297",
  "MK9303",
  "MKO1081",
  "MKO1235",
  "MKO125",
];

const KNOWN = {
  MK7688:
    "https://www.michaelkors.com/mini-lexington-black-tone-watch/MK7688.html",
  MK3640: "https://www.michaelkors.com/portia-rose-gold-tone-watch/MK3640.html",
  MK4823:
    "https://www.michaelkors.com/mini-sage-pave-rose-gold-tone-watch/MK4823.html",
};

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 25000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, text: d }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, text: "", err: e.message }));
  });
}

function decodeMaybe(s) {
  let out = s;
  try {
    out = decodeURIComponent(out);
  } catch {
    /* keep */
  }
  return out.replace(/&amp;/g, "&");
}

function extractMkUrl(html, sku) {
  const up = String(sku).toUpperCase();
  const candidates = new Set();

  const patterns = [
    new RegExp(
      `https?://(?:www\\.)?michaelkors\\.com/(?:[a-z]{2}/(?:en|fr)/)?[a-z0-9-]+/${up}\\.html`,
      "gi"
    ),
    new RegExp(
      `https?%3a%2f%2f(?:www\\.)?michaelkors\\.com%2f(?:[a-z]{2}%2f(?:en|fr)%2f)?[a-z0-9-]+%2f${up}\\.html`,
      "gi"
    ),
    new RegExp(
      `michaelkors\\.com/(?:[a-z]{2}/(?:en|fr)/)?[a-z0-9-]+/${up}\\.html`,
      "gi"
    ),
  ];

  for (const re of patterns) {
    const matches = String(html || "").match(re) || [];
    for (const m of matches) {
      let u = decodeMaybe(m);
      if (!/^https?:/i.test(u)) u = `https://${u}`;
      u = u.replace(/^http:/i, "https:").split("?")[0];
      candidates.add(u);
    }
  }

  const list = [...candidates];
  const us = list.find((u) => !/\/(ca|uk|eu|au|de|fr|it|es|nl|jp)\//i.test(u));
  return us || list[0] || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resolveOne(sku) {
  if (KNOWN[sku]) return KNOWN[sku];
  const queries = [
    `site:michaelkors.com ${sku}.html`,
    `"${sku}" site:michaelkors.com`,
    `michael kors ${sku} watch site:michaelkors.com`,
  ];
  for (const q of queries) {
    const bing = await get(
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10`
    );
    const url = extractMkUrl(bing.text || "", sku);
    if (url) return url;
    await sleep(250);
  }
  const ddg = await get(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
      `site:michaelkors.com ${sku}`
    )}`
  );
  return extractMkUrl(ddg.text || "", sku);
}

async function main() {
  const alreadyOk = new Set(["MK7688"]);
  const pending = SKUS.filter((s) => !alreadyOk.has(s));
  const resolved = { ...KNOWN };
  const rows = [];

  for (let i = 0; i < pending.length; i++) {
    const sku = pending[i];
    const url = await resolveOne(sku);
    console.log(`[${i + 1}/${pending.length}] ${sku} → ${url || "MISS"}`);
    rows.push({ sku, official_url: url || "" });
    if (url) resolved[sku] = url;
    await sleep(350);
  }

  const full = SKUS.map((sku) => ({
    sku,
    official_url: resolved[sku] || (sku === "MK7688" ? KNOWN.MK7688 : ""),
  }));

  const csv =
    "sku,official_url\n" +
    full.map((r) => `${r.sku},${r.official_url || ""}`).join("\n") +
    "\n";
  const pendingCsv =
    "sku,official_url\n" +
    rows.map((r) => `${r.sku},${r.official_url || ""}`).join("\n") +
    "\n";

  fs.writeFileSync(path.join(ROOT, "input", "michael-kors-skus.csv"), csv);
  fs.writeFileSync(
    path.join(ROOT, "input", "michael-kors-pending-skus.csv"),
    pendingCsv
  );
  fs.writeFileSync(
    path.join(ROOT, "output", "_pending-michael-kors.json"),
    JSON.stringify(
      {
        brand: "michael-kors",
        unpublishedTotal: SKUS.length,
        alreadyOkInBatch: [...alreadyOk],
        pendingCount: pending.length,
        resolvedOfficial: Object.keys(resolved).filter((k) => k !== "MK7688")
          .length,
        pending,
        resolved,
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        unpublished: SKUS.length,
        pending: pending.length,
        resolved: Object.keys(resolved).length,
        unresolved: pending.filter((s) => !resolved[s]),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
