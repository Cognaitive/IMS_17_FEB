import { useState } from "react";
import { useApi } from "./api";
import { inr, num } from "./format";
import { Status } from "./Overview";

export default function Reorder() {
  const [leadDays, setLeadDays] = useState(21);
  const [coverDays, setCoverDays] = useState(60);
  const [onlyToOrder, setOnlyToOrder] = useState(true);
  const state = useApi(`/api/owner/reorder?leadDays=${leadDays}&coverDays=${coverDays}`);
  const items = (state.data?.items || []).filter((i) => !onlyToOrder || i.suggestedQty > 0);

  return (
    <section className="card">
      <div className="section-head">
        <h2>Reorder suggestions</h2>
        <div className="controls">
          <label>Supplier lead time (days) <input type="number" min="0" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} /></label>
          <label>Cover for (days) <input type="number" min="1" value={coverDays} onChange={(e) => setCoverDays(e.target.value)} /></label>
          <label><input type="checkbox" checked={onlyToOrder} onChange={(e) => setOnlyToOrder(e.target.checked)} /> Only items to order</label>
        </div>
      </div>
      {state.data && (
        <p className="muted">
          Based on {state.data.method}. Suggested quantity = expected sales over lead time + cover days, minus stock.
          Only SKUs that exist in the IMS and have sold are listed.
        </p>
      )}
      <Status state={state} />
      {state.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Brand</th><th>SKU</th><th>Title</th><th>Stock</th><th>Sold (90 days)</th>
                <th>Sold same period last year</th><th>Days of cover</th><th>Order qty</th><th>Order value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.productId} className={i.suggestedQty > 0 ? "highlight" : ""}>
                  <td>{i.brand}</td>
                  <td>{i.sku}</td>
                  <td>{i.title}</td>
                  <td>{num(i.stock)}</td>
                  <td>{num(i.soldLast90Days)}</td>
                  <td>{num(i.soldSameWindowLastYear)}</td>
                  <td>{num(i.daysOfCover)}</td>
                  <td><strong>{num(i.suggestedQty)}</strong></td>
                  <td>{inr(i.suggestedQty * i.price)}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan="9" className="muted">Nothing to reorder.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
