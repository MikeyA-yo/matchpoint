import { Link } from "react-router";
import { useSession } from "../lib/context";

const STEPS = [
  "Consent gate",
  "Detect life moments from transactions",
  "Match eligible products",
  "Hard rules: caps, gaps, cooldowns, quiet hours",
  "Uplift score and attention budget",
  "Explain, from evidence only",
];

const FEATURES = [
  { title: "Consent first", body: "No profiling consent, no profiling. The gate runs before anything else is read, and Stop offers applies on every channel at once." },
  { title: "Restraint by default", body: "Caps, cooldowns and an uplift model that can only make the system quieter. Most decisions end in silence, and that is the point." },
  { title: "Explains itself", body: "Every message carries a plain reason built from the customer's own data, and every decision keeps a full trace for compliance." },
];

export function Home() {
  const { session } = useSession();
  return (
    <main className="container">
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span className="live-dot" aria-hidden /> Decision layer for bank offers
          </div>
          <h1>
            The right offer, <span className="green">or none at all.</span>
          </h1>
          <p className="hero-lede">
            MATCHPOINT sits between a bank's product teams and its customers. It decides what to recommend, when, on
            which channel, and whether to say nothing.
          </p>
          <div className="row" style={{ gap: 12 }}>
            {session ? (
              <Link to="/app" className="btn btn-primary btn-lg">Open my phone view</Link>
            ) : (
              <>
                <Link to="/signup" className="btn btn-primary btn-lg">Try it as a customer</Link>
                <Link to="/signin" className="btn btn-secondary btn-lg">Sign in</Link>
              </>
            )}
            <Link to="/console" className="btn btn-ghost btn-lg">Bank console →</Link>
          </div>
        </div>
        <div className="pipeline" aria-label="Decision pipeline">
          {STEPS.map((s, i) => (
            <div key={s} className="pipeline-step">
              <span className="n">{i + 1}</span>
              {s}
            </div>
          ))}
          <div className="pipeline-step quiet">
            <span className="n">7</span>
            <span>
              <strong>Send</strong> <span className="muted">or hold, review, or stay silent</span>
            </span>
          </div>
        </div>
      </section>

      <h2 className="section-title">What makes it different</h2>
      <div className="grid-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card feature">
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>

      <h2 className="section-title">Running the demo</h2>
      <div className="grid-3">
        <div className="card feature">
          <h3>1. Be a customer</h3>
          <p>Sign up with a persona, or sign in with a demo account. Choose what you consent to.</p>
        </div>
        <div className="card feature">
          <h3>2. Trigger a decision</h3>
          <p>From the demo panel next to the phone, run the pipeline for yourself and watch the message arrive, or not.</p>
        </div>
        <div className="card feature">
          <h3>3. See the bank side</h3>
          <p>The console shows the silence feed, review queue, policies, experiments and live events.</p>
        </div>
      </div>

      <p className="small faint" style={{ marginTop: 48 }}>
        All customers, transactions and results are synthetic. Numbers show the method works against known ground
        truth, not production performance.
      </p>
    </main>
  );
}
