const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect, authorize } = require("../middleware/auth");
const {
  getSummary,
  getDailySales,
  getBrandPerformance,
  getReorderSuggestions,
  getBrandForecast,
} = require("../controllers/ownerController");
const { importSalesInvoices } = require("../controllers/salesInvoiceImportController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(protect, authorize("owner"));

router.get("/summary", getSummary);
router.get("/daily", getDailySales);
router.get("/brands", getBrandPerformance);
router.get("/reorder", getReorderSuggestions);
router.get("/forecast", getBrandForecast);
router.post("/sales-invoices/import", upload.single("file"), importSalesInvoices);

module.exports = router;
