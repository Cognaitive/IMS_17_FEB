#!/usr/bin/env node
"use strict";

/**
 * Write a minimal michaelkors.com-style PDP HTML fixture that brands/michael-kors.js
 * can parse (JSON-LD + bullet list + ECOM image URLs).
 *
 * Usage:
 *   node _write-mk-fixture.js --sku MK4823 --title "..." --desc "..." \
 *     --bullets "Stainless steel|31mm case|..." \
 *     --image "https://assets.michaelkors.com/transform/ECOM_Image_Large/.../MK4823-..." \
 *     [--url "https://www.michaelkors.com/.../MK4823.html"] \
 *     [--price 179]
 */

const fs = require("fs");
const path = require("path");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const sku = String(arg("--sku") || "")
  .trim()
  .toUpperCase();
const title = arg("--title") || `Michael Kors ${sku}`;
const desc = arg("--desc") || "";
const bulletsRaw = arg("--bullets") || "";
const image = arg("--image") || "";
const url =
  arg("--url") || `https://www.michaelkors.com/watch/${sku}.html`;
const price = arg("--price");

if (!sku) {
  console.error("Need --sku");
  process.exit(1);
}

const bullets = bulletsRaw
  .split("|")
  .map((b) => b.trim())
  .filter(Boolean);
const bulletHtml = bullets.map((b) => `<li>• ${b}</li>`).join("\n");

const images = [];
if (image) {
  images.push(image);
  // Guess _2 _3 variants when ECOM path uses _1-tif
  const m = image.match(/(_1)(-tif)?$/i);
  if (m) {
    for (const n of [2, 3, 4]) {
      images.push(image.replace(/_1(-tif)?$/i, `_${n}$1`));
    }
  }
}

const ld = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: title,
  sku,
  mpn: sku,
  description: desc || title,
  image: images,
  brand: { "@type": "Brand", name: "Michael Kors" },
};
if (price) {
  ld.offers = {
    "@type": "Offer",
    price: Number(price),
    priceCurrency: "USD",
  };
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title} | Michael Kors [US]</title>
<link rel="canonical" href="${url}"/>
<meta property="og:url" content="${url}"/>
<meta property="og:title" content="${title} | Michael Kors"/>
<meta property="og:description" content="${(desc || title).replace(/"/g, "&quot;")}"/>
<meta property="og:image" content="${images[0] || ""}"/>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<h1>${title}</h1>
<p>${desc}</p>
<ul class="product-details">
${bulletHtml}
<li>• Style # ${sku}</li>
</ul>
${images.map((u) => `<img src="${u}" alt="${sku}"/>`).join("\n")}
<!-- synthetic fixture for Akamai-blocked Node enrichment -->
</body>
</html>
`;

const out = path.join(__dirname, "fixtures", `michael-kors-${sku}.html`);
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes, ${images.length} images)`);
