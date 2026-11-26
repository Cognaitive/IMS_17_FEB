import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { useApi } from "./api";
import { inr, num, change } from "./format";

const PERIOD_LABELS = { today: "Today", mtd: "Month to date", ytd: "Financial year to date" };

function Status({ state }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.loading && !state.data) return <p className="muted">Loading…</p>;
  return null;
}

function SalesCards() {
  const state = useApi("/api/owner/summary");
  if (!state.data) return <Status state={state} />;
  const { periods, stock } = state.data;

  return (
    <section className="cards">
      {Object.entries(PERIOD_LABELS).map(([key, label]) => {
        const { current, lastYear } = periods[key];
        const diff = change(current.total.amount, lastYear.total.amount);
        return (
          <div className="card kpi" key={key}>
            <span className="muted">{label}</span>
            <strong>{inr(current.total.amount)}</strong>
            <span>{num(current.total.units)} watches</span>
            <span className="split">Online {inr(current.online.amount)} · Store {inr(current.store.amount)}</span>
            <span className={diff.startsWith("-") ? "down" : "up"}>
              {diff ? `${diff} vs last year (${inr(lastYear.total.amount)})` : "No sales same period last year"}
            </span>
          </div>
        );
      })}
      <div className="card kpi">
        <span className="muted">Stock on hand</span>
        <strong>{num(stock.units)} watches</strong>
        <span>{inr(stock.value)} at selling price</span>
        <span className="split">{num(stock.skus)} SKUs · {num(stock.outOfStock)} out of stock</span>
      </div>
    </section>
  );
}

function DailyChart() {
  const [days, setDays] = useState(30);
  const state = useApi(`/api/owner/daily?days=${days}`);

  return (
    <section className="card">
      <div className="section-head">
        <h2>Daily sales</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 365 days</option>
        </select>
      </div>
      <Status state={state} />
      {state.data && (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={state.data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} minTickGap={16} />
            <YAxis tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={60} />
            <Tooltip formatter={(v) => inr(v)} />
            <Legend />
            <Bar dataKey="store" name="Store" stackId="s" fill="#1f3a5f" />
            <Bar dataKey="online" name="Online" stackId="s" fill="#c8a24a" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

function BrandTable() {
  const [period, setPeriod] = useState("mtd");
  const state = useApi(`/api/owner/brands?period=${period}`);

  return (
    <section className="card">
      <div className="section-head">
        <h2>Brands: sales vs stock</h2>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {Object.entries(PERIOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <Status state={state} />
      {state.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Brand</th><th>Sold</th><th>Sales</th><th>Online</th><th>Store</th>
                <th>In stock</th><th>Stock value</th><th>Out of stock SKUs</th><th>Months of stock</th>
              </tr>
            </thead>
            <tbody>
              {state.data.brands.map((b) => (
                <tr key={b.brand}>
                  <td>{b.brand}</td>
                  <td>{num(b.unitsSold)}</td>
                  <td>{inr(b.salesAmount)}</td>
                  <td>{inr(b.onlineAmount)}</td>
                  <td>{inr(b.storeAmount)}</td>
                  <td>{num(b.stockUnits)}</td>
                  <td>{inr(b.stockValue)}</td>
                  <td>{num(b.outOfStock)}</td>
                  <td>{b.monthsOfStock === null ? "No sales" : b.monthsOfStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Overview() {
  return (
    <>
      <SalesCards />
      <DailyChart />
      <BrandTable />
    </>
  );
}

export { Status };
