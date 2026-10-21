import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { ApiProvider, useApi } from "../../lib/context";
import { humanize } from "../../lib/format";
import { useQuery } from "../../lib/hooks";
import { KEYS, load, save } from "../../lib/storage";
import { STAFF_ROLES, type Role } from "../../lib/types";

const SECTIONS: { group: string; links: [to: string, label: string][] }[] = [
  { group: "Overview", links: [["/console", "Metrics"]] },
  {
    group: "Decisions",
    links: [
      ["/console/decisions", "Silence feed"],
      ["/console/review", "Review queue"],
      ["/console/run", "Run decisions"],
    ],
  },
  {
    group: "Rules and catalogue",
    links: [
      ["/console/policies", "Policies"],
      ["/console/products", "Products"],
      ["/console/campaigns", "Campaign requests"],
    ],
  },
  {
    group: "Evidence",
    links: [
      ["/console/experiments", "Experiments"],
      ["/console/model", "Uplift model"],
    ],
  },
  {
    group: "Demo control",
    links: [
      ["/console/simulator", "Simulator"],
      ["/console/events", "Live events"],
      ["/console/audit", "Audit log"],
    ],
  },
];

export function ConsolePage() {
  const [role, setRole] = useState<Role>(() => load<Role>(KEYS.role, "campaign_manager"));
  const changeRole = (r: Role) => {
    save(KEYS.role, r);
    setRole(r);
  };

  return (
    <ApiProvider role={role}>
      <div className="console">
        <aside className="sidebar">
          {SECTIONS.map((s) => (
            <div key={s.group} style={{ display: "contents" }}>
              <div className="sidebar-group">{s.group}</div>
              {s.links.map(([to, label]) => (
                <NavLink key={to} to={to} end>
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="sidebar-group">API</div>
          <Health />
        </aside>
        <div className="console-main">
          <div className="row-between" style={{ marginBottom: 20 }}>
            <span className="small muted">Bank console · all figures simulated</span>
            <label className="role-picker small">
              <span className="muted">Acting as</span>
              <select className="select input-sm" style={{ width: "auto" }} value={role} onChange={(e) => changeRole(e.target.value as Role)}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>{humanize(r)}</option>
                ))}
              </select>
            </label>
          </div>
          <Outlet />
        </div>
      </div>
    </ApiProvider>
  );
}

function Health() {
  const api = useApi();
  const health = useQuery(() => api.health(), []);
  const ok = health.data?.status === "ok";
  return (
    <div className="row small" style={{ padding: "4px 10px" }} title="GET /health">
      <span className="live-dot" style={ok ? undefined : { background: "var(--red)", animation: "none" }} aria-hidden />
      <span className="muted">{health.loading ? "Checking…" : ok ? `Healthy (${health.data?.env})` : "Unreachable"}</span>
    </div>
  );
}

/** Page header used by every console section. */
export function ConsoleHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
