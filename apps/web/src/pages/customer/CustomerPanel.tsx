import { useEffect, useState } from "react";
import { Button, Card, Empty, ErrorNote, Loading } from "../../components/ui";
import { useApi } from "../../lib/context";
import { describeDecision, type PlainDecision } from "../../lib/describe";
import { CHANNEL_LABEL, fmtDay, fmtTime, shiftDays } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { load, save } from "../../lib/storage";
import { CONTACT_CHANNELS, type Customer, type Decision, type Pattern } from "../../lib/types";

const EVENTS: { pattern: Pattern; label: string }[] = [
  { pattern: "salary_pattern", label: "Salary credited" },
  { pattern: "fee_season", label: "School fees paid" },
  { pattern: "sme_growth", label: "POS sales up" },
];

/** Account summary and message log next to the phone. */
export function CustomerPanel({ customer }: { customer: Customer }) {
  const api = useApi();
  const ref = customer.customer_ref;
  const productName = useProductNames();
  const profile = useQuery(() => api.customer(ref), [ref]);
  const consent = useQuery(() => api.consent(ref), [ref]);
  const rewards = useQuery(() => api.rewards(ref), [ref]);
  const decisions = useQuery(() => api.decisions({ customer_ref: ref, limit: 50 }), [ref]);

  useStream((e) => {
    if (e.data.customer_ref !== ref) return;
    if (e.type === "decision_created" || e.type === "outcome_recorded") decisions.reload();
    if (e.type === "outcome_recorded") profile.reload();
    if (e.type === "consent_changed") consent.reload();
    if (e.type === "points_awarded" || e.type === "points_redeemed") rewards.reload();
  });

  const holdings = profile.data?.holdings ?? customer.holdings;
  const c = consent.data;
  const channels = c ? CONTACT_CHANNELS.filter((ch) => c.channels[ch]).map((ch) => CHANNEL_LABEL[ch]) : [];
  const log = (decisions.data?.items ?? []).filter((d) => d.mode === "live");

  return (
    <div className="stack">
      <Card title="Account">
        <dl className="kv">
          <dt>Products</dt>
          <dd>{holdings.map((h) => productName(h)).join(", ")}</dd>
          <dt>Personalised offers</dt>
          <dd>{c ? (c.personalised_offers ? "On" : "Off") : "…"}</dd>
          <dt>Contact by</dt>
          <dd>{c ? channels.join(", ") || "None" : "…"}</dd>
          <dt>Rewards</dt>
          <dd>{rewards.data ? `${rewards.data.balance.toLocaleString("en-NG")} points · ${rewards.data.tier}` : "…"}</dd>
        </dl>
      </Card>

      <Card title="Message log" actions={log.length > 0 && <span className="small faint">{log.length}</span>} bodyClass="">
        <ErrorNote error={decisions.error} />
        {decisions.loading && !decisions.data ? (
          <Loading />
        ) : !log.length ? (
          <Empty title="No activity yet" />
        ) : (
          <ul className="activity">
            {log.map((d) => <LogItem key={d.id} d={d} plain={describeDecision(d, productName(d.product_id))} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LogItem({ d, plain }: { d: Decision; plain: PlainDecision }) {
  return (
    <li className={`activity-item tone-${plain.tone}`}>
      <span className="activity-dot" aria-hidden />
      <div className="row-between" style={{ flexWrap: "nowrap", alignItems: "baseline" }}>
        <span>
          <strong>{plain.status}</strong> <span className="muted">· {plain.detail}</span>
        </span>
        <span className="small faint" style={{ whiteSpace: "nowrap" }}>{fmtDay(d.as_of)}</span>
      </div>
    </li>
  );
}

/** Test-mode toolbar: move the simulated clock, run decisioning, simulate account events. */
export function SandboxBar({ customerRef }: { customerRef: string }) {
  const api = useApi();
  const productName = useProductNames();
  const sim = useQuery(() => api.simState(), []);
  const timeKey = `matchpoint.demoTime.${customerRef}`;
  const [time, setTimeState] = useState<string | null>(() => load<string | null>(timeKey, null));
  const [last, setLast] = useState<Decision | null>(null);
  const [start, startState] = useAction(api.simStart);
  const [run, runState] = useAction(async (at: string, event?: Pattern) => {
    if (event) await api.simInject(event, customerRef);
    return api.evaluate(customerRef, "live", at);
  });

  const setTime = (t: string) => {
    save(timeKey, t);
    setTimeState(t);
  };

  useEffect(() => {
    if (!time && sim.data?.clock) setTime(sim.data.clock);
  }, [sim.data?.clock]);

  const go = async (at: string, event?: Pattern) => {
    const d = await run(at, event);
    if (d) setLast(d);
  };

  const paused = sim.data && !sim.data.running;
  const plain = last ? describeDecision(last, productName(last.product_id)) : null;
  const busy = !time || runState.loading;

  return (
    <div className="sandbox-bar" role="toolbar" aria-label="Sandbox controls">
      <span className="env-tag">Sandbox</span>
      {paused ? (
        <>
          <span className="small muted">Simulation stopped</span>
          <Button size="sm" variant="primary" loading={startState.loading} onClick={async () => (await start({ seed: 42, n_customers: 5000, days: 120, scenario: "baseline" })) && sim.reload()}>
            Start
          </Button>
        </>
      ) : (
        <>
          <span className="sandbox-date">{time ? `${fmtDay(time, true)}, ${fmtTime(time)}` : "…"}</span>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="primary" disabled={!time} loading={runState.loading} onClick={() => time && go(time)}>
              Run decisioning
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!time) return;
                const next = shiftDays(time, 7);
                setTime(next);
                go(next);
              }}
            >
              +1 week
            </Button>
            <select
              className="select input-sm"
              style={{ width: "auto" }}
              value=""
              disabled={busy}
              aria-label="Simulate an account event"
              onChange={(e) => time && e.target.value && go(time, e.target.value as Pattern)}
            >
              <option value="">Simulate event…</option>
              {EVENTS.map((ev) => <option key={ev.pattern} value={ev.pattern}>{ev.label}</option>)}
            </select>
          </div>
        </>
      )}
      <span className="spacer" />
      {(runState.error || startState.error || sim.error) && (
        <span className="small" style={{ color: "var(--red)" }}>{(runState.error ?? startState.error ?? sim.error)?.message}</span>
      )}
      {plain && !runState.error && (
        <span className={`sandbox-result tone-${plain.tone}`} role="status">
          <span className="activity-dot" aria-hidden />
          <strong>{plain.status}</strong> <span className="muted">{plain.detail}</span>
        </span>
      )}
    </div>
  );
}
