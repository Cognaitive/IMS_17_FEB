import { createContext, useState, useEffect, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { hasImsAccess, isStoreAdmin } from '../utils/roles'

export const AuthContext = createContext()

const VIEW_AS_KEY = 'viewAsStaffId'
const VIEW_AS_CACHE_KEY = 'viewAsStaffCache'

// Prefer long-lived token from localStorage, then fall back to sessionStorage
const getInitialToken = () => {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token') || sessionStorage.getItem('token')
}

const NO_ACCESS_MESSAGE = 'This account does not have access to the IMS. Please contact the store owner.'

const normalizeStaffPreview = (staff) => {
  if (!staff) return null
  return {
    id: staff.id || staff._id,
    _id: staff._id || staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role || 'staff',
    allowedBrands: staff.allowedBrands || [],
    canEditProducts: staff.canEditProducts ?? true,
    canViewStats: staff.canViewStats ?? true,
    canEditBasicInfo: staff.canEditBasicInfo ?? true,
    canEditSeo: staff.canEditSeo ?? true,
    canAccessFilters: staff.canAccessFilters ?? true,
    hasSeoAccess: staff.hasSeoAccess || false,
  }
}

/** Overlay staff brand/permission flags; force read-only edit switches while previewing. */
const buildEffectiveUser = (real, staff) => {
  if (!real || !staff) return real
  return {
    ...real,
    name: staff.name,
    email: staff.email,
    role: 'staff',
    allowedBrands: staff.allowedBrands || [],
    canEditProducts: false,
    canViewStats: staff.canViewStats !== false,
    canEditBasicInfo: false,
    canEditSeo: false,
    canAccessFilters: staff.canAccessFilters !== false,
    hasSeoAccess: false,
  }
}

export const AuthProvider = ({ children }) => {
  const [realUser, setRealUser] = useState(null)
  const [viewAsStaff, setViewAsStaff] = useState(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState(getInitialToken)
  const queryClient = useQueryClient()

  const clearViewAsStorage = () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem(VIEW_AS_KEY)
    sessionStorage.removeItem(VIEW_AS_CACHE_KEY)
  }

  const persistViewAs = (staff) => {
    if (typeof window === 'undefined' || !staff) return
    const normalized = normalizeStaffPreview(staff)
    sessionStorage.setItem(VIEW_AS_KEY, String(normalized.id || normalized._id))
    sessionStorage.setItem(VIEW_AS_CACHE_KEY, JSON.stringify(normalized))
  }

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      fetchUser()
    } else {
      setLoading(false)
    }
  }, [token])

  const fetchUser = async () => {
    try {
      const response = await api.get('/auth/me')
      if (!hasImsAccess(response.data.user)) throw new Error(NO_ACCESS_MESSAGE)
      setRealUser(response.data.user)

      if (response.data.viewAs) {
        const preview = normalizeStaffPreview(response.data.viewAs)
        setViewAsStaff(preview)
        persistViewAs(preview)
      } else if (typeof window !== 'undefined') {
        const cached = sessionStorage.getItem(VIEW_AS_CACHE_KEY)
        const cachedId = sessionStorage.getItem(VIEW_AS_KEY)
        if (cached && cachedId) {
          try {
            setViewAsStaff(normalizeStaffPreview(JSON.parse(cached)))
          } catch {
            clearViewAsStorage()
            setViewAsStaff(null)
          }
        } else {
          setViewAsStaff(null)
        }
      }
    } catch (error) {
      const status = error.response?.status
      // Only wipe the session on auth failures (or IMS role rejection).
      // Network blips / aborts / 5xx must not force a login redirect.
      const clearSession =
        status === 401 ||
        status === 403 ||
        error.message === NO_ACCESS_MESSAGE
      if (clearSession) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token')
          sessionStorage.removeItem('token')
        }
        clearViewAsStorage()
        setToken(null)
        setRealUser(null)
        setViewAsStaff(null)
        delete api.defaults.headers.common['Authorization']
      }
    } finally {
      setLoading(false)
    }
  }

  const login = async (email, password, rememberMe = true) => {
    try {
      const response = await api.post('/auth/login', { email, password })
      const { token: newToken, user: userData } = response.data

      if (!hasImsAccess(userData)) {
        return { success: false, message: NO_ACCESS_MESSAGE }
      }

      queryClient.clear()
      clearViewAsStorage()
      setViewAsStaff(null)

      if (typeof window !== 'undefined') {
        if (rememberMe) {
          // Persist token + email across sessions
          localStorage.setItem('token', newToken)
          localStorage.setItem('rememberedEmail', email)
          sessionStorage.removeItem('token')
        } else {
          // Session-only token, no email remembered
          sessionStorage.setItem('token', newToken)
          localStorage.removeItem('token')
          localStorage.removeItem('rememberedEmail')
        }
      }

      setToken(newToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
      setRealUser(userData)
      return { success: true }
    } catch (error) {
      const apiMessage = error.response?.data?.message
      let message = apiMessage || 'Login failed'
      if (!error.response) {
        message = 'Cannot reach the API. Check your connection and try again.'
      } else if (!apiMessage) {
        message = `Login failed (HTTP ${error.response.status})`
      }
      return { success: false, message }
    }
  }

  const register = async (name, email, password) => {
    try {
      const response = await api.post('/auth/register', { name, email, password })
      const { token: newToken, user: userData } = response.data
      if (!hasImsAccess(userData)) {
        return { success: false, message: NO_ACCESS_MESSAGE }
      }
      clearViewAsStorage()
      setViewAsStaff(null)
      localStorage.setItem('token', newToken)
      setToken(newToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
      setRealUser(userData)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Registration failed',
      }
    }
  }

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      sessionStorage.removeItem('token')
      // Intentionally keep rememberedEmail so login can be prefilled next time
    }
    clearViewAsStorage()
    setToken(null)
    setRealUser(null)
    setViewAsStaff(null)
    delete api.defaults.headers.common['Authorization']
    queryClient.clear()
  }

  const startViewAs = useCallback(
    async (staff) => {
      if (!isStoreAdmin(realUser)) {
        return { success: false, message: 'Only owners and admins can view as staff' }
      }
      const preview = normalizeStaffPreview(staff)
      if (!preview?.id && !preview?._id) {
        return { success: false, message: 'Invalid staff member' }
      }
      persistViewAs(preview)
      setViewAsStaff(preview)
      queryClient.clear()
      return { success: true }
    },
    [realUser, queryClient]
  )

  const exitViewAs = useCallback(() => {
    clearViewAsStorage()
    setViewAsStaff(null)
    queryClient.clear()
  }, [queryClient])

  const isViewAs = Boolean(viewAsStaff)
  const user = useMemo(
    () => (isViewAs ? buildEffectiveUser(realUser, viewAsStaff) : realUser),
    [isViewAs, realUser, viewAsStaff]
  )

  const canAccessMyStore = useMemo(() => {
    if (isViewAs) return false
    return isStoreAdmin(realUser)
  }, [isViewAs, realUser])

  return (
    <AuthContext.Provider
      value={{
        user,
        realUser,
        loading,
        login,
        register,
        logout,
        isViewAs,
        viewAsStaff,
        startViewAs,
        exitViewAs,
        canAccessMyStore,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
