import { useApi } from "./api";
import { inr, num } from "./format";
import { Status } from "./Overview";

export default function Forecast() {
  const state = useApi("/api/owner/forecast");

  return (
    <section className="card">
      <div className="section-head">
        <h2>Next month forecast{state.data ? ` (${state.data.month})` : ""}</h2>
      </div>
      <p className="muted">
        Average of the last 3 full months. Once two years of sales are loaded, it is blended with the same month
        last year adjusted for year-on-year growth.
      </p>
      <Status state={state} />
      {state.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Brand</th><th>Forecast units</th><th>Forecast sales</th><th>Avg last 3 months</th>
                <th>Same month last year</th><th>YoY growth</th><th>In stock</th><th>Method</th>
              </tr>
            </thead>
            <tbody>
              {state.data.brands.map((b) => (
                <tr key={b.brand} className={b.stockUnits < b.forecastUnits ? "highlight" : ""}>
                  <td>{b.brand}</td>
                  <td><strong>{num(b.forecastUnits)}</strong></td>
                  <td>{inr(b.forecastAmount)}</td>
                  <td>{num(b.recentMonthlyUnits)}</td>
                  <td>{num(b.sameMonthLastYearUnits)}</td>
                  <td>{b.yearOnYearGrowth === null ? "–" : `${Math.round((b.yearOnYearGrowth - 1) * 100)}%`}</td>
                  <td>{num(b.stockUnits)}</td>
                  <td className="muted">{b.method}</td>
                </tr>
              ))}
              {!state.data.brands.length && <tr><td colSpan="8" className="muted">No sales history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
