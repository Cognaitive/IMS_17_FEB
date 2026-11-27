const mongoose = require("mongoose");

const mismatchReportSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    sku: { type: String, trim: true, default: "", index: true },
    brand: { type: String, trim: true, default: "", index: true },
    title: { type: String, trim: true, default: "" },
    competitorUrl: { type: String, trim: true, required: true },
    note: { type: String, trim: true, default: "" },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reporterName: { type: String, trim: true, default: "" },
    reporterEmail: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "proposed", "applied", "failed"],
      default: "pending",
      index: true,
    },
    isPublished: { type: Boolean, default: false },
    proposal: { type: mongoose.Schema.Types.Mixed, default: null },
    beforeAfter: { type: mongoose.Schema.Types.Mixed, default: null },
    errorMessage: { type: String, trim: true, default: "" },
    appliedAt: { type: Date, default: null },
    appliedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    appliedByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

mismatchReportSchema.index({ status: 1, createdAt: -1 });
mismatchReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model("MismatchReport", mismatchReportSchema);
