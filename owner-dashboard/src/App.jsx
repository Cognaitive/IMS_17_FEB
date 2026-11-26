import { useEffect, useState } from "react";
import { getToken, clearToken } from "./api";
import Login from "./Login";
import Overview from "./Overview";
import Reorder from "./Reorder";
import Forecast from "./Forecast";
import ImportInvoices from "./ImportInvoices";

const TABS = {
  overview: { label: "Overview", Component: Overview },
  reorder: { label: "Reorder", Component: Reorder },
  forecast: { label: "Forecast", Component: Forecast },
  import: { label: "Import store invoices", Component: ImportInvoices },
};

export default function App() {
  const [loggedIn, setLoggedIn] = useState(Boolean(getToken()));
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    const onLogout = () => setLoggedIn(false);
    window.addEventListener("owner-logout", onLogout);
    return () => window.removeEventListener("owner-logout", onLogout);
  }, []);

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const { Component } = TABS[tab];
  return (
    <div className="app">
      <header className="topbar">
        <h1>Samay Watch · Owner</h1>
        <nav>
          {Object.entries(TABS).map(([key, { label }]) => (
            <button key={key} className={key === tab ? "tab active" : "tab"} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="link" onClick={() => { clearToken(); setLoggedIn(false); }}>Log out</button>
      </header>
      <main>
        <Component />
      </main>
    </div>
  );
}
