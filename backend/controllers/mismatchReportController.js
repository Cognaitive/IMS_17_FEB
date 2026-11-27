const MismatchReport = require("../models/MismatchReport");

// @desc    List mismatch reports (admin/owner inbox)
// @route   GET /api/mismatch-reports
// @access  Private (owner + admin)
const listMismatchReports = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const status = String(req.query.status || "").trim().toLowerCase();

    const filter = {};
    if (status && ["pending", "proposed", "applied", "failed"].includes(status)) {
      filter.status = status;
    }

    const [rows, total] = await Promise.all([
      MismatchReport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MismatchReport.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    });
  } catch (error) {
    console.error("List mismatch reports failed:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to list mismatch reports",
    });
  }
};

// @desc    Get one mismatch report
// @route   GET /api/mismatch-reports/:id
// @access  Private (owner + admin)
const getMismatchReport = async (req, res) => {
  try {
    const report = await MismatchReport.findById(req.params.id).lean();
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    res.json({ success: true, data: report });
  } catch (error) {
    console.error("Get mismatch report failed:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get mismatch report",
    });
  }
};

/**
 * Confirm-apply a proposed/pending published report by reusing the
 * product mismatch-report endpoint (confirm:true).
 * Mutates req.params/body then delegates so scrape+apply stay single-sourced.
 */
const applyMismatchReport = async (req, res) => {
  try {
    const report = await MismatchReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    if (!["pending", "proposed"].includes(report.status)) {
      return res.status(400).json({
        success: false,
        message: `Report is already ${report.status}`,
      });
    }
    if (!report.productId) {
      return res.status(400).json({
        success: false,
        message: "Report has no product id",
      });
    }

    req.params = { ...req.params, id: String(report.productId) };
    req.body = {
      url: report.competitorUrl,
      note: report.note || "",
      confirm: true,
      reportId: String(report._id),
    };

    // Lazy require avoids circular load with enrichmentController.
    const { reportProductMismatch } = require("./enrichmentController");
    return reportProductMismatch(req, res);
  } catch (error) {
    console.error("Apply mismatch report failed:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to apply mismatch report",
    });
  }
};

module.exports = {
  listMismatchReports,
  getMismatchReport,
  applyMismatchReport,
};
