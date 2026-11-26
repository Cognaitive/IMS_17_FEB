// Server-side mirror of the staff switches shown in the IMS (StoreStaffs / ProductModal).
// A switch counts as "on" unless it is explicitly false, same as the IMS screens.

const BASIC_FIELDS = [
  "brand", "title", "sku", "category", "inventory", "price", "oldPrice", "description", "images",
  "caseMaterial", "dialColor", "waterResistance", "warrantyPeriod", "movement", "gender",
  "strapColor", "caseShape", "caseSize", "strapMaterial", "variants", "slug", "isPublished",
];

const SEO_FIELDS = ["seoTitle", "seoDescription", "seoKeywords", "seoImage"];

// Store admin = My Store / view-as initiator (owner + admin).
const STORE_ADMIN_ROLES = new Set(["owner", "admin"]);

const normalizedRole = (userOrRole) => {
  if (userOrRole && typeof userOrRole === "object") {
    return String(userOrRole.role || "").toLowerCase();
  }
  return String(userOrRole || "").toLowerCase();
};

const isStoreAdmin = (user) => STORE_ADMIN_ROLES.has(normalizedRole(user));

/**
 * Staff = any authenticated non-admin IMS user (not owner/admin, not website "user").
 * Includes role "staff"/"Staff", legacy "head", and any future non-admin IMS roles.
 * Do not treat this as role === "staff" only.
 */
const isStaff = (user) => {
  const role = normalizedRole(user);
  if (!role || role === "user") return false;
  return !STORE_ADMIN_ROLES.has(role);
};

/** Mongo filter for staff accounts listed in My Staffs / view-as. */
const STAFF_ROLE_MONGO = { $nin: ["owner", "Owner", "admin", "user"] };

const canAccessBrand = (user, brand) => {
  if (!isStaff(user)) return true;
  const target = String(brand || "").trim().toLowerCase();
  if (!target) return false;
  return (user.allowedBrands || []).some((b) => String(b).trim().toLowerCase() === target);
};

const normalize = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value.map(normalize));
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

// The IMS sends the whole form on save, so only values that actually differ count as edits.
const hasChanges = (current, updates, fields) =>
  fields.some((f) => updates[f] !== undefined && normalize(updates[f]) !== normalize(current?.[f]));

// Returns why a staff member may not make this change, or null if allowed.
// `current` is the stored product, or null when creating one.
const staffWriteError = (user, current, updates = {}) => {
  if (!isStaff(user)) return null;
  if (user.canEditProducts === false) return "Your account is view-only";
  if (current && !canAccessBrand(user, current.brand)) return "You don't have access to this brand";
  if ((!current || updates.brand !== undefined) && !canAccessBrand(user, updates.brand)) {
    return "You don't have access to this brand";
  }
  if (user.canEditBasicInfo === false && hasChanges(current, updates, BASIC_FIELDS)) {
    return "You don't have permission to edit basic product info";
  }
  if (user.canEditSeo === false && hasChanges(current, updates, SEO_FIELDS)) {
    return "You don't have permission to edit SEO fields";
  }
  return null;
};

module.exports = {
  isStaff,
  isStoreAdmin,
  canAccessBrand,
  staffWriteError,
  STAFF_ROLE_MONGO,
  STORE_ADMIN_ROLES,
};
