import { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AuthContext } from '../context/AuthContext'
import { isStoreAdmin } from '../utils/roles'
import { getDisplayBrand } from '../utils/brandUtils'
import {
  applyMismatchReport,
  getMismatchReports,
} from '../services/mismatchReportService'
import './ActivityHistory.css'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'applied', label: 'Applied' },
  { value: 'failed', label: 'Failed' },
]

const formatDate = (dateString) => {
  if (!dateString) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))
}

const formatProposal = (proposal) => {
  if (!proposal) return '—'
  const bits = []
  if (proposal.imageCount) bits.push(`${proposal.imageCount} image(s)`)
  if (proposal.title) bits.push(`title: ${proposal.title}`)
  if (proposal.price != null) bits.push(`price: ₹${proposal.price}`)
  if (proposal.oldPrice != null) bits.push(`MRP: ₹${proposal.oldPrice}`)
  if (!bits.length && Array.isArray(proposal.fill)) bits.push(proposal.fill.join(', '))
  return bits.join(' · ') || '—'
}

const formatBeforeAfter = (beforeAfter) => {
  if (!beforeAfter) return null
  const { before, after, fill } = beforeAfter
  const lines = []
  if (Array.isArray(fill) && fill.length) {
    lines.push(`Changed: ${fill.join(', ')}`)
  }
  if (before || after) {
    lines.push(
      `Title: ${before?.title || '—'} → ${after?.title || '—'}`
    )
    lines.push(
      `Price: ${before?.price != null ? `₹${before.price}` : '—'} → ${
        after?.price != null ? `₹${after.price}` : '—'
      }`
    )
    lines.push(
      `Images: ${before?.imageCount ?? 0} → ${after?.imageCount ?? 0}`
    )
  }
  return lines
}

