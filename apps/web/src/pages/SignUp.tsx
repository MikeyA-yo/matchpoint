import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ErrorNote, Field } from "../components/ui";
import { useApi, useSession } from "../lib/context";
import { useAction } from "../lib/hooks";
import { PERSONAS } from "../lib/personas";
import { CHANNEL_LABEL } from "../lib/format";
import { CHANNELS, type Channel, type Persona } from "../lib/types";


export function SignUp() {
  const api = useApi();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [persona, setPersona] = useState<Persona>("salaried_parent");
  // Silence is not consent: everything starts off
  const [offers, setOffers] = useState(false);
  const [channels, setChannels] = useState<Record<Channel, boolean>>({ app: false, whatsapp: false, sms: false, email: false });
  const [signUp, state] = useAction(api.signUp);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await signUp({ name, phone, password, persona, consent: { personalised_offers: offers, channels } });
    if (res) {
      setSession(res);
      navigate("/app", { replace: true });
    }
  }

  return (
    <main className="container">
      <div className="auth stack">
        <div>
          <h2>Create a demo account</h2>
          <p className="muted">We'll fill your demo account with sample transactions that match the profile you pick.</p>
        </div>
        <section className="card">
          <form className="card-body stack" onSubmit={onSubmit}>
            <Field label="Full name">
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Phone number" hint="Used to sign in. 10 to 14 digits.">
              <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="080…" required />
            </Field>
            <Field label="Password" hint="At least 6 characters. Demo only, don't reuse a real one.">
              <input className="input" type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>

            <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ marginBottom: 6 }}>Which sounds most like you?</legend>
              {(Object.keys(PERSONAS) as Persona[]).map((p) => (
                <label key={p} className="persona">
                  <input type="radio" name="persona" value={p} checked={persona === p} onChange={() => setPersona(p)} />
                  <strong>{PERSONAS[p].label}</strong>
                  <span className="small muted" style={{ display: "block" }}>{PERSONAS[p].description}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ marginBottom: 6 }}>Consent</legend>
              <label className="checkbox">
                <input type="checkbox" checked={offers} onChange={(e) => setOffers(e.target.checked)} />
                <span>
                  Send me personalised offers based on how I use my account
                  <span className="hint" style={{ display: "block" }}>Optional. You can turn this off at any time, and every message has a Stop offers button.</span>
                </span>
              </label>
              <div className="hint">Channels you're happy to hear from us on:</div>
              <div className="row" style={{ gap: 16 }}>
                {CHANNELS.map((ch) => (
                  <label key={ch} className="checkbox">
                    <input type="checkbox" checked={channels[ch]} onChange={(e) => setChannels({ ...channels, [ch]: e.target.checked })} />
                    {CHANNEL_LABEL[ch]}
                  </label>
                ))}
              </div>
            </fieldset>

            <ErrorNote error={state.error} />
            <Button type="submit" variant="primary" size="lg" block loading={state.loading}>
              Create account
            </Button>
            <p className="small muted" style={{ textAlign: "center" }}>
              Already have one? <Link to="/signin">Sign in</Link>
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

