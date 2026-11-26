import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import './ViewAsBanner.css'

const ViewAsBanner = () => {
  const { isViewAs, viewAsStaff, exitViewAs } = useContext(AuthContext)

  if (!isViewAs || !viewAsStaff) return null

  return (
    <div className="view-as-banner" role="status">
      <span className="view-as-banner-text">
        Viewing as <strong>{viewAsStaff.name}</strong> — read only
      </span>
      <button type="button" className="view-as-banner-exit" onClick={exitViewAs}>
        Exit
      </button>
    </div>
  )
}

export default ViewAsBanner
