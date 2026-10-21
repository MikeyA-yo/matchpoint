import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, ErrorNote, Field } from "../components/ui";
import { useApi, useSession } from "../lib/context";
import { useAction } from "../lib/hooks";
import { DEMO_ACCOUNTS, PERSONAS } from "../lib/personas";

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
        <div>
          <h2>Sign in</h2>
          <p className="muted">Pick a sample customer below, or use the demo account you created.</p>
        </div>
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
              New here? <Link to="/signup">Create a demo account</Link>
            </p>
          </form>
        </section>

        <section className="card">
          <div className="card-body stack-sm">
            <div className="label">Sample customers</div>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.phone}
                type="button"
                className="demo-account"
                disabled={state.loading}
                onClick={() => {
                  setPhone(a.phone);
                  setPassword(a.password);
                  submit(a.phone, a.password);
                }}
              >
                <span>
                  <strong>{a.name}</strong>
                  <span className="small muted" style={{ display: "block" }}>{PERSONAS[a.persona].label} · {a.note}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
