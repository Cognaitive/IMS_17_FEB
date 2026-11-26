/** Store admin = My Store + view-as initiator (owner + admin). */
export const STORE_ADMIN_ROLES = ['owner', 'admin']

/** IMS panel roles (website customers use role "user"). "head" is legacy. */
export const IMS_ROLES = ['owner', 'admin', 'staff', 'head']

export const normalizedRole = (userOrRole) => {
  if (userOrRole && typeof userOrRole === 'object') {
    return String(userOrRole.role || '').toLowerCase()
  }
  return String(userOrRole || '').toLowerCase()
}

export const isStoreAdmin = (user) =>
  STORE_ADMIN_ROLES.includes(normalizedRole(user))

/**
 * Staff = any authenticated non-admin IMS user (not owner/admin, not website "user").
 * Not limited to role === "staff".
 */
export const isStaff = (user) => {
  const role = normalizedRole(user)
  if (!role || role === 'user') return false
  return !STORE_ADMIN_ROLES.includes(role)
}

export const hasImsAccess = (user) => IMS_ROLES.includes(normalizedRole(user))

/** Product edit / Approve / Reject — store admins always; staff honor canEditProducts. */
export const canEditProducts = (user) =>
  !isStaff(user) || user?.canEditProducts !== false
