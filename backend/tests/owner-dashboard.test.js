const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { app, request, startDb, stopDb, clearDb, createUser, authHeader } = require("./setup");
const { Product } = require("../models/Product");
const { Brand } = require("../models/Brand");
const Order = require("../models/Order");
const SalesInvoice = require("../models/SalesInvoice");
const { salesPeriods, istParts, istMidnight } = require("../utils/istDates");
const { parseInvoiceDate } = require("../controllers/salesInvoiceImportController");

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

describe("IST periods and invoice dates", () => {
  it("starts the financial year on 1 April IST", () => {
    // 00:30 IST on 1 April 2026 is still 31 March in UTC
    const p = salesPeriods(new Date("2026-03-31T19:00:00Z"));
    assert.equal(p.ytd.from.toISOString(), "2026-03-31T18:30:00.000Z");
    assert.equal(p.today.from.toISOString(), "2026-03-31T18:30:00.000Z");

    const lastDay = salesPeriods(new Date("2026-03-31T18:00:00Z")); // 23:30 IST, 31 March
    assert.equal(lastDay.ytd.from.toISOString(), "2025-03-31T18:30:00.000Z");
    assert.equal(lastDay.mtd.from.toISOString(), "2026-02-28T18:30:00.000Z");

    const lastYear = salesPeriods(new Date("2026-11-14T06:00:00Z"), 1);
    assert.equal(lastYear.today.from.toISOString(), "2025-11-13T18:30:00.000Z");
    assert.equal(lastYear.ytd.from.toISOString(), "2025-03-31T18:30:00.000Z");
  });

  it("reads day-first invoice dates", () => {
    const expected = "2026-11-13T18:30:00.000Z";
    for (const raw of ["14-11-2026", "14/11/26", "14.11.2026", "14-Nov-2026", "14-Nov-26", "2026-11-14"]) {
      assert.equal(parseInvoiceDate(raw)?.toISOString(), expected, raw);
    }
    assert.equal(parseInvoiceDate("31-02-2026"), null);
    assert.equal(parseInvoiceDate("yesterday"), null);
  });
});

