import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ErrorNote, Field } from "../components/ui";
import { useApi, useSession } from "../lib/context";
import { useAction } from "../lib/hooks";
import { CHANNEL_LABEL } from "../lib/format";
import { PERSONAS } from "../lib/personas";
import { CONTACT_CHANNELS, type Channel, type Persona } from "../lib/types";

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
  const [channels, setChannels] = useState<Record<Channel, boolean>>({ app: false, whatsapp: false, sms: false, email: false, ussd: false });
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
        <h2>Open an account</h2>
        <section className="card">
          <form className="card-body stack" onSubmit={onSubmit}>
            <Field label="Full name">
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Phone number" hint="Used to sign in. 10 to 14 digits.">
              <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="080…" required />
            </Field>
            <Field label="Password" hint="At least 6 characters.">
              <input className="input" type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>

            <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ marginBottom: 6 }}>Account profile</legend>
              <span className="hint">Sandbox accounts come with sample transactions for the profile you choose.</span>
              {(Object.keys(PERSONAS) as Persona[]).map((p) => (
                <label key={p} className="persona">
                  <input type="radio" name="persona" value={p} checked={persona === p} onChange={() => setPersona(p)} />
                  <strong>{PERSONAS[p].label}</strong>
                  <span className="small muted" style={{ display: "block" }}>{PERSONAS[p].description}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ marginBottom: 6 }}>Marketing preferences</legend>
              <label className="checkbox">
                <input type="checkbox" checked={offers} onChange={(e) => setOffers(e.target.checked)} />
                <span>
                  Send me personalised offers based on my account activity
                  <span className="hint" style={{ display: "block" }}>Optional. You can change this any time in Privacy.</span>
                </span>
              </label>
              <div className="hint">Contact me by</div>
              <div className="row" style={{ gap: 16 }}>
                {CONTACT_CHANNELS.map((ch) => (
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

