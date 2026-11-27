# Enrichment brands status

Unpublished counts from Mongo (`isPublished` false/missing), Nov 2025. Exclude already-shipped Balmain / Titan / Timex from “needs pipeline” work, but they remain supported.

## Priority table (unpublished)

| Brand | Unpublished | Official site | Pipeline | Notes |
|-------|-------------|---------------|----------|-------|
| Casio | 177 | casio.com / casiostore.bhawar.com | **Added** (fixture-first) | IMS uses India codes; CF/Akamai blocks live |
| Guess | 87 | guess.com / guesswatches.com | Deferred | Catalog gaps; India storefront not reliable for all W/GW SKUs |
| DW | 84 | danielwellington.com | Deferred | CF challenge; many IMS `DW0DG*` codes not on global catalog |
| Alba | 27 need-details → **21 ok / 6 fail** | **alba-watches.co.in** (Shopify) + Collective / Tata / JIT / TGT / Ethos | **Need-recover done** | Proof `AL4817X1` via `.json`; sources alba-in / JIT / TGT; fails `AL4459X1`, `AF3F17X1`, `ASPE29X1`, `AS9571X1`, `AH7AU6X1`, `AI4537X1`; batch `output/alba-need-recover/`; Get details wired (Hostinger/DO deploy for live button) |
| Just Cavalli | 58 | — | Deferred | No reliable official watch e-com |
| Alexandre Christie | 58 | alexandrechristie.com (CF) + Collective / **Tata Cliq** / TGT / Ethos | **Started** (retailer-first) | First SKU `2B58BFBROBO` ok via Tata Cliq; batch `output/alexandre-christie-batch/`; IMS Get details + preview `#progress/alexandre-christie` |
| Titan | 57 | titan.co.in | Done (prior) | |
| Seiko | 52 | **seikowatches.co.in** (Shopify; CF) + seikowatches.com fallback | **Added** (fixture-first India) | Batch **32 India + 15 global = 47 ok / 5 not on either**; see `output/seiko-batch/404-report.json` (HGK008P1, SKK721P1, SNKN58K1, SSC763P1, SWR080P1) |
| Timex | 46 | shop.timexindia.com | Done (prior) | |
| Giordano | 46 | — | Deferred | No clear official India/global PDP |
| DKNY | 46 | justintime.in (primary) + Collective / Tata / TGT / Ethos | **JIT wired** | Get details + `jit_first` preset; SKUs like `DK1G135M0055`; cert usually last gallery image |
| Fossil | 45 | fossil.in | **Added** (fixture-first) | Akamai 403 for Node |
| Romanson | 44 | — | Deferred | No reliable official site |
| Tissot | 43 | tissotwatches.com/en-in | **Added** (live) | Compact SKU in URL; Node OK |
| Longines | 43 | longines.com (+ Collective / Tata Cliq / TGT Luxe / **Ethos** on miss) | **Added** (live + sitemap + retailer fallback) | Batch **34 ok / 9 remaining**; typo `L22734716→L27734716`; Collective + TGT Luxe recovered retailer-only SKUs; see `output/longines-batch/404-report.json` |
| Earnshaw | 42 | thomas-earnshaw.com (Shopify; + Collective / Tata Cliq / TGT Luxe / **Ethos** on miss) | **Batch run** (live + catalog + retailers) | **35 ok / 7 fail**; all oks from official Earnshaw; typo `ES-8006-ll→ES-8006-II`; remaining `ES-8006-00`, `ES-8294-44`, `ES-8294-88`, `ES-829401`, `ES-8306-01`, `ES-830603`, `ES-830604` (not on Shopify catalog / retailer chain); batch `output/earnshaw-batch/` |
| Rado | 42 | rado.com/en_in (+ Collective / Tata Cliq / TGT Luxe / **Ethos** on miss) | **Batch run** (live + sitemap + retailers) | **42 ok / 0 fail**; sources: rado 31 · Collective 8 · Tata Cliq 1 · Ethos 1 · TGT Luxe 1; recovered `R22894153` (Tata Cliq) + `R22910153` (Ethos); batch `output/rado-batch/` |
| Michael Kors | 38 | michaelkors.com (+ Collective / Tata / **JIT** / TGT / Ethos) | **Batch + need-recover** | Need-recover **5/5 ok** via The Collective (`MKO125`, `MK4817`, `MK7677`, `MK7681`, `MK7682`); applied to IMS |
| Phillip Plein | 7 | justintime.in (primary) + Collective / Tata / TGT / Ethos | **Started** | IMS spelling **Phillip Plein**; batch `output/phillip-plein-batch/` **3 ok / 1 fail**; applied `PWPUA0925`, `PWPUA1025`, `PW0AA0722` (near-match JIT `PWOAA0722`); still need `PWBA0523` |
| Emporio Armani | 37 | armani.com (+ Amazon.in / **Tata Cliq** / **Ethos** on miss) | **Batch run** (official URL-guess + retailers) | **30 ok / 7 fail**; Tata Cliq recovered AR11123, AR1704; remaining AR0488, AR11170, AR11503, AR115371, AR11741, AR1879, AR1947; batch `output/emporio-armani-batch/` |
| Armani Exchange | 31 | armani.com (+ Amazon.in / **Tata Cliq** / **Helios** / **JIT** / Ethos) | **Helios+JIT recover** | Prior 5 fails recovered to Spaces: **AX2194** Helios gallery (browser→Spaces); **AX2738/AX5573/AX5583** JIT; **AX2620** Tata migrate; batch `output/armani-exchange-helios-recover/` |
| Citizen | 16 | citizenwatches.store | Deferred | Angular SPA; API host opaque to Node |
| Balmain | (published-heavy) | balmainwatches.com | Done (prior) | |
| Victorinox | 0 need-details | victorinox.com (`/en/p/{sku}/`) + Collective / Tata / JIT / TGT / Ethos | **Need-recover done** | **3/3 ok** (`242095`, `242096`, `242099`) via official; applied to IMS; batch `output/victorinox-need-recover/` |

