import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, ErrorNote, Field } from "../components/ui";
import { useApi, useSession } from "../lib/context";
import { useAction } from "../lib/hooks";
import { DEMO_CUSTOMERS, DEMO_PASSWORD } from "../lib/personas";

export function SignIn() {
  const api = useApi();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/app";
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [signIn, state] = useAction(api.signIn);

  async function submit(p = phone, pw = password) {
    const res = await signIn(p, pw);
    if (res) {
      setSession(res);
      navigate(from, { replace: true });
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <main className="container">
      <div className="auth stack">
        <h2>Sign in</h2>
        <section className="card">
          <form className="card-body stack" onSubmit={onSubmit}>
            <Field label="Phone number">
              <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="080…" required />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorNote error={state.error} />
            <Button type="submit" variant="primary" size="lg" block loading={state.loading}>
              Sign in
            </Button>
            <p className="small muted" style={{ textAlign: "center" }}>
              No account? <Link to="/signup">Open one</Link>
            </p>
          </form>
        </section>

        <section className="card">
          <div className="card-body stack-sm">
            <div className="label">Sandbox accounts</div>
            {DEMO_CUSTOMERS.map((a) => (
              <button
                key={a.phone}
                type="button"
                className="demo-account"
                disabled={state.loading}
                onClick={() => {
                  setPhone(a.phone);
                  setPassword(DEMO_PASSWORD);
                  submit(a.phone, DEMO_PASSWORD);
                }}
              >
                <span>
                  <strong>{a.name}</strong>
                  <span className="small muted" style={{ display: "block" }}>{a.note}</span>
                </span>
                <span className="small faint" aria-hidden>Sign in →</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
