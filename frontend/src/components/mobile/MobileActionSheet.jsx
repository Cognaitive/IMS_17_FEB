import './MobileActionSheet.css'

const MobileActionSheet = ({
  isOpen,
  onClose,
  product,
  canPublish = false,
  canEdit = true,
  onApprove,
  onReject,
  onGetDetails,
  onDelete,
}) => {
  if (!isOpen) return null

  const unpublished = product?.isPublished !== true

  const runThenClose = (fn) => {
    onClose()
    setTimeout(() => {
      fn?.()
    }, 200)
  }

  return (
    <div className="mobile-action-sheet-overlay" onClick={onClose}>
      <div className="mobile-action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-action-sheet-handle"></div>
        <div className="mobile-action-sheet-actions">
          {canEdit && typeof onGetDetails === 'function' && (
            <button
              type="button"
              className="mobile-action-item"
              onClick={() => runThenClose(onGetDetails)}
            >
              <span className="action-icon">⬇️</span>
              <span className="action-label">Get details</span>
            </button>
          )}
          {canPublish && unpublished && typeof onApprove === 'function' && (
            <button
              type="button"
              className="mobile-action-item approve"
              onClick={() => runThenClose(onApprove)}
            >
              <span className="action-icon">✓</span>
              <span className="action-label">Approve & go live</span>
            </button>
          )}
          {canEdit && typeof onReject === 'function' && (
            <button
              type="button"
              className="mobile-action-item reject"
              onClick={() => runThenClose(onReject)}
            >
              <span className="action-icon">✕</span>
              <span className="action-label">Reject</span>
            </button>
          )}
          <button
            type="button"
            className="mobile-action-item danger"
            onClick={() => runThenClose(onDelete)}
          >
            <span className="action-icon">🗑️</span>
            <span className="action-label">Delete</span>
          </button>
        </div>
        <button className="mobile-action-sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default MobileActionSheet