const MismatchQueue = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { realUser, loading: authLoading } = useContext(AuthContext)
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState(null)
  const [applyingId, setApplyingId] = useState(null)

  const canView = isStoreAdmin(realUser)

  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    page: parseInt(searchParams.get('page') || '1', 10),
    limit: parseInt(searchParams.get('limit') || '25', 10),
  })

  useEffect(() => {
    if (!authLoading && !canView) {
      navigate('/dashboard', { replace: true })
    }
  }, [authLoading, canView, navigate])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.status) params.set('status', filters.status)
    if (filters.page > 1) params.set('page', String(filters.page))
    if (filters.limit !== 25) params.set('limit', String(filters.limit))
    setSearchParams(params, { replace: true })
  }, [filters, setSearchParams])

  const queryParams = useMemo(
    () => ({
      page: filters.page,
      limit: filters.limit,
      status: filters.status || undefined,
    }),
    [filters.page, filters.limit, filters.status]
  )

  const { data, isLoading } = useQuery({
    queryKey: ['mismatch-reports', queryParams],
    queryFn: () => getMismatchReports(queryParams),
    enabled: canView,
    keepPreviousData: true,
  })

  const rows = data?.data || []
  const pagination = {
    page: data?.page || 1,
    limit: data?.limit || 25,
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
  }

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  const handleApply = async (report) => {
    if (!report?._id) return
    const label = report.sku || report.title || 'this listing'
    const summary = formatProposal(report.proposal)
    const ok = window.confirm(
      `Apply mismatch fix to live listing "${label}"?\n\n${summary}\n\nThis overwrites current gallery/fields on the storefront.`
    )
    if (!ok) return

    setApplyingId(report._id)
    try {
      const res = await applyMismatchReport(report._id)
      toast.success(res?.message || 'Mismatch fix applied')
      queryClient.invalidateQueries({ queryKey: ['mismatch-reports'] })
      if (selected?._id === report._id && res?.data) {
        setSelected((prev) =>
          prev
            ? {
                ...prev,
                status: 'applied',
                beforeAfter: res.data.beforeAfter || prev.beforeAfter,
                proposal: res.data.proposal || prev.proposal,
                appliedAt: new Date().toISOString(),
              }
            : prev
        )
      }
    } catch (err) {
      toast.error(
        err.response?.data?.message || err.message || 'Apply failed'
      )
      queryClient.invalidateQueries({ queryKey: ['mismatch-reports'] })
    } finally {
      setApplyingId(null)
    }
  }

  if (authLoading || !canView) {
    return (
      <div className="activity-history-page">
        <div className="loading">Loading…</div>
      </div>
    )
  }

  return (
    <div className="activity-history-page">
      <div className="activity-history-header">
        <div className="breadcrumb">
          <button onClick={() => navigate('/dashboard')} className="breadcrumb-link">
            Dashboard
          </button>
          <span className="breadcrumb-separator">›</span>
          <span className="breadcrumb-current">Mismatch queue</span>
        </div>
        <div className="page-title-section">
          <h1>Mismatch queue</h1>
          <p className="page-subtitle">
            Staff mismatch reports — proposals, applied fixes, and failures
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate('/dashboard')} className="btn-back">
            ← Back to Dashboard
          </button>
        </div>
      </div>

      <div className="activity-history-filters">
        <div className="filters-row">
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="filter-select"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setFilters({ status: '', page: 1, limit: 25 })}
            className="btn-clear-filters"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="activity-history-content">
        <div className="table-controls">
          <div className="results-count">
            {pagination.total} report{pagination.total === 1 ? '' : 's'}
          </div>
          <div className="rows-per-page">
            <label htmlFor="mismatch-limit">Rows</label>
            <select
              id="mismatch-limit"
              className="limit-select"
              value={filters.limit}
              onChange={(e) =>
                handleFilterChange('limit', parseInt(e.target.value, 10))
              }
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading && rows.length === 0 ? (
          <div className="loading">Loading mismatch queue…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">No mismatch reports match this filter.</div>
        ) : (
          <div className="activity-table-container">
            <table className="activity-table">
              <thead className="sticky-header">
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Brand / SKU</th>
                  <th>Reported by</th>
                  <th>Competitor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <span className={`mismatch-status mismatch-status-${row.status}`}>
                        {row.status}
                      </span>
                      {row.isPublished ? (
                        <div className="admin-email">published</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="admin-info">
                        <div className="admin-name">
                          {getDisplayBrand(row.brand) || '—'}
                        </div>
                        <div className="admin-email">{row.sku || row.title || '—'}</div>
                      </div>
                    </td>
                    <td className="table-cell-admin">
                      <div className="admin-info">
                        <div className="admin-name">{row.reporterName || '—'}</div>
                        <div className="admin-email">{row.reporterEmail || ''}</div>
                      </div>
                    </td>
                    <td>
                      <a
                        href={row.competitorUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mismatch-url"
                      >
                        {row.proposal?.source || 'Open URL'}
                      </a>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pagination-btn"
                        onClick={() => setSelected(row)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div className="pagination">
            <button
              disabled={pagination.page <= 1}
              onClick={() => setFilters((p) => ({ ...p, page: p.page - 1 }))}
              className="pagination-btn"
            >
              Previous
            </button>
            <span className="pagination-info">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))}
              className="pagination-btn"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div className="mismatch-detail-overlay" onClick={() => setSelected(null)}>
          <div
            className="mismatch-detail-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="mismatch-detail-header">
              <h2>Mismatch report</h2>
              <button
                type="button"
                className="mismatch-detail-close"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <div className="mismatch-detail-body">
              <p>
                <strong>Status:</strong> {selected.status}
                {selected.isPublished ? ' · published listing' : ' · unpublished'}
              </p>
              <p>
                <strong>Product:</strong>{' '}
                {getDisplayBrand(selected.brand) || '—'} / {selected.sku || '—'}
                {selected.title ? ` — ${selected.title}` : ''}
              </p>
              <p>
                <strong>Reported by:</strong>{' '}
                {selected.reporterName || '—'}
                {selected.reporterEmail ? ` (${selected.reporterEmail})` : ''}
              </p>
              <p>
                <strong>When:</strong> {formatDate(selected.createdAt)}
              </p>
              <p>
                <strong>Competitor URL:</strong>{' '}
                <a href={selected.competitorUrl} target="_blank" rel="noreferrer">
                  {selected.competitorUrl}
                </a>
              </p>
              {selected.note ? (
                <p>
                  <strong>Note:</strong> {selected.note}
                </p>
              ) : null}
              <p>
                <strong>Proposal:</strong> {formatProposal(selected.proposal)}
              </p>
              {selected.proposal?.previewImages?.length ? (
                <div className="mismatch-preview-images">
                  {selected.proposal.previewImages.map((src) => (
                    <img key={src} src={src} alt="" />
                  ))}
                </div>
              ) : null}
              {formatBeforeAfter(selected.beforeAfter)?.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {selected.errorMessage ? (
                <p className="mismatch-error">
                  <strong>Error:</strong> {selected.errorMessage}
                </p>
              ) : null}
              {selected.appliedAt ? (
                <p>
                  <strong>Applied:</strong> {formatDate(selected.appliedAt)}
                  {selected.appliedByName ? ` by ${selected.appliedByName}` : ''}
                </p>
              ) : null}
            </div>
            <div className="mismatch-detail-actions">
              {['pending', 'proposed'].includes(selected.status) &&
              selected.isPublished ? (
                <button
                  type="button"
                  className="btn-back"
                  disabled={applyingId === selected._id}
                  onClick={() => handleApply(selected)}
                >
                  {applyingId === selected._id ? 'Applying…' : 'Confirm & apply'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-clear-filters"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MismatchQueue
