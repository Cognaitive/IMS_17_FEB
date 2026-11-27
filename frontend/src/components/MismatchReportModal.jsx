import { useEffect, useState } from 'react'
import { getDisplayBrand } from '../utils/brandUtils'
import './MismatchReportModal.css'

const MismatchReportModal = ({
  isOpen,
  onClose,
  onSubmit,
  product,
  submitting = false,
}) => {
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (isOpen) {
      setUrl('')
      setNote('')
    }
  }, [isOpen, product?._id])

  if (!isOpen || !product) return null

  const label =
    product.sku ||
    product.title ||
    getDisplayBrand(product.brand) ||
    'this listing'
  const published = product.isPublished === true

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl || submitting) return
    onSubmit?.({
      url: trimmedUrl,
      note: note.trim(),
      product,
    })
  }

  return (
    <div className="mismatch-report-overlay" onClick={onClose}>
      <div
        className="mismatch-report-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mismatch-report-title"
      >
        <div className="mismatch-report-header">
          <h3 id="mismatch-report-title">Report mismatch</h3>
          <p className="mismatch-report-sub">
            Paste a competitor PDP (Tata / JIT / Helios / etc.) for{' '}
            <strong>{label}</strong>. We&apos;ll pull images
            {published ? ' (confirm before writing — live listing)' : ''}
            {published ? '' : ' and apply automatically'}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mismatch-report-form">
          <label className="mismatch-report-label" htmlFor="mismatch-url">
            Competitor URL
          </label>
          <input
            id="mismatch-url"
            type="url"
            className="mismatch-report-input"
            placeholder="https://luxury.tatacliq.com/… or justintime.in/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            autoFocus
            disabled={submitting}
          />

          <label className="mismatch-report-label" htmlFor="mismatch-note">
            Note (optional)
          </label>
          <textarea
            id="mismatch-note"
            className="mismatch-report-textarea"
            placeholder="Wrong image / price / title…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            disabled={submitting}
          />

          <div className="mismatch-report-actions">
            <button
              type="button"
              className="mismatch-report-btn cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="mismatch-report-btn submit"
              disabled={submitting || !url.trim()}
            >
              {submitting ? 'Working…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default MismatchReportModal
