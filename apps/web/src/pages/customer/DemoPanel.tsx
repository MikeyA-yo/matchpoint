import { useEffect, useState } from "react";
import { DecisionDrawer, DecisionView } from "../../components/DecisionView";
import { EventFeed } from "../../components/EventFeed";
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, OutcomeBadge, ReasonChip, Segmented, Simulated } from "../../components/ui";
import { useApi } from "../../lib/context";
import { fmtDateTime, fromLocalInput, humanize, shiftDays, toLocalInput } from "../../lib/format";
import { useAction, useEventLog, useQuery, useStream } from "../../lib/hooks";
import { PERSONAS, segmentLabel } from "../../lib/personas";
import { useProductNames } from "../../lib/products";
import type { ApiError } from "../../lib/api";
import { PATTERNS, type Customer, type EvalMode, type Pattern, type SimState } from "../../lib/types";

/** Presenter controls next to the phone: run the pipeline for this customer and watch what happens. */
export function DemoPanel({ customer }: { customer: Customer }) {
  const api = useApi();
  const ref = customer.customer_ref;
  const sim = useQuery(() => api.simState(), []);
  const profile = useQuery(() => api.customer(ref), [ref]);
  const decisions = useQuery(() => api.decisions({ customer_ref: ref, limit: 20 }), [ref]);
  const [events] = useEventLog((e) => e.data.customer_ref === ref);
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  const productName = useProductNames();

  useStream((e) => {
    if (e.data.customer_ref !== ref) return;
    if (e.type === "decision_created" || e.type === "outcome_recorded") decisions.reload();
    if (e.type === "outcome_recorded") profile.reload();
  });

  const p = profile.data ?? customer;

  return (
    <div className="stack">
      <Card title="Customer" endpoint="GET /customers/{ref}" actions={<Simulated />}>
        <div className="grid-2 small">
          <div><div className="faint">Customer ref</div><code>{p.customer_ref}</code></div>
          <div><div className="faint">Profile</div>{p.persona ? PERSONAS[p.persona].label : p.story ?? segmentLabel(p.segment)}</div>
          <div><div className="faint">Segment</div>{segmentLabel(p.segment)} · age {p.age_band}</div>
          <div><div className="faint">Holds</div>{p.holdings.map(productName).join(", ")}</div>
        </div>
      </Card>

      <SimCard state={sim.data} error={sim.error} onChange={sim.reload} />

      <EvaluateCard customerRef={ref} clock={sim.data?.clock ?? null} />

      <InjectCard customerRef={ref} />

      <Card
        title="Decisions"
        endpoint={["GET /decisions?customer_ref", "GET /decisions/{id}"]}
        actions={<Button size="sm" variant="ghost" onClick={decisions.reload}>Refresh</Button>}
        bodyClass=""
      >
        {decisions.loading && !decisions.data ? (
          <Loading />
        ) : decisions.error ? (
          <div className="card-body"><ErrorNote error={decisions.error} /></div>
        ) : !decisions.data?.items.length ? (
          <Empty title="No decisions yet" />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr><th>As of</th><th>Outcome</th><th>Reasons</th><th>Product</th></tr>
              </thead>
              <tbody>
                {decisions.data.items.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => setOpenDecision(d.id)}>
                    <td data-label="As of" className="small">{fmtDateTime(d.as_of)}</td>
                    <td data-label="Outcome"><OutcomeBadge outcome={d.outcome} /></td>
                    <td data-label="Reasons"><div className="row">{d.reasons.map((r) => <ReasonChip key={r} code={r} />)}</div></td>
                    <td data-label="Product" className="small">{productName(d.product_id) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={<><span className="live-dot" aria-hidden /> Live events for me</>}
        endpoint="GET /stream"
      >
        <EventFeed events={events} emptyHint="Run a decision or tap something on the phone." />
      </Card>

      {openDecision && <DecisionDrawer id={openDecision} onClose={() => setOpenDecision(null)} />}
    </div>
  );
}

function SimCard({ state, error, onChange }: { state?: SimState; error?: ApiError; onChange: () => void }) {
  const api = useApi();
  const [start, startState] = useAction(api.simStart);
  return (
    <Card title="Simulator" endpoint={["GET /sim/state", "POST /sim/start"]} actions={<Simulated />}>
      <ErrorNote error={error ?? startState.error} />
      {state && (
        <div className="row-between">
          <div className="small">
            {state.running ? (
              <>
                <Badge tone="green">running</Badge>{" "}
                <span className="muted">Clock</span> {fmtDateTime(state.clock)} · <span className="muted">seed</span> {state.seed} ·{" "}
                {state.n_customers.toLocaleString()} customers
              </>
            ) : (
              <><Badge tone="amber">stopped</Badge> <span className="muted">Start it to run decisions.</span></>
            )}
          </div>
          {!state.running && (
            <Button
              variant="primary"
              size="sm"
              loading={startState.loading}
              onClick={async () => {
                if (await start({ seed: 42, n_customers: 5000, days: 120, scenario: "baseline" })) onChange();
              }}
            >
              Start simulation
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function EvaluateCard({ customerRef, clock }: { customerRef: string; clock: string | null }) {
  const api = useApi();
  const [asOf, setAsOf] = useState(toLocalInput(clock));
  const [mode, setMode] = useState<EvalMode>("live");
  const [evaluate, state] = useAction(api.evaluate);

  useEffect(() => {
    if (clock && !asOf) setAsOf(toLocalInput(clock));
  }, [clock]);

  const shift = (days: number) => {
    const base = fromLocalInput(asOf) ?? clock;
    if (base) setAsOf(toLocalInput(shiftDays(base, days)));
  };

  return (
    <Card
      title="Evaluate"
      endpoint="POST /decisions/evaluate"
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="As of (WAT)">
            <input className="input" type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Field label="Mode" hint={mode === "live" ? "Delivers on send." : "Records only."}>
            <Segmented
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[{ value: "live", label: "Live" }, { value: "dry_run", label: "Dry run" }]}
            />
          </Field>
        </div>
        <div className="row">
          <Button variant="primary" loading={state.loading} onClick={() => evaluate(customerRef, mode, fromLocalInput(asOf))}>
            Run decision
          </Button>
          <Button size="sm" variant="ghost" onClick={() => shift(1)}>+1 day</Button>
          <Button size="sm" variant="ghost" onClick={() => shift(7)}>+7 days</Button>
          <Button size="sm" variant="ghost" onClick={() => shift(30)}>+30 days</Button>
          <Button size="sm" variant="ghost" onClick={() => shift(0.5)}>+12 hours</Button>
        </div>
        <ErrorNote error={state.error} />
        {state.data && <DecisionView decision={state.data} />}
      </div>
    </Card>
  );
}

function InjectCard({ customerRef }: { customerRef: string }) {
  const api = useApi();
  const [pattern, setPattern] = useState<Pattern>("salary_pattern");
  const [inject, state] = useAction(api.simInject);
  return (
    <Card title="Inject pattern" endpoint="POST /sim/inject">
      <div className="row">
        <select className="select" style={{ width: "auto" }} value={pattern} onChange={(e) => setPattern(e.target.value as Pattern)}>
          {PATTERNS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
        </select>
        <Button loading={state.loading} onClick={() => inject(pattern, customerRef)}>Inject</Button>
        {state.data && <span className="small ok-text">✓ Planted {humanize(state.data.pattern).toLowerCase()}.</span>}
      </div>
      <div style={{ marginTop: 8 }}><ErrorNote error={state.error} /></div>
    </Card>
  );
}
