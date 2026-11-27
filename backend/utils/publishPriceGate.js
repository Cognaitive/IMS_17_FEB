/**
 * Shared publish gate for price anomalies (extends storeEligibility ₹0 block).
 */

const { collectCompetitorPriceRefs } = require("./competitorPriceRefs");
const {
  evaluatePublishPriceAnomaly,
  anomalyResponsePayload,
} = require("./priceAnomaly");

function truthyConfirm(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

/**
 * @param {object} doc - product or merged preview
 * @param {object} body - request body (confirmPriceAnomaly)
 * @returns {{ ok: true, anomaly?: object, confirmed?: boolean } | { ok: false, httpStatus: number, payload: object }}
 */
function gatePublishPriceAnomaly(doc, body = {}) {
  const refs = collectCompetitorPriceRefs(doc);
  const result = evaluatePublishPriceAnomaly(doc, {
    refs,
    confirmPriceAnomaly: truthyConfirm(body.confirmPriceAnomaly),
  });
  if (result.ok) return result;
  return {
    ok: false,
    httpStatus: result.httpStatus,
    payload: anomalyResponsePayload(result),
  };
}

module.exports = {
  gatePublishPriceAnomaly,
  truthyConfirm,
};
