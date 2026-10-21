import { useState } from "react";
import { DecisionDrawer, DecisionView } from "../../components/DecisionView";
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, OutcomeBadge, ReasonChip, Segmented, Simulated } from "../../components/ui";
import { useApi, useRole } from "../../lib/context";
import { fmtDateTime, fromLocalInput, humanize } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { REASONS, type Decision, type DecisionFilters, type EvalMode, type Outcome, type ReasonCode } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

const OUTCOMES: Outcome[] = ["send", "hold", "silent", "review"];

function DecisionTable({ items, onOpen }: { items: Decision[]; onOpen: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>As of</th><th>Customer</th><th>Outcome</th><th>Reasons</th><th>Product</th><th>Channel</th></tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
              <td className="small">{fmtDateTime(d.as_of)}</td>
              <td><code>{d.customer_ref}</code></td>
              <td><OutcomeBadge outcome={d.outcome} /></td>
              <td><div className="row">{d.reasons.map((r) => <ReasonChip key={r} code={r} />)}</div></td>
              <td className="small">{d.product_id ? humanize(d.product_id) : "—"}</td>
              <td className="small">{d.channel ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- GET /decisions ----------

export function SilenceFeed() {
  const api = useApi();
  const [filters, setFilters] = useState<DecisionFilters>({});
  const [extra, setExtra] = useState<Decision[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const products = useQuery(() => api.products(), []);
  const feed = useQuery(async () => {
    const res = await api.decisions({ ...filters, limit: 25 });
    setExtra([]);
    setCursor(res.next_cursor);
    return res;
  }, [JSON.stringify(filters)]);
  const [loadMore, more] = useAction(async () => {
    const res = await api.decisions({ ...filters, limit: 25, cursor: cursor ?? undefined });
    setExtra((prev) => [...prev, ...res.items]);
    setCursor(res.next_cursor);
    return res;
  });

  useStream((e) => e.type === "decision_created" && feed.reload());

  const set = <K extends keyof DecisionFilters>(k: K, v: DecisionFilters[K] | "") =>
    setFilters((f) => ({ ...f, [k]: v || undefined }));
  const items = [...(feed.data?.items ?? []), ...extra];

  return (
    <>
      <ConsoleHead title="Silence feed">Every decision, including the messages MATCHPOINT chose not to send, and why.</ConsoleHead>
      <Card
        title="Decisions"
        endpoint={["GET /decisions", "GET /decisions/{id}"]}
        actions={<><Simulated /><Button size="sm" variant="ghost" onClick={feed.reload}>Refresh</Button></>}
        bodyClass=""
      >
        <div className="card-body grid-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <Field label="Outcome">
            <select className="select" value={filters.outcome ?? ""} onChange={(e) => set("outcome", e.target.value as Outcome)}>
              <option value="">Any</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Reason">
            <select className="select" value={filters.reason ?? ""} onChange={(e) => set("reason", e.target.value as ReasonCode)}>
              <option value="">Any</option>
              {(Object.keys(REASONS) as ReasonCode[]).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Product">
            <select className="select" value={filters.product_id ?? ""} onChange={(e) => set("product_id", e.target.value)}>
              <option value="">Any</option>
              {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Customer ref">
            <input className="input" placeholder="cus_…" value={filters.customer_ref ?? ""} onChange={(e) => set("customer_ref", e.target.value.trim())} />
          </Field>
          <Field label="Since">
            <input className="input" type="datetime-local" onChange={(e) => set("since", fromLocalInput(e.target.value))} />
          </Field>
        </div>
        {feed.error ? (
          <div className="card-body"><ErrorNote error={feed.error} /></div>
        ) : feed.loading && !feed.data ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No decisions match">Try clearing a filter.</Empty>
        ) : (
          <>
            <DecisionTable items={items} onOpen={setOpenId} />
            {cursor && (
              <div className="card-body" style={{ textAlign: "center" }}>
                <Button size="sm" loading={more.loading} onClick={() => loadMore()}>Load more</Button>
              </div>
            )}
          </>
        )}
      </Card>
      {openId && <DecisionDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

// ---------- POST /decisions/{id}/approve|reject ----------

export function ReviewQueue() {
  const api = useApi();
  const role = useRole();
  const queue = useQuery(() => api.decisions({ outcome: "review", limit: 100 }), []);
  useStream((e) => (e.type === "decision_created" || e.type === "outcome_recorded") && queue.reload());

  const pending = queue.data?.items.filter((d) => !d.review) ?? [];
  const done = queue.data?.items.filter((d) => d.review) ?? [];
  const allowed = role === "compliance" || role === "campaign_manager";

  return (
    <>
      <ConsoleHead title="Review queue">Credit offers always go to a person before anything is sent.</ConsoleHead>
      <div className="stack">
        {!allowed && (
          <div className="alert alert-info">
            You're acting as {humanize(role)}. Approving needs Compliance or Campaign manager; the API will refuse with 403.
          </div>
        )}
        <ErrorNote error={queue.error} />
        {queue.loading && !queue.data && <Loading />}
        {queue.data && !pending.length && (
          <Card><Empty title="Nothing waiting">Run decisions for an SME owner to create a credit review.</Empty></Card>
        )}
        {pending.map((d) => <ReviewItem key={d.id} decision={d} onDone={queue.reload} />)}
        {done.length > 0 && (
          <Card title="Reviewed" bodyClass="">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Decision</th><th>Customer</th><th>Product</th><th>Result</th><th>Note</th></tr></thead>
                <tbody>
                  {done.map((d) => (
                    <tr key={d.id}>
                      <td><code>{d.id}</code></td>
                      <td><code>{d.customer_ref}</code></td>
                      <td className="small">{d.product_id && humanize(d.product_id)}</td>
                      <td><Badge tone={d.review!.action === "approved" ? "green" : "red"}>{d.review!.action}</Badge> <span className="small muted">by {humanize(d.review!.by)}</span></td>
                      <td className="small muted">{d.review!.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function ReviewItem({ decision, onDone }: { decision: Decision; onDone: () => void }) {
  const api = useApi();
  const [note, setNote] = useState("");
  const [approve, approveState] = useAction(api.approve);
  const [reject, rejectState] = useAction(api.reject);
  const [expanded, setExpanded] = useState(false);
  const error = approveState.error ?? rejectState.error;

  return (
    <Card
      title={<>{decision.product_id && humanize(decision.product_id)} <ReasonChip code="CREDIT_REVIEW" /></>}
      sub={<>For <code>{decision.customer_ref}</code> · {fmtDateTime(decision.as_of)} · via {decision.channel}</>}
      endpoint={["POST /decisions/{id}/approve", "POST /decisions/{id}/reject"]}
      actions={<Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? "Hide trace" : "Show trace"}</Button>}
    >
      <div className="stack">
        {expanded ? <DecisionView decision={decision} /> : decision.message && (
          <div className="msg-preview">
            <div className="t">{decision.message.title}</div>
            <div className="b">{decision.message.body}</div>
          </div>
        )}
        <Field label="Note or reason" hint="A reason is required to reject.">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Affordability checked against inflows" />
        </Field>
        <ErrorNote error={error} />
        <div className="row">
          <Button variant="primary" loading={approveState.loading} onClick={async () => (await approve(decision.id, note || undefined)) && onDone()}>
            Approve and send
          </Button>
          <Button variant="danger" loading={rejectState.loading} onClick={async () => (await reject(decision.id, note)) && onDone()}>
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------- POST /decisions/evaluate and /decisions/batch ----------

export function RunDecisions() {
  const api = useApi();
  const recent = useQuery(() => api.decisions({ limit: 100 }), []);
  const knownRefs = [...new Set(recent.data?.items.map((d) => d.customer_ref) ?? [])];

  const [ref, setRef] = useState("");
  const [mode, setMode] = useState<EvalMode>("dry_run");
  const [asOf, setAsOf] = useState("");
  const [evaluate, one] = useAction(api.evaluate);

  const [ids, setIds] = useState("");
  const [batchMode, setBatchMode] = useState<EvalMode>("dry_run");
  const [batch, many] = useAction(api.batch);
  const [openId, setOpenId] = useState<string | null>(null);
  const parsedIds = ids.split(/[\s,]+/).filter(Boolean);
  const total = many.data ? Object.values(many.data.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <ConsoleHead title="Run decisions">Run the pipeline for one customer, or a segment followed by the governor.</ConsoleHead>
      <div className="stack">
        <Card title="One customer" endpoint="POST /decisions/evaluate">
          <div className="stack">
            <div className="grid-3">
              <Field label="Customer ref">
                <input className="input" list="known-refs" placeholder="cus_…" value={ref} onChange={(e) => setRef(e.target.value.trim())} />
              </Field>
              <Field label="As of" hint="Empty uses the simulator clock.">
                <input className="input" type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </Field>
              <Field label="Mode">
                <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: "dry_run", label: "Dry run" }, { value: "live", label: "Live" }]} />
              </Field>
            </div>
            <datalist id="known-refs">{knownRefs.map((r) => <option key={r} value={r} />)}</datalist>
            <div><Button variant="primary" disabled={!ref} loading={one.loading} onClick={() => evaluate(ref, mode, fromLocalInput(asOf))}>Evaluate</Button></div>
            <ErrorNote error={one.error} />
            {one.data && <DecisionView decision={one.data} />}
          </div>
        </Card>

        <Card title="Batch" sub="Same pipeline over a list of customers. Leave empty to run everyone." endpoint="POST /decisions/batch">
          <div className="stack">
            <Field label="Customer refs" hint={`${parsedIds.length || "All"} customers. Separate with commas or new lines.`}>
              <textarea className="textarea" rows={3} value={ids} onChange={(e) => setIds(e.target.value)} placeholder="cus_8f3a, cus_21bc" />
            </Field>
            <div className="row">
              <Segmented label="Batch mode" value={batchMode} onChange={setBatchMode} options={[{ value: "dry_run", label: "Dry run" }, { value: "live", label: "Live" }]} />
              <Button size="sm" variant="ghost" onClick={() => setIds(knownRefs.join(", "))}>Use recent customers</Button>
              <span className="spacer" />
              <Button variant="primary" loading={many.loading} onClick={() => batch(parsedIds, batchMode)}>Run batch</Button>
            </div>
            <ErrorNote error={many.error} />
            {many.data && (
              <>
                <div className="row">
                  {(Object.entries(many.data.counts) as [Outcome, number][]).map(([o, n]) => (
                    <span key={o} className="row" style={{ gap: 4 }}><OutcomeBadge outcome={o} /> <strong>{n}</strong></span>
                  ))}
                  <span className="small muted">of {total}</span>
                  <span className="spacer" />
                  <Simulated />
                </div>
                <DecisionTable items={many.data.decisions} onOpen={setOpenId} />
              </>
            )}
          </div>
        </Card>
      </div>
      {openId && <DecisionDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
