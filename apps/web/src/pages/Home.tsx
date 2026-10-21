import { Link } from "react-router";
import { useSession } from "../lib/context";

export function Home() {
  const { session } = useSession();
  return (
    <main className="container home">
      <div className="home-head">
        <span className="env-tag">Sandbox</span>
        <h1>MATCHPOINT</h1>
        <p className="muted">Offer decisioning for retail banking</p>
      </div>

      <div className="grid-2 home-doors">
        <section className="card door">
          <div className="card-body stack">
            <div>
              <h3>Customer app</h3>
              <p className="muted small">Inbox, offers and contact preferences.</p>
            </div>
            <div className="row">
              {session ? (
                <Link to="/app" className="btn btn-primary">Continue as {session.customer.name.split(" ")[0]}</Link>
              ) : (
                <>
                  <Link to="/signin" className="btn btn-primary">Sign in</Link>
                  <Link to="/signup" className="btn btn-secondary">Open an account</Link>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="card door">
          <div className="card-body stack">
            <div>
              <h3>Console</h3>
              <p className="muted small">Decisions, review queue, policies and experiments.</p>
            </div>
            <div className="row">
              <Link to="/console" className="btn btn-secondary">Open console</Link>
            </div>
          </div>
        </section>
      </div>

      <p className="small faint home-foot">Sandbox environment. Customers, balances and transactions are synthetic.</p>
    </main>
  );
}
