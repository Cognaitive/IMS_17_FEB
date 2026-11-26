/**
 * Watch refs are often stored compact (B48303382) while brands publish dotted
 * forms (B4830.33.82). Emit both so on-page SEO and Google match either query.
 */
export function getSkuVariants(rawSku) {
  const original = String(rawSku || '').trim()
  const compact = original.toUpperCase().replace(/[\s.\-_]/g, '')
  let dotted = original.toUpperCase().replace(/\s+/g, '')

  const balmain = compact.match(/^(B)(\d{4})(\d{2})(\d{2})$/i)
  if (balmain) {
    dotted = `${balmain[1]}${balmain[2]}.${balmain[3]}.${balmain[4]}`.toUpperCase()
  }

  const forms = []
  if (compact) forms.push(compact)
  if (dotted && dotted !== compact) forms.push(dotted)

  return {
    original,
    compact: compact || original,
    dotted: dotted || compact || original,
    forms,
    display: forms.join(' / ') || original,
    searchBlob: forms.join(' '),
  }
}

export function ensureSkuInText(text, skuVariants, { maxLen } = {}) {
  const base = String(text || '').trim()
  const blob = skuVariants?.searchBlob || ''
  if (!blob) return maxLen ? base.slice(0, maxLen) : base

  const missing = (skuVariants.forms || []).filter(
    (form) => form && !base.toUpperCase().includes(String(form).toUpperCase())
  )
  if (missing.length === 0) {
    return maxLen ? base.slice(0, maxLen) : base
  }

  const suffix = missing.join(' ')
  const joined = base ? `${base} ${suffix}` : suffix
  if (!maxLen || joined.length <= maxLen) return joined

  const room = maxLen - suffix.length - 1
  if (room < 24) return `${base.slice(0, Math.max(0, maxLen - suffix.length - 1)).trim()} ${suffix}`.slice(0, maxLen)
  return `${base.slice(0, room).trim()} ${suffix}`
}
