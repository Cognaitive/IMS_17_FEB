const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-IN");

export const inr = (n) => rupees.format(n || 0);
export const num = (n) => (n === null || n === undefined ? "–" : number.format(n));

// "+12%" vs last year, or "" when there is nothing to compare against
export const change = (current, previous) => {
  if (!previous) return "";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
};
