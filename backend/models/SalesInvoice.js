const mongoose = require("mongoose");

// In-store sales invoices imported from the billing software. Online sales are read
// straight from paid orders, so they are not copied here.
const lineSchema = new mongoose.Schema(
  {
    sku: { type: String, trim: true, default: "" },
    brand: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    // Negative on returns / credit notes
    quantity: { type: Number, required: true },
    // Line value as billed (incl. GST, after any line discount)
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const salesInvoiceSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["store"], default: "store" },
    invoiceNumber: { type: String, required: true, trim: true },
    invoiceDate: { type: Date, required: true },
    customerName: { type: String, trim: true, default: "" },
    lines: [lineSchema],
    total: { type: Number, default: 0 },
    importBatch: { type: String, default: "" },
  },
  { timestamps: true }
);

// Invoice numbers can restart each financial year, so the date is part of the key.
// Re-importing the same export replaces these invoices instead of double counting.
salesInvoiceSchema.index({ channel: 1, invoiceNumber: 1, invoiceDate: 1 }, { unique: true });
salesInvoiceSchema.index({ invoiceDate: -1 });

module.exports = mongoose.model("SalesInvoice", salesInvoiceSchema);
