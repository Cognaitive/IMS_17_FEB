const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { applyViewAs } = require("./viewAs");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select("-password");
      if (!req.user) {
        return res.status(401).json({ message: "User not found" });
      }
      return applyViewAs(req, res, next);
    } catch (error) {
      return res.status(401).json({ message: "Not authorized" });
    }
  } else {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
};

/** Optional auth: populates req.user when token valid, else req.user = null. Never blocks. */
const optionalAuth = async (req, res, next) => {
  req.user = null;
  if (req.headers.authorization?.startsWith("Bearer")) {
    try {
      const token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select("-password");
    } catch (_) {
      /* ignore invalid token */
    }
  }
  next();
};

const authorize = (...roles) => {
  return (req, res, next) => {
    // Prefer the real actor when view-as has overlaid staff permissions on req.user
    const actor = req.realUser || req.user;
    if (!actor || !actor.role) {
      return res.status(403).json({
        success: false,
        message: `User role is not authorized to access this route`,
      });
    }

    const userRole = actor.role.toLowerCase();
    const authorizedRoles = roles.map((role) => role.toLowerCase());

    if (!authorizedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `User role is not authorized to access this route`,
      });
    }
    next();
  };
};

// IMS panel users (website customers have role "user" and are kept out).
// "head" is a legacy role still present on one live account.
const imsOnly = authorize("owner", "admin", "staff", "head");

module.exports = { protect, optionalAuth, authorize, imsOnly };
