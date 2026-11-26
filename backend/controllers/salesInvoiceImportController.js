const XLSX = require("xlsx");
const SalesInvoice = require("../models/SalesInvoice");
const { Product } = require("../models/Product");
const { Brand } = require("../models/Brand");
const { parseCSV } = require("./importController");
const { istParts, istMidnight } = require("../utils/istDates");

// Accepted header names per field, compared after lowercasing and removing everything but letters
// and digits ("Vch/Bill No." -> "vchbillno"). First match in the list wins; a column is used for
// one field only, so with both "Item" and "Particulars" the latter becomes the customer (BUSY layout).
const COLUMNS = {
  invoiceNumber: ["invoiceno", "invoicenumber", "vchbillno", "billno", "billnumber", "vchno", "voucherno", "vouchernumber", "invoice"],
  invoiceDate: ["date", "invoicedate", "billdate", "voucherdate", "vchdate"],
  sku: ["sku", "itemcode", "alias", "itemalias", "modelno", "modelnumber", "model", "partno", "code"],
  description: ["itemname", "item", "itemdetails", "description", "productname", "product", "stockitem", "particulars"],
  brand: ["brand", "make", "company", "manufacturer", "itemgroup"],
  quantity: ["qty", "quantity", "billedqty", "actualqty", "mainqty"],
  amount: ["amount", "netamount", "itemamount", "total", "linetotal", "value"],
  rate: ["rate", "price", "mrp", "sellingprice"],
  customer: ["customer", "customername", "party", "partyname", "accountname", "particulars"],
};
const HEADER_SEARCH_ROWS = 30;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const normalizeHeader = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round = (n) => Math.round(n * 100) / 100;

function matchColumns(headerCells) {
  const header = headerCells.map(normalizeHeader);
  const col = {};
  const taken = new Set();
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    for (const alias of aliases) {
      const index = header.findIndex((h, i) => h === alias && !taken.has(i));
      if (index !== -1) {
        col[field] = index;
        taken.add(index);
        break;
      }
    }
  }
  const missing = ["invoiceNumber", "invoiceDate", "quantity"].filter((f) => col[f] === undefined);
  if (col.amount === undefined && col.rate === undefined) missing.push("amount (or rate)");
  if (col.sku === undefined && col.description === undefined) missing.push("sku (or item name)");
  return { col, missing };
}

// Reports exported from BUSY / Excel start with company and report-title rows; use the first row
// within the top rows that has every required column.
function findHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const match = { index: i, ...matchColumns(rows[i]) };
    if (!match.missing.length) return match;
    if (!best || match.missing.length < best.missing.length) best = match;
  }
  return best;
}

// CSV, or the first sheet of an Excel file (.xlsx / .xls, as exported from BUSY), as rows of strings.
// Excel dates come through as serial numbers, which parseInvoiceDate understands.
function readRows(file) {
  if (/\.(xlsx|xlsm|xls)$/i.test(file.originalname || "")) {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true })
      .map((row) => row.map((v) => String(v ?? "")));
  }
  return parseCSV(file.buffer.toString("utf-8").replace(/^\uFEFF/, ""));
}

// Day-first dates as printed on Indian invoices: 14-11-2026, 14/11/26, 14.11.2026, 14-Nov-2026,
// 14-Nov-26 (Tally), ISO 2026-11-14, and Excel date serials. Returns midnight IST, or null.
function parseInvoiceDate(raw) {
  const s = String(raw || "").trim();
  let y, mo, d, m;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const parsed = XLSX.SSF.parse_date_code(Number(s));
    if (!parsed) return null;
    [y, mo, d] = [parsed.y, parsed.m - 1, parsed.d];
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) {
    [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  } else if ((m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(s))) {
    [d, mo, y] = [+m[1], +m[2] - 1, +m[3]];
  } else if ((m = /^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/ ,]+(\d{2}|\d{4})$/i.exec(s))) {
    [d, mo, y] = [+m[1], MONTHS[m[2].toLowerCase()], +m[3]];
  } else {
    return null;
  }
  if (y < 100) y += 2000;
  if (mo === undefined || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const date = istMidnight(y, mo, d);
  return istParts(date).d === d ? date : null;
}

// "₹1,23,456.00", "Rs. 500", "(1,200.00)" (negative). Returns undefined for an empty cell.
function parseAmount(raw) {
  let s = String(raw || "").trim();
  if (s === "") return undefined;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/^\(|\)$/g, "").replace(/^rs\.?/i, "").replace(/[₹,\s]/g, "");
  const n = Number(s);
  return negative ? -n : n;
}

