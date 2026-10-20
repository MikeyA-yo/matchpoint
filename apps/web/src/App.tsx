import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router";
import { api } from "./api";

function ApiStatus() {
  const [status, setStatus] = useState("checking…");
  useEffect(() => {
    api<{ status: string; env: string }>("/health")
      .then((h) => setStatus(`${h.status} (${h.env})`))
      .catch(() => setStatus("unreachable"));
  }, []);
  return <small>API: {status}</small>;
}

// Customer surface: inbox, Why link, Not now, Stop offers (api_design.md 5.2)
function PhoneView() {
  return <h2>Phone view</h2>;
}

// Zenith console: silence feed, metrics, policies, experiments (api_design.md 5.3, 5.4)
function Console() {
  return <h2>Console</h2>;
}

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
        <strong>MATCHPOINT</strong>
        <NavLink to="/">Phone</NavLink>
        <NavLink to="/console">Console</NavLink>
        <ApiStatus />
      </header>
      <Routes>
        <Route path="/" element={<PhoneView />} />
        <Route path="/console" element={<Console />} />
      </Routes>
    </div>
  );
}
