const User = require("../models/User");
const { isStaff, isStoreAdmin } = require("../utils/staffPermissions");

const VIEW_AS_HEADER = "x-view-as-staff-id";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isStoreAdminPath = (url = "") =>
  String(url).includes("/store-admin");

/**
 * Owner/admin can send X-View-As-Staff-Id to preview a staff member's IMS scope.
 * Mutations are always blocked. Store-admin routes are blocked (staff have no My Store).
 * Brand/permission overlays apply on safe reads so listings match that staff.
 * Target may be any non-admin IMS user (not only role === "staff").
 */
const applyViewAs = async (req, res, next) => {
  const staffId = req.headers[VIEW_AS_HEADER];
  if (!staffId || !req.user) return next();

  if (!isStoreAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: "View-as is only available to owners and admins",
    });
  }

  if (!SAFE_METHODS.has(String(req.method || "").toUpperCase())) {
    return res.status(403).json({
      success: false,
      message: "Read-only while viewing as staff. Exit view-as to make changes.",
    });
  }

  if (isStoreAdminPath(req.originalUrl || req.url)) {
    return res.status(403).json({
      success: false,
      message: "Store administration is unavailable while viewing as staff",
    });
  }

  try {
    const staff = await User.findById(staffId).select("-password");
    if (!staff || !isStaff(staff)) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    const actorRole = String(req.user.role || "").toLowerCase();
    if (
      actorRole === "admin" &&
      staff.parentId?.toString() !== req.user._id.toString() &&
      staff.parentId?.toString() !== req.user.id?.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view as this staff member",
      });
    }

    req.realUser = req.user;
    req.viewAsStaff = staff;

    const base = typeof req.user.toObject === "function" ? req.user.toObject() : { ...req.user };
    // Keep actor id for audit; overlay staff scope + force read-only edit flags
    req.user = {
      ...base,
      id: base._id || base.id,
      role: "staff",
      allowedBrands: staff.allowedBrands || [],
      canEditProducts: false,
      canViewStats: staff.canViewStats !== false,
      canEditBasicInfo: false,
      canEditSeo: false,
      canAccessFilters: staff.canAccessFilters !== false,
      hasSeoAccess: false,
      viewAsStaffId: staff._id,
      viewAsName: staff.name,
    };

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "View-as failed",
    });
  }
};

module.exports = { applyViewAs, VIEW_AS_HEADER };
