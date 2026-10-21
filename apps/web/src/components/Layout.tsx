import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useSession, useTechnical } from "../lib/context";
import { getMode, setMode } from "../lib/mode";
import { Button } from "./ui";

export function Layout() {
  const { session, setSession } = useSession();
  const { technical, setTechnical } = useTechnical();
  const navigate = useNavigate();
  const mode = getMode();

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-dot" aria-hidden />
          MATCHPOINT
        </Link>
        <nav className="nav">
          <NavLink to="/app">Customer app</NavLink>
          <NavLink to="/console">Console</NavLink>
        </nav>
        <div className="topbar-right">
          {technical && (
            <button
              type="button"
              className={`mode-toggle ${mode}`}
              onClick={() => setMode(mode === "mock" ? "live" : "mock")}
              title={
                mode === "mock"
                  ? "Using the in-browser mock backend. Click to use the live API."
                  : "Using the live API where an endpoint exists, the mock elsewhere. Click to use only the mock."
              }
            >
              <span className="dot" aria-hidden />
              {mode === "mock" ? "Mock API" : "Live API"}
            </button>
          )}
          <label className="tech-toggle" title="Show endpoints, IDs, traces and API mode">
            <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
            <span className="switch-track" aria-hidden />
            <span>Developer view</span>
          </label>
          {session ? (
            <>
              <span className="small muted">{session.customer.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSession(null);
                  navigate("/");
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link to="/signup" className="btn btn-primary btn-sm">Open account</Link>
            </>
          )}
        </div>
      </header>
      <Outlet />
    </>
  );
}
