import { useState } from "react";
import { api } from "./api";
import { num } from "./format";

const dateText = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "–");

export default function ImportInvoices() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult((await api("/api/owner/sales-invoices/import", { method: "POST", form })).data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Import in-store sales</h2>
      <p className="muted">
        Upload an item-wise sales register exported from BUSY to Excel (or a CSV), one row per item sold. Needed
        columns: Vch/Bill No, Date, Item or Alias (item code), Qty, and Amount (or Price). Brand and party are
        optional. Title rows at the top, total rows, and bill numbers printed only on the first item of a bill
        are handled. Importing the same bills again replaces them, so overlapping exports are fine. Stock is not
        changed.
      </p>
      <form onSubmit={upload} className="controls">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        <button type="submit" disabled={!file || busy}>{busy ? "Importing…" : "Import"}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="result">
          <p>
            <strong>{num(result.invoices)}</strong> invoices ({num(result.lines)} lines) from {dateText(result.firstDate)} to{" "}
            {dateText(result.lastDate)}: {num(result.created)} new, {num(result.replaced)} updated.
          </p>
          {result.skippedRows > 0 && (
            <p className="muted">{num(result.skippedRows)} rows without an item (bill headers, totals) were skipped.</p>
          )}
          {result.linesWithoutBrand > 0 && (
            <p className="warn">{num(result.linesWithoutBrand)} lines have no brand and will show as "Unknown".</p>
          )}
          {result.unmatchedSkuCount > 0 && (
            <p className="warn">
              {num(result.unmatchedSkuCount)} item codes are not in the IMS (they still count in sales, but not in
              reorder suggestions): {result.unmatchedSkus.join(", ")}
              {result.unmatchedSkuCount > result.unmatchedSkus.length ? " …" : ""}
            </p>
          )}
          {result.errorCount > 0 && (
            <>
              <p className="error">{num(result.errorCount)} rows were skipped:</p>
              <ul className="errors">
                {result.errors.map((e) => <li key={e.row}>Row {e.row}{e.invoiceNumber ? ` (${e.invoiceNumber})` : ""}: {e.error}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
