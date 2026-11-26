// Day, month and financial-year boundaries as seen in India (UTC+5:30, no daylight saving).
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = "Asia/Kolkata";

const istParts = (date) => {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
};

// Midnight IST of the given calendar day (month/day overflow rolls over like Date.UTC).
const istMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);

// Today, month-to-date and financial-year-to-date (FY starts 1 April), each ending at the end of today.
// yearsBack = 1 gives the same windows one year earlier, for comparisons.
function salesPeriods(now = new Date(), yearsBack = 0) {
  const { y: thisYear, m, d } = istParts(now);
  const y = thisYear - yearsBack;
  const fyStartYear = m >= 3 ? y : y - 1;
  const endOfToday = istMidnight(y, m, d + 1);
  return {
    today: { from: istMidnight(y, m, d), to: endOfToday },
    mtd: { from: istMidnight(y, m, 1), to: endOfToday },
    ytd: { from: istMidnight(fyStartYear, 3, 1), to: endOfToday },
  };
}

// "2026-11-14" for an instant, in IST
const istDateKey = (date) => {
  const { y, m, d } = istParts(date);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

module.exports = { DAY_MS, TIMEZONE, istParts, istMidnight, salesPeriods, istDateKey };