## Get details brands now supported

Balmain, Titan, Timex, **Tissot**, **Fossil**, **Casio**, **Seiko**, **Longines**, **Rado**, **Emporio Armani**, **Armani Exchange**, **Earnshaw**, **Alexandre Christie**, **Michael Kors**, **Phillip Plein**, **Victorinox**, **Alba**, **DKNY**

## India retailer miss-recovery

Prefer official brand / manufacturer sites first. Shared helper: `lib/retailerFallback.js` (always includes **Tata Cliq Luxury** unless skipped; **Just In Time** after Tata for all brands).

| Chain | Order |
|-------|-------|
| Luxury (default / Longines / Rado / Earnshaw / AC / MK / …) | Collective → **Tata Cliq** → **Just In Time** → TGT Luxe → **Ethos** |
| jit_first (Phillip Plein) | **Just In Time** → Collective → **Tata Cliq** → TGT Luxe → **Ethos** |
| Armani (EA / AX) | Amazon.in → **Tata Cliq** → **Just In Time** → **Ethos** |
| Casio | Collective → **Tata Cliq** → **Just In Time** → TGT Luxe → **Ethos** |
| Balmain | **Tata Cliq** (existing) + JIT in shared chain |

**Ethos** (`lib/ethos.js`): miss-recovery only; Node often hits Cloudflare — use REF URLs / `fixtures/ethos-{SKU}.html` when live is blocked. Helios stays out of scope.

## Image audit (2026-11-25)

Lessons from Tissot applied across all brand CLIs + preview:

1. **Wrong bytes vs extension** — SFCC/CDN often returns WebP for `.png`/`.jpg` URLs. All `run-*.js` + preview `/media` now sniff via `imageExtFromBuffer` (`lib/http.js`). Batch files renamed in place (0 mismatches remaining on priority batches).
2. **Gallery pollution** — scrapers must require SKU (or country-base) in image paths when HTML embeds related products.
   - **Seiko global**: fixed `extractImages` (require SKU/base); repaired `seiko-batch` (15 SKUs, 157 foreign URLs dropped).
   - **Tissot**: already fixed; cleaned `tissot-proof` / `tissot-live-proof` strap/related URLs.
   - Balmain / Rado / Titan / Armani already SKU-filtered; Longines gallery now drops foreign `L########` filenames; Casio/Fossil tightened.

Details: `output/_image-repair-summary.json`. Verify on https://samay-test.cognaitive.in (hard-refresh tiles).

## Retailer branding gate (2026-11-27)

**Policy:** Images from JIT / Helios / Watch Factory / Collective / Tata / Ethos / TGT / any `retailerFallback` source must pass a branding audit **before** they go forward to batch output or `Product.images`.

- Drop certificate / “Guaranteed Authentic” / retailer-logo slides (`Casio_Certificate`, `Just In Time`, `justintime.in`, etc.).
- Shared helper: `lib/retailerImageHygiene.js` (URL heuristics + known cert hashes).
- Wired into: JIT / TGT / Collective / Tata / Ethos extractors, `retailerFallback` ok-path, `merge.decideImages`, `migrate-external-images` recover/migrate, apply-batches.
- Live cleanup: `strip-retailer-certificate-images.js`.
