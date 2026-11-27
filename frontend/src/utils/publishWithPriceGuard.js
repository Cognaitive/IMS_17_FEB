/**
 * Approve & go live with price-anomaly soft confirm / hard block.
 * Matches IMS enrichment approve UX (window.confirm).
 */

function formatInr(n) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0)
}

function anomalyConfirmMessage(anomaly) {
  if (!anomaly) return 'Price looks off vs competitors. Continue anyway?'
  const range = `${formatInr(anomaly.competitorMin)}–${formatInr(anomaly.competitorMax)}`
  const sell = formatInr(anomaly.sellingPrice)
  const sources = Array.isArray(anomaly.sources)
    ? anomaly.sources
        .slice(0, 6)
        .map((s) => s.label || `${s.source} ${formatInr(s.amount)}`)
        .join('\n• ')
    : ''
  const direction =
    anomaly.kind === 'too_low' ? 'unusually low' : 'unusually high'
  return (
    `Price looks ${direction} vs competitors.\n\n` +
    `Selling: ${sell}\n` +
    `Competitor / reference range: ${range}\n` +
    (sources ? `\nSources:\n• ${sources}\n` : '\n') +
    `\nContinue and go live anyway?`
  )
}

/** Initial Approve & go live confirm (caller may set busy after this). */
export function confirmApproveGoLive(product) {
  if (!product?._id) return false
  const label = product.sku || product.title || 'this listing'
  return window.confirm(
    `Approve & go live "${label}"?\n\nGoes live immediately if it has a title, at least one image, and a selling price greater than ₹0 (inventory 0 / sold out is OK).`
  )
}

/**
 * @param {object} product
 * @param {(id: string, opts?: { confirmPriceAnomaly?: boolean }) => Promise<object>} publishFn
 * @param {{ skipInitialConfirm?: boolean }} [options]
 * @returns {Promise<{ published: boolean, cancelled?: boolean, response?: object }>}
 */
export async function approvePublishWithPriceGuard(
  product,
  publishFn,
  options = {}
) {
  if (!product?._id) return { published: false, cancelled: true }

  if (!options.skipInitialConfirm && !confirmApproveGoLive(product)) {
    return { published: false, cancelled: true }
  }

  try {
    const res = await publishFn(product._id)
    return { published: true, response: res }
  } catch (err) {
    const data = err.response?.data
    const code = data?.code
    const anomaly = data?.data?.anomaly

    if (code === 'PRICE_ANOMALY_CONFIRM' || data?.data?.requiresConfirmation) {
      if (!window.confirm(anomalyConfirmMessage(anomaly))) {
        return { published: false, cancelled: true }
      }
      const res = await publishFn(product._id, { confirmPriceAnomaly: true })
      return { published: true, response: res }
    }

    throw err
  }
}

export { anomalyConfirmMessage, formatInr }