// @desc    Import in-store sales from a billing-software export (BUSY Excel, or CSV). One row per
//          invoice line; rows sharing an invoice number and date form one invoice. Item rows with a
//          blank bill number belong to the bill above (BUSY prints it on the first line only).
//          Re-importing the same invoice replaces it, so overlapping exports are safe. Stock levels
//          are not touched.
// @route   POST /api/owner/sales-invoices/import
exports.importSalesInvoices = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: "Upload a CSV or Excel file in the 'file' field" });
    }
    const rows = readRows(req.file);
    if (rows.length < 2) {
      return res.status(400).json({ success: false, message: "File is empty or missing headers" });
    }

    const header = findHeader(rows);
    if (header.missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing columns: ${header.missing.join(", ")}. Found: ${rows[header.index].filter(Boolean).join(", ")}`,
      });
    }
    const { col } = header;

    const errors = [];
    const invoices = new Map();
    let voucher = null;
    let skippedRows = 0;
    for (let i = header.index + 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.every((c) => String(c).trim() === "")) continue;
      const cell = (field) => (col[field] === undefined ? "" : String(cells[col[field]] ?? "").trim());

      let invoiceNumber = cell("invoiceNumber");
      let dateText = cell("invoiceDate");
      let customerName = cell("customer");
      if (invoiceNumber) voucher = { invoiceNumber, dateText, customerName };
      else if (voucher) ({ invoiceNumber, dateText, customerName } = voucher);

      // Bill header lines, totals and narration carry no item
      if ((!cell("sku") && !cell("description")) || /^(grand\s*)?total\b/i.test(cell("description"))) {
        skippedRows++;
        continue;
      }

      const invoiceDate = parseInvoiceDate(dateText);
      const quantity = parseAmount(cell("quantity").replace(/\s*[a-z.]+$/i, "")); // "2 Pcs"
      let amount = parseAmount(cell("amount"));
      if (amount === undefined) {
        const rate = parseAmount(cell("rate"));
        if (rate !== undefined) amount = rate * quantity;
      }

      const problems = [];
      if (!invoiceNumber) problems.push("invoice number is empty");
      if (!invoiceDate) problems.push(`date "${dateText}" is not a valid date`);
      if (!Number.isFinite(quantity)) problems.push(`quantity "${cell("quantity")}" is not a number`);
      if (!Number.isFinite(amount)) problems.push("amount is missing or not a number");
      if (problems.length) {
        errors.push({ row: i + 1, invoiceNumber, error: problems.join("; ") });
        continue;
      }

      const key = `${invoiceNumber}|${invoiceDate.toISOString()}`;
      if (!invoices.has(key)) {
        invoices.set(key, { channel: "store", invoiceNumber, invoiceDate, customerName, lines: [] });
      }
      invoices.get(key).lines.push({
        sku: cell("sku"),
        brand: cell("brand"),
        description: cell("description"),
        quantity,
        amount: round(amount),
      });
    }

    const allLines = [...invoices.values()].flatMap((inv) => inv.lines);
    const skus = [...new Set(allLines.map((l) => l.sku).filter(Boolean))];
    const products = await Product.find({ sku: { $in: skus } })
      .collation({ locale: "en", strength: 2 })
      .select("sku brand")
      .lean();
    const bySku = new Map(products.map((p) => [p.sku.trim().toLowerCase(), p]));
    const brandNames = new Map((await Brand.find({}).select("name").lean()).map((b) => [b.name.trim().toLowerCase(), b.name]));

    const unmatched = new Set();
    let linesWithoutBrand = 0;
    for (const line of allLines) {
      const product = line.sku ? bySku.get(line.sku.toLowerCase()) : null;
      if (product) {
        line.product = product._id;
        line.brand = product.brand || line.brand;
      } else {
        if (line.sku) unmatched.add(line.sku);
        line.brand = brandNames.get(line.brand.toLowerCase()) || line.brand;
      }
      if (!line.brand) linesWithoutBrand++;
    }

    const importBatch = `import-${Date.now()}`;
    const ops = [...invoices.values()].map((inv) => ({
      replaceOne: {
        filter: { channel: "store", invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate },
        replacement: { ...inv, total: round(inv.lines.reduce((s, l) => s + l.amount, 0)), importBatch },
        upsert: true,
      },
    }));

    let created = 0;
    let replaced = 0;
    for (let i = 0; i < ops.length; i += 1000) {
      const result = await SalesInvoice.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      created += result.upsertedCount;
      replaced += result.matchedCount;
    }

    const dates = [...invoices.values()].map((inv) => inv.invoiceDate.getTime());
    res.json({
      success: true,
      data: {
        invoices: invoices.size,
        lines: allLines.length,
        created,
        replaced,
        firstDate: dates.length ? new Date(Math.min(...dates)) : null,
        lastDate: dates.length ? new Date(Math.max(...dates)) : null,
        unmatchedSkuCount: unmatched.size,
        unmatchedSkus: [...unmatched].slice(0, 100),
        linesWithoutBrand,
        skippedRows,
        errorCount: errors.length,
        errors: errors.slice(0, 200),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.parseInvoiceDate = parseInvoiceDate;
