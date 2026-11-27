const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  listMismatchReports,
  getMismatchReport,
  applyMismatchReport,
} = require("../controllers/mismatchReportController");

// Admin/owner only — same store-admin gate as My Store (not regular staff).
router.use(protect, authorize("owner", "admin"));

router.get("/", listMismatchReports);
router.get("/:id", getMismatchReport);
router.post("/:id/apply", applyMismatchReport);

module.exports = router;