describe("owner dashboard API", () => {
  let owner;
  let tissot;
  let seiko;
  const { y, m, d } = istParts(new Date());
  const todayStart = istMidnight(y, m, d);
  const todayTally = `${d}-${MONTH_NAMES[m]}-${String(y).slice(2)}`;

  const csv = (rows) =>
    Buffer.from(["Vch No.,Date,Item Code,Item Name,Brand,Qty,Amount", ...rows].join("\n"));
  const importCsv = (body) =>
    request(app)
      .post("/api/owner/sales-invoices/import")
      .set(authHeader(owner))
      .attach("file", body, "sales.csv");

  const order = (fields) =>
    Order.create({
      orderNumber: `ORD-${Math.random().toString(36).slice(2)}`,
      user: owner._id,
      items: [
        { product: tissot._id, name: "Tissot PRX", quantity: 1, price: 30000 },
        { product: seiko._id, name: "Seiko 5", quantity: 1, price: 10000 },
      ],
      subtotal: 40000,
      discountAmount: 4000,
      total: 36000,
      paymentStatus: "paid",
      orderStatus: "confirmed",
      paidAt: new Date(todayStart.getTime() + 1000),
      ...fields,
    });

  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    owner = await createUser({ role: "Owner" });
    tissot = await Product.create({ brand: "Tissot", sku: "T-100", title: "Tissot PRX", price: 30000, inventory: 2 });
    seiko = await Product.create({ brand: "Seiko", sku: "S-5", title: "Seiko 5", price: 10000, inventory: 10 });
    await Brand.create({ name: "Casio", slug: "casio" });
  });

  it("is only open to the Owner", async () => {
    const admin = await createUser({ role: "admin" });
    assert.equal((await request(app).get("/api/owner/summary")).status, 401);
    assert.equal((await request(app).get("/api/owner/summary").set(authHeader(admin))).status, 403);
    assert.equal((await request(app).get("/api/owner/summary").set(authHeader(owner))).status, 200);
  });

  it("imports store invoices, matching SKUs to brands and reporting bad rows", async () => {
    const res = await importCsv(csv([
      `INV-1,${todayTally},t-100,Tissot PRX,,2,"₹60,000.00"`,
      `INV-1,${todayTally},X-1,G-Shock,casio,1,9000`,
      `INV-2,not a date,S-5,Seiko 5,,1,10000`,
    ]));

    assert.equal(res.status, 200);
    assert.equal(res.body.data.invoices, 1);
    assert.equal(res.body.data.lines, 2);
    assert.deepEqual(res.body.data.unmatchedSkus, ["X-1"]);
    assert.equal(res.body.data.errorCount, 1);
    assert.equal(res.body.data.errors[0].row, 4);

    const invoice = await SalesInvoice.findOne({ invoiceNumber: "INV-1" });
    assert.equal(invoice.invoiceDate.toISOString(), todayStart.toISOString());
    assert.equal(invoice.total, 69000);
    assert.equal(String(invoice.lines[0].product), String(tissot._id));
    assert.equal(invoice.lines[0].brand, "Tissot");
    assert.equal(invoice.lines[1].brand, "Casio");
    assert.equal((await Product.findById(tissot._id)).inventory, 2, "import must not touch stock");
  });

  it("replaces an invoice when the same export is imported again", async () => {
    await importCsv(csv([`INV-1,${todayTally},T-100,Tissot PRX,,1,30000`]));
    const res = await importCsv(csv([`INV-1,${todayTally},T-100,Tissot PRX,,2,60000`]));
    assert.equal(res.body.data.created, 0);
    assert.equal(res.body.data.replaced, 1);
    assert.equal(await SalesInvoice.countDocuments(), 1);
    assert.equal((await SalesInvoice.findOne()).total, 60000);
  });

  it("reads a BUSY item-wise sales register exported to Excel", async () => {
    const billDate = new Date(y, m, d); // a real Excel date cell
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Samay Watch Co."],
      ["Sales Register (Item-wise)"],
      [],
      ["Date", "Vch/Bill No", "Particulars", "Item", "Alias", "Qty.", "Unit", "Price", "Amount"],
      [billDate, "SW/101", "Rahul Sharma", "Tissot PRX", "T-100", "2 Pcs", "Pcs", 30000, 60000],
      ["", "", "", "Seiko 5", "S-5", "1 Pcs", "Pcs", 10000, 10000],
      ["", "", "", "", "", 3, "", "", 70000],
      [billDate, "SW/102", "Cash", "", "", "", "", "", ""],
      ["", "", "", "Seiko 5", "S-5", 1, "Pcs", 9500, 9500],
      ["Grand Total", "", "", "", "", 4, "", "", 79500],
    ], { cellDates: true });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sales");
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const res = await request(app)
      .post("/api/owner/sales-invoices/import")
      .set(authHeader(owner))
      .attach("file", file, "Sales Register.xlsx");

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.invoices, 2);
    assert.equal(res.body.data.lines, 3);
    assert.equal(res.body.data.errorCount, 0);
    assert.equal(res.body.data.skippedRows, 3);

    const first = await SalesInvoice.findOne({ invoiceNumber: "SW/101" });
    assert.equal(first.invoiceDate.toISOString(), todayStart.toISOString());
    assert.equal(first.customerName, "Rahul Sharma");
    assert.deepEqual(first.lines.map((l) => [l.sku, l.brand, l.quantity, l.amount]), [
      ["T-100", "Tissot", 2, 60000],
      ["S-5", "Seiko", 1, 10000],
    ]);
    const second = await SalesInvoice.findOne({ invoiceNumber: "SW/102" });
    assert.equal(second.customerName, "Cash");
    assert.equal(second.total, 9500);
  });

  it("rejects a file without the required columns", async () => {
    const res = await importCsv(Buffer.from("Name,Phone\nA,1\n"));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Missing columns/);
  });

  it("adds paid online orders (after coupon) and store invoices, skipping unpaid and cancelled", async () => {
    await order({});
    await order({ paymentStatus: "pending", paidAt: undefined });
    await order({ orderStatus: "cancelled" });
    await importCsv(csv([`INV-1,${todayTally},T-100,Tissot PRX,,2,60000`]));

    const res = await request(app).get("/api/owner/summary").set(authHeader(owner));
    assert.equal(res.status, 200);
    const today = res.body.data.periods.today.current;
    assert.deepEqual(today.online, { amount: 36000, units: 2 });
    assert.deepEqual(today.store, { amount: 60000, units: 2 });
    assert.deepEqual(today.total, { amount: 96000, units: 4 });
    assert.equal(res.body.data.periods.ytd.current.total.amount, 96000);
    assert.equal(res.body.data.periods.today.lastYear.total.amount, 0);
    assert.deepEqual(res.body.data.stock, { units: 12, value: 160000, skus: 2, outOfStock: 0 });

    const daily = await request(app).get("/api/owner/daily?days=7").set(authHeader(owner));
    assert.equal(daily.body.data.length, 7);
    assert.deepEqual(daily.body.data.at(-1), { date: daily.body.data.at(-1).date, online: 36000, store: 60000, onlineUnits: 2, storeUnits: 2 });
    assert.equal(daily.body.data[0].online, 0);
  });

  it("shows brand sales next to stock", async () => {
    await order({});
    await importCsv(csv([`INV-1,${todayTally},T-100,Tissot PRX,,2,60000`]));

    const res = await request(app).get("/api/owner/brands?period=mtd").set(authHeader(owner));
    const tissotRow = res.body.data.brands.find((b) => b.brand === "Tissot");
    assert.equal(tissotRow.unitsSold, 3);
    assert.equal(tissotRow.onlineAmount, 27000);
    assert.equal(tissotRow.storeAmount, 60000);
    assert.equal(tissotRow.stockUnits, 2);
    assert.equal(res.body.data.brands[0].brand, "Tissot");
  });

  it("suggests reorder quantities from recent sales speed", async () => {
    await order({});
    await importCsv(csv([`INV-1,${todayTally},T-100,Tissot PRX,,2,60000`]));

    const res = await request(app).get("/api/owner/reorder?leadDays=21&coverDays=60").set(authHeader(owner));
    assert.equal(res.body.data.method, "last 90 days");
    const [first, second] = res.body.data.items;
    // Tissot: 3 sold in 90 days -> 2.7 needed over 81 days, 2 in stock -> order 1
    assert.equal(first.sku, "T-100");
    assert.equal(first.suggestedQty, 1);
    assert.equal(first.daysOfCover, 60);
    // Seiko: 1 sold -> 0.9 needed, 10 in stock -> nothing to order
    assert.equal(second.sku, "S-5");
    assert.equal(second.suggestedQty, 0);
  });

  it("forecasts next month per brand from past invoices", async () => {
    const rows = [];
    for (let i = 1; i <= 3; i++) {
      const month = istParts(istMidnight(y, m - i, 15));
      rows.push(`INV-${i},15-${MONTH_NAMES[month.m]}-${month.y},T-100,Tissot PRX,,${i * 3},${i * 90000}`);
    }
    await importCsv(csv(rows));

    const res = await request(app).get("/api/owner/forecast").set(authHeader(owner));
    const tissotRow = res.body.data.brands.find((b) => b.brand === "Tissot");
    assert.equal(tissotRow.forecastUnits, 6);
    assert.equal(tissotRow.forecastAmount, 180000);
    assert.equal(tissotRow.method, "last 3 months");
  });

  it("uses same month last year scaled by growth only once 24 months of history exist", async () => {
    const monthRow = (offset, qty) => {
      const p = istParts(istMidnight(y, m + offset, 1));
      return `INV${offset},1-${MONTH_NAMES[p.m]}-${p.y},T-100,Tissot PRX,,${qty},${qty * 30000}`;
    };
    // 13 months back: a single month in the "previous year" window must not drive growth
    const partial = [monthRow(-13, 1), monthRow(-11, 10), ...[-3, -2, -1].map((o) => monthRow(o, 4))];
    await importCsv(csv(partial));
    let row = (await request(app).get("/api/owner/forecast").set(authHeader(owner))).body.data.brands[0];
    assert.equal(row.method, "last 3 months");
    assert.equal(row.forecastUnits, 4);

    // Full 24 months: 1/month in the earlier year, 2/month in the last year -> growth 2x
    await SalesInvoice.deleteMany({});
    const full = [];
    for (let o = -24; o <= -1; o++) full.push(monthRow(o, o <= -13 ? 1 : 2));
    await importCsv(csv(full));
    row = (await request(app).get("/api/owner/forecast").set(authHeader(owner))).body.data.brands[0];
    assert.equal(row.method, "blend with same month last year");
    assert.equal(row.yearOnYearGrowth, 2);
    // recent avg 2, same month last year (offset -11) 2 x growth 2 = 4 -> (2 + 4) / 2 = 3
    assert.equal(row.forecastUnits, 3);
  });
});
