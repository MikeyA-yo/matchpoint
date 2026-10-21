import { useEffect, useState } from "react";
import { Button, Card, Empty, ErrorNote, Loading } from "../../components/ui";
import { useApi } from "../../lib/context";
import { describeDecision, VIA, type PlainDecision } from "../../lib/describe";
import { fmtDay, shiftDays } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { load, save } from "../../lib/storage";
import { CHANNELS, type Customer, type Decision, type Pattern } from "../../lib/types";

const LIFE_EVENTS: { pattern: Pattern; label: string }[] = [
  { pattern: "salary_pattern", label: "Salary paid" },
  { pattern: "fee_season", label: "School fees due" },
  { pattern: "sme_growth", label: "Business growing" },
];

/** What a customer (or a judge) sees next to the phone: plain language, no IDs or codes. */
export function CustomerPanel({ customer }: { customer: Customer }) {
  const api = useApi();
  const ref = customer.customer_ref;
  const productName = useProductNames();
  const profile = useQuery(() => api.customer(ref), [ref]);
  const consent = useQuery(() => api.consent(ref), [ref]);
  const decisions = useQuery(() => api.decisions({ customer_ref: ref, limit: 50 }), [ref]);

  useStream((e) => {
    if (e.data.customer_ref !== ref) return;
    if (e.type === "decision_created" || e.type === "outcome_recorded") decisions.reload();
    if (e.type === "outcome_recorded") profile.reload();
    if (e.type === "consent_changed") consent.reload();
  });

  const holdings = profile.data?.holdings ?? customer.holdings;
  const c = consent.data;
  const channels = c ? CHANNELS.filter((ch) => c.channels[ch]).map((ch) => VIA[ch]) : [];
  const activity = (decisions.data?.items ?? []).filter((d) => d.mode === "live");

  return (
    <div className="stack">
      <TryIt customerRef={ref} />

      <Card title="Your account">
        <div className="grid-2">
          <div>
            <div className="label">Your products</div>
            <ul className="plain-list">
              {holdings.map((h) => <li key={h}>{productName(h)}</li>)}
            </ul>
          </div>
          <div>
            <div className="label">Your choices</div>
            {c ? (
              <ul className="plain-list">
                <li>Personalised offers: <strong>{c.personalised_offers ? "on" : "off"}</strong></li>
                <li>{channels.length ? `We can reach you ${channels.join(" and ")}` : "You haven't chosen how we can reach you"}</li>
              </ul>
            ) : (
              <p className="muted small">Loading…</p>
            )}
            <p className="small faint" style={{ marginTop: 6 }}>Change these in Privacy on your phone.</p>
          </div>
        </div>
      </Card>

      <Card title="What MATCHPOINT did for you" sub="Including the times it chose not to message you. That's on purpose.">
        <ErrorNote error={decisions.error} />
        {decisions.loading && !decisions.data ? (
          <Loading />
        ) : !activity.length ? (
          <Empty title="Nothing yet">Press "Check for offers" above to see what happens.</Empty>
        ) : (
          <ul className="activity">
            {activity.map((d) => <ActivityItem key={d.id} d={d} plain={describeDecision(d, productName(d.product_id))} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ActivityItem({ d, plain }: { d: Decision; plain: PlainDecision }) {
  return (
    <li className={`activity-item tone-${plain.tone}`}>
      <span className="activity-dot" aria-hidden />
      <div>
        <div className="row-between">
          <strong>{plain.headline}</strong>
          <span className="small faint">{fmtDay(d.as_of)}</span>
        </div>
        <p className="muted">{plain.text}</p>
      </div>
    </li>
  );
}

function TryIt({ customerRef }: { customerRef: string }) {
  const api = useApi();
  const productName = useProductNames();
  const sim = useQuery(() => api.simState(), []);
  const timeKey = `matchpoint.demoTime.${customerRef}`;
  const [time, setTimeState] = useState<string | null>(() => load<string | null>(timeKey, null));
  const [last, setLast] = useState<{ d: Decision; event?: string } | null>(null);
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
    if (d) setLast({ d, event: LIFE_EVENTS.find((e) => e.pattern === event)?.label });
  };

  if (sim.loading && !sim.data) return <Card title="Try it out"><Loading /></Card>;
  if (sim.data && !sim.data.running) {
    return (
      <Card title="Try it out">
        <div className="row-between">
          <p className="muted">The demo is paused.</p>
          <Button variant="primary" loading={startState.loading} onClick={async () => (await start({ seed: 42, n_customers: 5000, days: 120, scenario: "baseline" })) && sim.reload()}>
            Start the demo
          </Button>
        </div>
        <ErrorNote error={startState.error ?? sim.error} />
      </Card>
    );
  }

  const plain = last ? describeDecision(last.d, productName(last.d.product_id)) : null;

  return (
    <Card title="Try it out" sub="Move time forward or add something to your account, then see what MATCHPOINT does.">
      <div className="stack">
        <div className="row-between">
          <span className="small muted">Demo date <strong style={{ color: "var(--text)" }}>{time ? fmtDay(time, true) : "…"}</strong></span>
        </div>
        <div className="row">
          <Button variant="primary" disabled={!time} loading={runState.loading} onClick={() => time && go(time)}>
            Check for offers
          </Button>
          <Button
            disabled={!time || runState.loading}
            onClick={() => {
              if (!time) return;
              const next = shiftDays(time, 7);
              setTime(next);
              go(next);
            }}
          >
            Skip ahead a week
          </Button>
        </div>
        <div className="row small">
          <span className="muted">Something happens:</span>
          {LIFE_EVENTS.map((e) => (
            <button key={e.pattern} type="button" className="event-chip" disabled={!time || runState.loading} onClick={() => time && go(time, e.pattern)}>
              {e.label}
            </button>
          ))}
        </div>
        <ErrorNote error={runState.error} />
        {plain && (
          <div className={`result tone-${plain.tone}`} role="status">
            <strong>{last?.event ? `${last.event}. ${plain.headline}` : plain.headline}</strong>
            <span>{plain.text}</span>
            {plain.tone === "sent" && <span className="small">Have a look at the phone.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}
