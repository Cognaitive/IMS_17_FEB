const Order = require("../models/Order");
const { Product } = require("../models/Product");
const { salesLinesPipeline } = require("../utils/salesLines");
const { DAY_MS, TIMEZONE, istParts, istMidnight, salesPeriods, istDateKey } = require("../utils/istDates");

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
};
const brandKey = (name) => String(name || "Unknown").trim().toLowerCase();
const monthKey = (y, m) => {
  const dt = new Date(Date.UTC(y, m, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
};

const salesAggregate = (from, to, stages) => Order.aggregate([...salesLinesPipeline(from, to), ...stages]);

async function channelTotals(from, to) {
  const rows = await salesAggregate(from, to, [
    { $group: { _id: "$channel", amount: { $sum: "$amount" }, units: { $sum: "$quantity" } } },
  ]);
  const totals = { online: { amount: 0, units: 0 }, store: { amount: 0, units: 0 } };
  rows.forEach((r) => { totals[r._id] = { amount: round(r.amount), units: r.units }; });
  totals.total = {
    amount: round(totals.online.amount + totals.store.amount),
    units: totals.online.units + totals.store.units,
  };
  return totals;
}

const stockByBrand = () =>
  Product.aggregate([
    {
      $group: {
        _id: "$brand",
        units: { $sum: { $max: ["$inventory", 0] } },
        value: { $sum: { $multiply: [{ $max: ["$inventory", 0] }, { $ifNull: ["$price", 0] }] } },
        skus: { $sum: 1 },
        outOfStock: { $sum: { $cond: [{ $lte: ["$inventory", 0] }, 1, 0] } },
      },
    },
  ]);

// Resolves ?period=today|mtd|ytd (default mtd), or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, IST)
function resolvePeriod(query) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  };
  const from = parse(query.from);
  const to = parse(query.to);
  if (from && to) {
    return { period: "custom", from: istMidnight(from.y, from.m, from.d), to: istMidnight(to.y, to.m, to.d + 1) };
  }
  const period = ["today", "mtd", "ytd"].includes(query.period) ? query.period : "mtd";
  return { period, ...salesPeriods(new Date())[period] };
}

