import { memo } from 'react'
import { FixedSizeList as List } from 'react-window'
import ProductThumbnail from './ProductThumbnail'
import { getDisplayBrand } from '../utils/brandUtils'
import { isEnrichableProduct } from '../utils/enrichmentBrands'
import './InventoryTable.css'

function countImages(product) {
  if (!product) return 0
  let n = 0
  if (Array.isArray(product.images)) {
    for (const img of product.images) {
      if (typeof img === 'string' && img.trim()) n += 1
      else if (img && typeof img === 'object' && (img.url || img.src)) n += 1
    }
  }
  if ((product.imageUrl || '').trim()) n += 1
  if ((product.image?.url || '').trim()) n += 1
  return n
}

function isReadyToPublish(product) {
  return Boolean((product?.title || '').trim()) && countImages(product) > 0
}

const InventoryTable = memo(({
  products,
  onView,
  onEdit,
  onDelete,
  onGetDetails,
  onApprove,
  onReject,
  enrichmentBusy = null,
  loading,
  selectedIds,
  onSelectionChange,
  page = 1,
  limit = 50,
  canEdit = true,
  canPublish = false,
}) => {
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value)
  }

  // Memoized row component for performance
  const Row = memo(({ index, style, data }) => {
    const product = data.products[index]
    const selectedIds = data.selectedIds
    const onSelectionChange = data.onSelectionChange
    const onView = data.onView
    const onEdit = data.onEdit
    const onDelete = data.onDelete
    const onGetDetails = data.onGetDetails
    const onApprove = data.onApprove
    const onReject = data.onReject
    const enrichmentBusy = data.enrichmentBusy
    const page = data.page || 1
    const limit = data.limit || 50
    const canEdit = data.canEdit ?? true
    const canPublish = data.canPublish ?? false
    
    if (!product) return null
    
    const totalValue = (product.inventory || 0) * (product.price || 0)
    const serial = (page - 1) * limit + index + 1
    const isSelected = selectedIds?.has(product._id) || false
    const enrichable = isEnrichableProduct(product)
    const gettingDetails = enrichmentBusy === `scan-${product._id}`
    const publishing = enrichmentBusy === `pub-${product._id}`
    const rejecting = enrichmentBusy === `rej-${product._id}`
    const unpublished = product.isPublished !== true
    const ready = isReadyToPublish(product)
    const busy = !!enrichmentBusy

    const handleCheckboxChange = (e) => {
      const newSelectedIds = new Set(selectedIds || [])
      if (e.target.checked) {
        newSelectedIds.add(product._id)
      } else {
        newSelectedIds.delete(product._id)
      }
      onSelectionChange?.(newSelectedIds)
    }

    return (
      <div style={style} className="table-row">
        <div className="table-cell checkbox">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            className="row-checkbox"
          />
        </div>
        <div className="table-cell serial">
          {serial}
        </div>
        <div className="table-cell image">
          <ProductThumbnail
            product={product}
            alt={product.brand || 'Product'}
            size={44}
            onClick={() => onView(product)}
          />
        </div>
        <div className="table-cell brand">{getDisplayBrand(product.brand) || '-'}</div>
        <div className="table-cell sku">{product.sku || '-'}</div>
        <div className="table-cell category">{product.category || '-'}</div>
        <div className="table-cell inventory">
          <span className={product.inventory === 0 ? 'out-of-stock' : ''}>
            {product.inventory || 0}
          </span>
        </div>
        <div className="table-cell price">
          {product.oldPrice && product.oldPrice > product.price ? (
            <>
              <span style={{ textDecoration: 'line-through', color: '#666', marginRight: '0.5rem' }}>
                {formatCurrency(product.oldPrice)}
              </span>
              {formatCurrency(product.price || 0)}
            </>
          ) : (
            formatCurrency(product.price || 0)
          )}
        </div>
        <div className="table-cell total-value">{formatCurrency(totalValue)}</div>
        <div className="table-cell actions">
          <button
            onClick={() => onView(product)}
            className="action-btn view-btn"
            title="View"
            aria-label="View"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          {canEdit && (
            <>
              <button
                onClick={() => onEdit(product)}
                className="action-btn edit-btn"
                title="Edit"
                aria-label="Edit"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              {enrichable && typeof onGetDetails === 'function' && (
                <button
                  type="button"
                  onClick={() => onGetDetails(product)}
                  className="action-btn enrich-btn"
                  disabled={busy}
                  aria-label={
                    gettingDetails
                      ? 'Getting product details'
                      : 'Get details from brand site'
                  }
                  title="Get details (does not publish)"
                >
                  {gettingDetails ? (
                    <span className="enrich-btn-spinner" aria-hidden="true" />
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                </button>
              )}
              {canPublish && unpublished && typeof onApprove === 'function' && (
                <button
                  type="button"
                  onClick={() => onApprove(product)}
                  className={`action-btn approve-btn${ready ? ' emphasize' : ''}`}
                  disabled={busy}
                  aria-label={publishing ? 'Publishing' : 'Approve and go live'}
                  title={
                    ready
                      ? 'Approve & go live — publish now (sold-out OK)'
                      : 'Approve & go live (needs title + image)'
                  }
                >
                  {publishing ? (
                    <span className="enrich-btn-spinner" aria-hidden="true" />
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )}
              {typeof onReject === 'function' && (
                <button
                  type="button"
                  onClick={() => onReject(product)}
                  className="action-btn reject-btn"
                  disabled={busy}
                  aria-label={rejecting ? 'Rejecting enrichment' : 'Reject enrichment'}
                  title="Reject — clear photos & scraped details; keep brand/SKU/price"
                >
                  {rejecting ? (
                    <span className="enrich-btn-spinner" aria-hidden="true" />
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </button>
              )}
              <button
                onClick={() => onDelete(product)}
                className="action-btn delete-btn"
                title="Delete"
                aria-label="Delete"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              </button>
            </>
          )}
        </div>
      </div>
    )
  })

  if (loading && products.length === 0) {
    return (
      <div className="table-container">
        <div className="loading-message">Loading products...</div>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="table-container">
        <div className="empty-message">No products found</div>
      </div>
    )
  }

  return (
    <div className="table-container">
      <div className="table-header">
        <div className="table-cell checkbox">
          <input
            type="checkbox"
            checked={products.length > 0 && products.every(p => selectedIds?.has(p._id))}
            onChange={(e) => {
              const newSelectedIds = new Set(selectedIds || [])
              if (e.target.checked) {
                products.forEach(p => newSelectedIds.add(p._id))
              } else {
                products.forEach(p => newSelectedIds.delete(p._id))
              }
              onSelectionChange?.(newSelectedIds)
            }}
            className="header-checkbox"
          />
        </div>
        <div className="table-cell serial">S.No</div>
        <div className="table-cell image">Image</div>
        <div className="table-cell brand">Brand</div>
        <div className="table-cell sku">SKU</div>
        <div className="table-cell category">Category</div>
        <div className="table-cell inventory">Inventory</div>
        <div className="table-cell price">Price</div>
        <div className="table-cell total-value">Total Value</div>
        <div className="table-cell actions">Actions</div>
      </div>
      <div className="table-body">
        <List
          height={Math.min(600, products.length * 50)}
          itemCount={products.length}
          itemSize={50}
          width="100%"
          itemData={{
            products,
            selectedIds,
            onSelectionChange,
            onView,
            onEdit,
            onDelete,
            onGetDetails,
            onApprove,
            onReject,
            enrichmentBusy,
            page,
            limit,
            canEdit,
            canPublish,
          }}
        >
          {Row}
        </List>
      </div>
    </div>
  )
})

InventoryTable.displayName = 'InventoryTable'

export default InventoryTable
