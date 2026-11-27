# DKNY enrichment

- **Primary:** Just In Time (`justintime.in`) Shopify JSON — preset `jit_first`
- **Chain:** JIT → Helios → Collective → Tata Cliq → TGT Luxe → Ethos
- **SKU form:** `DK1G135M0055`, `DK1L024M0135`, …
- **Images:** retailer certificate is usually the **last** gallery slide (`DKNY_Certificate_*`); stripped by `retailerImageHygiene` / JIT extractor
- **Get details:** `POST /api/products/:id/enrich` (brand `DKNY`) — needs backend + IMS UI deploy

```bash
node run-dkny.js DK1G135M0055 --jit-only
node run-dkny.js --csv input/dkny-skus.csv --download-images --out output/dkny-batch
```
