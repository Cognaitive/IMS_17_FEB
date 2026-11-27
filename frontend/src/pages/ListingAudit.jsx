import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getListingAudit, getBrands } from '../services/productService'
import { useDebounce } from '../hooks/useDebounce'
import { getDisplayBrand } from '../utils/brandUtils'
import './ActivityHistory.css'

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

const ListingAudit = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    brand: searchParams.get('brand') || '',
    staffId: searchParams.get('staff') || '',
    staffRole: searchParams.get('role') || 'any',
    page: parseInt(searchParams.get('page') || '1', 10),
    limit: parseInt(searchParams.get('limit') || '25', 10),
  })

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.search) params.set('search', filters.search)
    if (filters.brand) params.set('brand', filters.brand)
    if (filters.staffId) params.set('staff', filters.staffId)
    if (filters.staffRole && filters.staffRole !== 'any') params.set('role', filters.staffRole)
    if (filters.page > 1) params.set('page', String(filters.page))
    if (filters.limit !== 25) params.set('limit', String(filters.limit))
    setSearchParams(params, { replace: true })
  }, [filters, setSearchParams])

  const debouncedSearch = useDebounce(filters.search, 400)

  const queryParams = useMemo(
    () => ({
      page: filters.page,
      limit: filters.limit,
      brand: filters.brand || undefined,
      search: debouncedSearch || undefined,
      staffId: filters.staffId || undefined,
      staffRole: filters.staffRole || 'any',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    }),
    [filters.page, filters.limit, filters.brand, filters.staffId, filters.staffRole, debouncedSearch]
  )

  const { data, isLoading } = useQuery({
    queryKey: ['listing-audit', queryParams],
    queryFn: () => getListingAudit(queryParams),
    keepPreviousData: true,
  })

  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
    staleTime: 5 * 60 * 1000,
  })

  const rows = data?.data || []
  const staff = data?.staff || []
  const brands = brandsData?.data || []
  const pagination = {
    page: data?.page || 1,
    limit: data?.limit || 25,
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
  }

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  const handleClearFilters = () => {
    setFilters({
      search: '',
      brand: '',
      staffId: '',
      staffRole: 'any',
      page: 1,
      limit: 25,
    })
  }

  return (
    <div className="activity-history-page">
      <div className="activity-history-header">
        <div className="breadcrumb">
          <button onClick={() => navigate('/dashboard')} className="breadcrumb-link">
            Dashboard
          </button>
          <span className="breadcrumb-separator">›</span>
          <span className="breadcrumb-current">Listing Audit</span>
        </div>
        <div className="page-title-section">
          <h1>Listing Audit</h1>
          <p className="page-subtitle">
            Who entered each listing and who last updated it (staff-based Updated at)
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate('/activity-history')} className="btn-back">
            Activity History
          </button>
          <button onClick={() => navigate('/dashboard')} className="btn-back">
            ← Back to Dashboard
          </button>
        </div>
      </div>

      <div className="activity-history-filters">
        <div className="filters-row">
          <input
            type="text"
            placeholder="Search brand, SKU, title, or staff…"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="filter-input search-input"
          />
          <select
            value={filters.brand}
            onChange={(e) => handleFilterChange('brand', e.target.value)}
            className="filter-select"
          >
            <option value="">All Brands</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {getDisplayBrand(brand)}
              </option>
            ))}
          </select>
          <select
            value={filters.staffId}
            onChange={(e) => handleFilterChange('staffId', e.target.value)}
            className="filter-select"
          >
            <option value="">All Staff</option>
            {staff.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name || s.email || s._id}
              </option>
            ))}
          </select>
          <select
            value={filters.staffRole}
            onChange={(e) => handleFilterChange('staffRole', e.target.value)}
            className="filter-select"
            disabled={!filters.staffId}
            title={!filters.staffId ? 'Pick a staff member first' : undefined}
          >
            <option value="any">Entered or updated</option>
            <option value="entered">Entered by</option>
            <option value="updated">Last updated by</option>
          </select>
          <button onClick={handleClearFilters} className="btn-clear-filters">
            Clear
          </button>
        </div>
      </div>

      <div className="activity-history-content">
        {isLoading && rows.length === 0 ? (
          <div className="loading">Loading listing audit…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">No listings match these filters.</div>
        ) : (
          <div className="activity-table-container">
            <table className="activity-table">
              <thead className="sticky-header">
                <tr>
                  <th>Brand</th>
                  <th>Product / Ref</th>
                  <th>Entered by</th>
                  <th>Created at</th>
                  <th>Last updated by</th>
                  <th>Updated at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td className="table-cell-brand">
                      {getDisplayBrand(row.brand) || '—'}
                    </td>
                    <td>
                      <div className="admin-info">
                        <div className="admin-name">{row.title || '—'}</div>
                        <div className="admin-email">{row.sku || '—'}</div>
                      </div>
                    </td>
                    <td className="table-cell-admin">
                      <div className="admin-info">
                        <div className="admin-name">
                          {row.createdByName || '—'}
                        </div>
                        <div className="admin-email">{row.createdByEmail || ''}</div>
                      </div>
                    </td>
                    <td>{formatDate(row.createdAt)}</td>
                    <td className="table-cell-admin">
                      <div className="admin-info">
                        <div className="admin-name">
                          {row.updatedByName || '—'}
                        </div>
                        <div className="admin-email">{row.updatedByEmail || ''}</div>
                      </div>
                    </td>
                    <td>{formatDate(row.updatedAt)}</td>
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
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} listings)
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
    </div>
  )
}

export default ListingAudit
