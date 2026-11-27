const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  detectPriceAnomaly,
  evaluatePublishPriceAnomaly,
  CODE_CONFIRM,
  CODE_BLOCK,
} = require("../utils/priceAnomaly");
const { collectCompetitorPriceRefs } = require("../utils/competitorPriceRefs");
const {
  applyPublishOnApprove,
  hasExtremePriceAnomaly,
} = require("../scripts/enrichment/lib/publishOnApprove");

describe("price anomaly detection", () => {
  const refs = [
    { source: "Tata Cliq", amount: 10000 },
    { source: "MRP", mrp: 15000 },
  ];

  it("returns null when price is within competitor range", () => {
    assert.equal(detectPriceAnomaly(11000, refs), null);
  });

  it("soft-flags unusually low prices", () => {
    const a = detectPriceAnomaly(4000, refs);
    assert.equal(a.level, "soft");
    assert.equal(a.kind, "too_low");
    assert.equal(a.code, CODE_CONFIRM);
    assert.equal(a.competitorMin, 10000);
    assert.equal(a.competitorMax, 15000);
  });

  it("hard-blocks extreme low prices", () => {
    const a = detectPriceAnomaly(1500, refs);
    assert.equal(a.level, "hard");
    assert.equal(a.kind, "too_low");
    assert.equal(a.code, CODE_BLOCK);
  });

  it("soft-flags unusually high prices", () => {
    const a = detectPriceAnomaly(25000, refs);
    assert.equal(a.level, "soft");
    assert.equal(a.kind, "too_high");
  });

  it("hard-blocks extreme high prices", () => {
    const a = detectPriceAnomaly(50000, refs);
    assert.equal(a.level, "hard");
    assert.equal(a.kind, "too_high");
  });

  it("requires confirm for soft anomalies unless overridden", () => {
    const blocked = evaluatePublishPriceAnomaly(
      { price: 4000 },
      { refs, confirmPriceAnomaly: false }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.httpStatus, 409);

    const allowed = evaluatePublishPriceAnomaly(
      { price: 4000 },
      { refs, confirmPriceAnomaly: true }
    );
    assert.equal(allowed.ok, true);
    assert.equal(allowed.confirmed, true);
  });

  it("never allows hard anomalies even with confirm", () => {
    const blocked = evaluatePublishPriceAnomaly(
      { price: 1000 },
      { refs, confirmPriceAnomaly: true }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.httpStatus, 400);
  });

  it("collects MRP from product.oldPrice", () => {
    const collected = collectCompetitorPriceRefs({
      sku: "NO-ENRICH-SKU-XYZ",
      price: 5000,
      oldPrice: 12000,
    });
    assert.ok(collected.some((r) => r.mrp === 12000));
  });
});

describe("publishOnApprove extreme price gate", () => {
  const base = {
    title: "Watch",
    images: ["https://example.com/a.jpg"],
    price: 1000,
    oldPrice: 12000,
    inventory: 0,
  };

  it("detects extreme anomaly vs oldPrice", () => {
    assert.equal(hasExtremePriceAnomaly(base), true);
  });

  it("skips publish for extreme anomaly", () => {
    const result = applyPublishOnApprove(base, {}, { publish: true });
    assert.equal(result.published, false);
    assert.equal(result.reason, "extreme_price_anomaly");
    assert.equal(result.patch.isPublished, undefined);
  });

  it("still publishes borderline soft anomalies on CLI", () => {
    const doc = { ...base, price: 5000, oldPrice: 12000 };
    assert.equal(hasExtremePriceAnomaly(doc), false);
    const result = applyPublishOnApprove(doc, {}, { publish: true });
    assert.equal(result.published, true);
  });
});
