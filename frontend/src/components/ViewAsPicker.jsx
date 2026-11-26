import { useContext, useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { AuthContext } from '../context/AuthContext'
import storeAdminService from '../services/storeAdminService'
import './ViewAsPicker.css'

const ViewAsPicker = () => {
  const { realUser, isViewAs, startViewAs } = useContext(AuthContext)
  const [staffs, setStaffs] = useState([])
  const [loading, setLoading] = useState(false)
  const [value, setValue] = useState('')

  const role = String(realUser?.role || '').toLowerCase()
  const canViewAs = ['owner', 'admin'].includes(role) && !isViewAs

  useEffect(() => {
    if (!canViewAs) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await storeAdminService.getStaffs()
        if (!cancelled && res.success) {
          setStaffs(res.data || [])
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load staff for view-as', err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [canViewAs])

  if (!canViewAs) return null

  const onChange = async (e) => {
    const id = e.target.value
    setValue('')
    if (!id) return
    const staff = staffs.find((s) => String(s._id) === id)
    if (!staff) return
    const result = await startViewAs(staff)
    if (!result?.success) {
      toast.error(result?.message || 'Could not start view-as')
    } else {
      toast.success(`Viewing as ${staff.name} (read only)`)
    }
  }

  return (
    <div className="view-as-picker">
      <label htmlFor="view-as-select" className="view-as-picker-label">
        View as
      </label>
      <select
        id="view-as-select"
        className="view-as-picker-select"
        value={value}
        onChange={onChange}
        disabled={loading || staffs.length === 0}
      >
        <option value="">
          {loading
            ? 'Loading staff…'
            : staffs.length === 0
              ? 'Myself (no staff accounts)'
              : 'Myself'}
        </option>
        {staffs.map((s) => (
          <option key={s._id} value={s._id}>
            {s.name}
            {s.allowedBrands?.length
              ? ` (${s.allowedBrands.slice(0, 3).join(', ')}${s.allowedBrands.length > 3 ? '…' : ''})`
              : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export default ViewAsPicker
