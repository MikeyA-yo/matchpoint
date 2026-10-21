import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Badge } from "../../components/ui";
import { onServedChange, servedEndpoints } from "../../lib/api";
import { ApiProvider, useApi, useTechnical } from "../../lib/context";
import { getMode } from "../../lib/mode";
import { humanize } from "../../lib/format";
import { useQuery } from "../../lib/hooks";
import { KEYS, load, save } from "../../lib/storage";
import { STAFF_ROLES, type Role } from "../../lib/types";

const SECTIONS: { group: string; links: [to: string, label: string][] }[] = [
  { group: "Overview", links: [["/console", "Overview"]] },
  {
    group: "Decisions",
    links: [
      ["/console/decisions", "Decision log"],
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
      ["/console/model", "Targeting model"],
    ],
  },
  {
    group: "Sandbox",
    links: [
      ["/console/simulator", "Simulator"],
      ["/console/events", "Event stream"],
      ["/console/audit", "Audit log"],
    ],
  },
];

export function ConsolePage() {
  const [role, setRole] = useState<Role>(() => load<Role>(KEYS.role, "campaign_manager"));
  const { pathname } = useLocation();
  // On phones the sidebar is a scrolling strip; keep the current page in view
  useEffect(() => {
    document.querySelector(".sidebar a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
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
          <div className="sidebar-status">
            <div className="sidebar-group">Status</div>
            <Health />
          </div>
        </aside>
        <div className="console-main">
          <div className="row-between" style={{ marginBottom: 20 }}>
            <span className="env-tag">Sandbox</span>
            <label className="role-picker small">
              <span className="muted">Role</span>
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
  const { technical } = useTechnical();
  const health = useQuery(() => api.health(), []);
  const [, rerender] = useState(0);
  useEffect(() => onServedChange(() => rerender((n) => n + 1)), []);
  const ok = health.data?.status === "ok";
  const endpoints = servedEndpoints();

  return (
    <>
      <div className="row small" style={{ padding: "4px 10px" }}>
        <span className="live-dot" style={{ background: ok ? "var(--green)" : "var(--amber)", animation: "none" }} aria-hidden />
        <span className="muted">{health.loading ? "Checking…" : ok ? (technical ? `API healthy (${health.data?.env})` : "Operational") : "API unreachable"}</span>
      </div>
      {technical && getMode() === "live" && endpoints.length > 0 && (
        <div className="small" style={{ padding: "6px 10px" }}>
          <div className="faint" style={{ marginBottom: 4 }}>Used this session</div>
          {endpoints.map(([route, by]) => (
            <div key={route} className="row" style={{ gap: 6, flexWrap: "nowrap" }} title={by === "live" ? "Answered by the API" : "Not built yet; answered by the mock"}>
              <Badge tone={by === "live" ? "green" : "grey"}>{by}</Badge>
              <code style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{route}</code>
            </div>
          ))}
        </div>
      )}
    </>
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
