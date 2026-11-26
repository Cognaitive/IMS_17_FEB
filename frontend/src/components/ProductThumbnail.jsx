import { memo, useEffect, useMemo, useState } from 'react'
import { getImageUrls, getThumbnailUrl, isValidImageUrl } from '../utils/imageUtils'
import './ProductThumbnail.css'

const ProductThumbnail = memo(({ 
  product, // Accept product object directly
  alt = 'Product', 
  size = 44, 
  onClick,
  className = '' 
}) => {
  // Try images[] in order; fall through on load error so one dead URL
  // does not force the cardboard placeholder when later slots still work.
  const candidates = useMemo(() => {
    const urls = getImageUrls(product)
    if (urls.length) return urls
    const legacy = getThumbnailUrl(product)
    return isValidImageUrl(legacy) ? [legacy] : []
  }, [product])

  const [urlIndex, setUrlIndex] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)

  useEffect(() => {
    setUrlIndex(0)
    setImageLoaded(false)
  }, [candidates])

  const url = candidates[urlIndex] || null
  const exhausted = candidates.length === 0 || urlIndex >= candidates.length

  const handleImageLoad = () => {
    setImageLoaded(true)
  }

  const handleImageError = () => {
    setImageLoaded(false)
    setUrlIndex((i) => i + 1)
  }

  const hasImage = isValidImageUrl(url) && !exhausted

  return (
    <div 
      className={`product-thumbnail ${className} ${onClick ? 'clickable' : ''}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View ${alt}` : undefined}
    >
      {!hasImage ? (
        <div className="product-thumbnail-placeholder">
          <span className="placeholder-icon">📦</span>
        </div>
      ) : (
        <>
          {!imageLoaded && (
            <div className="product-thumbnail-skeleton">
              <div className="skeleton-shimmer"></div>
            </div>
          )}
          <img
            key={url}
            src={url}
            alt={alt}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
            className={`product-thumbnail-img ${imageLoaded ? 'loaded' : ''}`}
            style={{ width: `${size}px`, height: `${size}px` }}
          />
        </>
      )}
    </div>
  )
})

ProductThumbnail.displayName = 'ProductThumbnail'

export default ProductThumbnail