// @desc    Today / MTD / YTD sales by channel, vs the same periods last year, plus stock totals
// @route   GET /api/owner/summary
exports.getSummary = async (req, res) => {
  try {
    const now = new Date();
    const current = salesPeriods(now);
    const lastYear = salesPeriods(now, 1);

    const periods = {};
    for (const key of ["today", "mtd", "ytd"]) {
      const [cur, prev] = await Promise.all([
        channelTotals(current[key].from, current[key].to),
        channelTotals(lastYear[key].from, lastYear[key].to),
      ]);
      periods[key] = { from: current[key].from, to: current[key].to, current: cur, lastYear: prev };
    }

    const stock = (await stockByBrand()).reduce(
      (acc, b) => ({
        units: acc.units + b.units,
        value: acc.value + b.value,
        skus: acc.skus + b.skus,
        outOfStock: acc.outOfStock + b.outOfStock,
      }),
      { units: 0, value: 0, skus: 0, outOfStock: 0 }
    );
    stock.value = round(stock.value);

    res.json({ success: true, data: { asOf: now, periods, stock } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Sales per day (IST) split by channel
// @route   GET /api/owner/daily?days=30
exports.getDailySales = async (req, res) => {
  try {
    const days = clampInt(req.query.days, 30, 1, 366);
    const { y, m, d } = istParts(new Date());
    const from = istMidnight(y, m, d - days + 1);
    const to = istMidnight(y, m, d + 1);

    const rows = await salesAggregate(from, to, [
      {
        $group: {
          _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TIMEZONE } }, channel: "$channel" },
          amount: { $sum: "$amount" },
          units: { $sum: "$quantity" },
        },
      },
    ]);

    const byDay = new Map();
    for (let i = 0; i < days; i++) {
      const date = istDateKey(new Date(from.getTime() + i * DAY_MS));
      byDay.set(date, { date, online: 0, store: 0, onlineUnits: 0, storeUnits: 0 });
    }
    rows.forEach((r) => {
      const entry = byDay.get(r._id.day);
      if (!entry) return;
      entry[r._id.channel] = round(r.amount);
      entry[`${r._id.channel}Units`] = r.units;
    });

    res.json({ success: true, data: [...byDay.values()] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Per brand: sales in the period (by channel) next to current stock
// @route   GET /api/owner/brands?period=mtd|ytd|today  or  ?from=&to=
exports.getBrandPerformance = async (req, res) => {
  try {
    const { period, from, to } = resolvePeriod(req.query);
    const periodDays = Math.max(1, (to - from) / DAY_MS);

    const [sales, stock] = await Promise.all([
      salesAggregate(from, to, [
        {
          $group: {
            _id: { brand: "$brand", channel: "$channel" },
            amount: { $sum: "$amount" },
            units: { $sum: "$quantity" },
          },
        },
      ]),
      stockByBrand(),
    ]);

    const brands = new Map();
    const entry = (name) => {
      const key = brandKey(name);
      if (!brands.has(key)) {
        brands.set(key, {
          brand: name || "Unknown",
          unitsSold: 0, salesAmount: 0, onlineAmount: 0, storeAmount: 0,
          stockUnits: 0, stockValue: 0, skus: 0, outOfStock: 0,
        });
      }
      return brands.get(key);
    };

    stock.forEach((s) => {
      const b = entry(s._id);
      b.brand = s._id || "Unknown";
      Object.assign(b, { stockUnits: s.units, stockValue: round(s.value), skus: s.skus, outOfStock: s.outOfStock });
    });
    sales.forEach((s) => {
      const b = entry(s._id.brand);
      b.unitsSold += s.units;
      b.salesAmount = round(b.salesAmount + s.amount);
      b[`${s._id.channel}Amount`] = round(b[`${s._id.channel}Amount`] + s.amount);
    });

    const rows = [...brands.values()].map((b) => {
      const monthlyUnits = (b.unitsSold / periodDays) * 30;
      return { ...b, monthsOfStock: monthlyUnits > 0 ? round(b.stockUnits / monthlyUnits) : null };
    });
    rows.sort((a, b) => b.salesAmount - a.salesAmount || b.stockValue - a.stockValue);

    res.json({ success: true, data: { period, from, to, brands: rows } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Units sold per product in [from, to)
async function unitsByProduct(from, to) {
  const rows = await salesAggregate(from, to, [
    { $match: { productId: { $ne: null } } },
    { $group: { _id: "$productId", units: { $sum: "$quantity" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.units]));
}

async function firstSaleDate() {
  const [row] = await salesAggregate(new Date(0), new Date(), [{ $group: { _id: null, first: { $min: "$date" } } }]);
  return row?.first || null;
}

// @desc    Reorder suggestions per SKU from sales speed (recent 90 days, blended with the same
//          upcoming window last year once a year of history exists) vs current stock
// @route   GET /api/owner/reorder?leadDays=21&coverDays=60&brand=
exports.getReorderSuggestions = async (req, res) => {
  try {
    const leadDays = clampInt(req.query.leadDays, 21, 0, 365);
    const coverDays = clampInt(req.query.coverDays, 60, 1, 365);
    const recentDays = 90;
    const windowDays = leadDays + coverDays;

    const { y, m, d } = istParts(new Date());
    const endOfToday = istMidnight(y, m, d + 1);
    const recentFrom = new Date(endOfToday.getTime() - recentDays * DAY_MS);
    const lastYearFrom = new Date(endOfToday.getTime() - 365 * DAY_MS);
    const lastYearTo = new Date(lastYearFrom.getTime() + windowDays * DAY_MS);

    const [recent, lastYear, first] = await Promise.all([
      unitsByProduct(recentFrom, endOfToday),
      unitsByProduct(lastYearFrom, lastYearTo),
      firstSaleDate(),
    ]);
    const hasLastYear = Boolean(first && first <= lastYearFrom);

    const ids = [...new Set([...recent.keys(), ...lastYear.keys()])];
    const filter = { _id: { $in: ids } };
    if (req.query.brand) filter.brand = new RegExp(`^${String(req.query.brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const products = await Product.find(filter).select("brand sku title inventory price").lean();

    const rows = products.map((p) => {
      const stock = Math.max(0, p.inventory || 0);
      const recentRate = Math.max(0, recent.get(String(p._id)) || 0) / recentDays;
      const seasonalRate = hasLastYear ? Math.max(0, lastYear.get(String(p._id)) || 0) / windowDays : null;
      const dailyRate = seasonalRate === null ? recentRate : (recentRate + seasonalRate) / 2;
      const expectedDemand = dailyRate * windowDays;
      return {
        productId: p._id,
        brand: p.brand,
        sku: p.sku,
        title: p.title,
        stock,
        price: p.price || 0,
        soldLast90Days: recent.get(String(p._id)) || 0,
        soldSameWindowLastYear: hasLastYear ? lastYear.get(String(p._id)) || 0 : null,
        dailyRate: Math.round(dailyRate * 1000) / 1000,
        daysOfCover: dailyRate > 0 ? Math.round(stock / dailyRate) : null,
        expectedDemand: round(expectedDemand),
        suggestedQty: Math.max(0, Math.ceil(expectedDemand - stock)),
      };
    });
    rows.sort((a, b) => (b.suggestedQty > 0) - (a.suggestedQty > 0) || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity));

    res.json({
      success: true,
      data: {
        leadDays, coverDays, recentDays,
        method: hasLastYear ? "blend of last 90 days and same period last year" : "last 90 days",
        items: rows,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Next month's sales forecast per brand. Blends the average of the last 3 full months with
//          the same month last year scaled by year-on-year growth (when 2 years of history exist).
// @route   GET /api/owner/forecast
exports.getBrandForecast = async (req, res) => {
  try {
    const { y, m } = istParts(new Date());
    const from = istMidnight(y, m - 24, 1);
    const to = istMidnight(y, m, 1);

    const [rows, stock, first] = await Promise.all([
      salesAggregate(from, to, [
        {
          $group: {
            _id: { brand: "$brand", month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: TIMEZONE } } },
            units: { $sum: "$quantity" },
            amount: { $sum: "$amount" },
          },
        },
      ]),
      stockByBrand(),
      firstSaleDate(),
    ]);
    // Year-on-year growth is only meaningful when the earlier 12 months are fully covered by history
    const hasTwoYears = Boolean(first && first <= from);

    const brands = new Map();
    rows.forEach((r) => {
      const key = brandKey(r._id.brand);
      if (!brands.has(key)) brands.set(key, { brand: r._id.brand || "Unknown", months: new Map() });
      const months = brands.get(key).months;
      const prev = months.get(r._id.month) || { units: 0, amount: 0 };
      months.set(r._id.month, { units: prev.units + r.units, amount: prev.amount + r.amount });
    });
    const stockMap = new Map(stock.map((s) => [brandKey(s._id), s]));

    const sumMonths = (months, fromOffset, toOffset, field) => {
      let total = 0;
      for (let i = fromOffset; i <= toOffset; i++) total += months.get(monthKey(y, m + i))?.[field] || 0;
      return total;
    };

    const result = [...brands.values()].map(({ brand, months }) => {
      const forecast = (field) => {
        const recentAvg = sumMonths(months, -3, -1, field) / 3;
        const last12 = sumMonths(months, -12, -1, field);
        const prev12 = sumMonths(months, -24, -13, field);
        const sameMonthLastYear = months.get(monthKey(y, m - 11))?.[field] || 0;
        const growth = hasTwoYears && prev12 > 0 ? Math.min(2, Math.max(0.5, last12 / prev12)) : null;
        const seasonal = growth === null ? null : sameMonthLastYear * growth;
        const value = seasonal === null ? recentAvg : (recentAvg + seasonal) / 2;
        return { recentAvg: round(recentAvg), sameMonthLastYear: round(sameMonthLastYear), growth: growth && round(growth), value: round(value) };
      };
      const units = forecast("units");
      const amount = forecast("amount");
      const s = stockMap.get(brandKey(brand));
      return {
        brand,
        forecastUnits: Math.round(units.value),
        forecastAmount: amount.value,
        recentMonthlyUnits: units.recentAvg,
        sameMonthLastYearUnits: units.sameMonthLastYear,
        yearOnYearGrowth: units.growth,
        method: units.growth === null ? "last 3 months" : "blend with same month last year",
        stockUnits: s?.units || 0,
      };
    });
    result.sort((a, b) => b.forecastAmount - a.forecastAmount);

    res.json({ success: true, data: { month: monthKey(y, m + 1), brands: result } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
