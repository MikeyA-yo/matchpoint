import { useState } from "react";
import { DecisionDrawer, DecisionView } from "../../components/DecisionView";
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, OutcomeBadge, ReasonChip, Segmented, Simulated } from "../../components/ui";
import { useApi, useRole, useTechnical } from "../../lib/context";
import { CHANNEL_LABEL, fmtDateTime, fromLocalInput, humanize, toLocalInput } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { OUTCOME_LABEL, REASON_LABEL, REASONS, type Decision, type DecisionFilters, type EvalMode, type Outcome, type ReasonCode } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

const OUTCOMES: Outcome[] = ["send", "hold", "silent", "review"];

function DecisionTable({ items, onOpen }: { items: Decision[]; onOpen: (id: string) => void }) {
  const productName = useProductNames();
  return (
    <div className="table-wrap">
      <table className="table table-cards decision-cards">
        <thead>
          <tr><th>As of</th><th>Customer</th><th>Outcome</th><th>Reasons</th><th>Product</th><th>Channel</th></tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
              <td data-label="As of" className="small">{fmtDateTime(d.as_of)}</td>
              <td data-label="Customer"><code>{d.customer_ref}</code></td>
              <td data-label="Outcome"><OutcomeBadge outcome={d.outcome} /></td>
              <td data-label="Reasons"><div className="row">{d.reasons.map((r) => <ReasonChip key={r} code={r} />)}</div></td>
              <td data-label="Product" className="small">{productName(d.product_id) || "—"}</td>
              <td data-label="Channel" className="small">{d.channel ? CHANNEL_LABEL[d.channel] : "—"}</td>
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
  const { technical } = useTechnical();
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
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <ConsoleHead title="Decision log" />
      <Card endpoint={["GET /decisions", "GET /decisions/{id}"]} bodyClass="">
        <div className="filter-bar">
          <select className="select input-sm" aria-label="Outcome" value={filters.outcome ?? ""} onChange={(e) => set("outcome", e.target.value as Outcome)}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{technical ? o : OUTCOME_LABEL[o]}</option>)}
          </select>
          <select className="select input-sm" aria-label="Reason" value={filters.reason ?? ""} onChange={(e) => set("reason", e.target.value as ReasonCode)}>
            <option value="">All reasons</option>
            {(Object.keys(REASONS) as ReasonCode[]).map((r) => <option key={r} value={r}>{technical ? r : REASON_LABEL[r]}</option>)}
          </select>
          <select className="select input-sm" aria-label="Product" value={filters.product_id ?? ""} onChange={(e) => set("product_id", e.target.value)}>
            <option value="">All products</option>
            {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input input-sm" aria-label="Customer ref" placeholder="Customer ref" value={filters.customer_ref ?? ""} onChange={(e) => set("customer_ref", e.target.value.trim())} />
          <input className="input input-sm" aria-label="Since" type="datetime-local" value={toLocalInput(filters.since)} onChange={(e) => set("since", fromLocalInput(e.target.value))} />
          {filtered && <Button size="sm" variant="ghost" onClick={() => setFilters({})}>Clear</Button>}
          <span className="spacer" />
          <Simulated />
          <Button size="sm" variant="ghost" onClick={feed.reload}>Refresh</Button>
        </div>
        {feed.error ? (
          <div className="card-body"><ErrorNote error={feed.error} /></div>
        ) : feed.loading && !feed.data ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No decisions match these filters" />
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
  const productName = useProductNames();
  const queue = useQuery(() => api.decisions({ outcome: "review", limit: 100 }), []);
  useStream((e) => (e.type === "decision_created" || e.type === "outcome_recorded") && queue.reload());

  const pending = queue.data?.items.filter((d) => !d.review) ?? [];
  const done = queue.data?.items.filter((d) => d.review) ?? [];
  const allowed = role === "compliance" || role === "campaign_manager";

  return (
    <>
      <ConsoleHead title="Review queue">{queue.data ? `${pending.length} pending` : null}</ConsoleHead>
      <div className="stack">
        {!allowed && (
          <div className="alert alert-info">
            {humanize(role)} can't approve credit offers. Switch role to Compliance or Campaign manager.
          </div>
        )}
        <ErrorNote error={queue.error} />
        <Card endpoint={["POST /decisions/{id}/approve", "POST /decisions/{id}/reject"]} bodyClass="">
          {queue.loading && !queue.data ? (
            <Loading />
          ) : !pending.length ? (
            <Empty title="Nothing to review" />
          ) : (
            pending.map((d) => <ReviewRow key={d.id} decision={d} onDone={queue.reload} />)
          )}
        </Card>
        {done.length > 0 && (
          <Card title="Reviewed" bodyClass="">
            <div className="table-wrap">
              <table className="table table-cards">
                <thead><tr><th>Customer</th><th>Product</th><th>Result</th><th>By</th><th>Note</th></tr></thead>
                <tbody>
                  {done.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Customer"><code>{d.customer_ref}</code></td>
                      <td data-label="Product" className="small">{productName(d.product_id)}</td>
                      <td data-label="Result"><Badge tone={d.review!.action === "approved" ? "green" : "red"}>{d.review!.action === "approved" ? "Approved" : "Declined"}</Badge></td>
                      <td data-label="By" className="small muted">{humanize(d.review!.by)}</td>
                      <td data-label="Note" className="small muted">{d.review!.note || "—"}</td>
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

function ReviewRow({ decision: d, onDone }: { decision: Decision; onDone: () => void }) {
  const api = useApi();
  const { technical } = useTechnical();
  const productName = useProductNames();
  const [open, setOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [approve, approveState] = useAction(api.approve);
  const [reject, rejectState] = useAction(api.reject);
  const busy = approveState.loading || rejectState.loading;

  return (
    <div className="queue-row">
      <div className="queue-main">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <strong>{productName(d.product_id)}</strong>
            <Badge tone="blue">Credit</Badge>
          </div>
          <div className="small muted">
            <code>{d.customer_ref}</code> · {fmtDateTime(d.as_of)} · {d.channel ? CHANNEL_LABEL[d.channel] : "—"}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Preview"}</Button>
          <Button size="sm" variant="primary" loading={approveState.loading} disabled={busy} onClick={async () => (await approve(d.id)) && onDone()}>
            Approve
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeclining(true)}>Decline</Button>
        </div>
      </div>

      {declining && (
        <form
          className="row"
          style={{ marginTop: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await reject(d.id, reason)) onDone();
          }}
        >
          <input className="input input-sm" style={{ flex: 1, minWidth: 200 }} placeholder="Reason for declining" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <Button type="submit" size="sm" variant="danger" loading={rejectState.loading} disabled={!reason.trim()}>Confirm decline</Button>
          <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button>
        </form>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          {technical ? <DecisionView decision={d} /> : d.message && (
            <div className="msg-preview">
              <div className="t">{d.message.title}</div>
              <div className="b">{d.message.body}</div>
            </div>
          )}
        </div>
      )}
      {(approveState.error || rejectState.error) && (
        <div style={{ marginTop: 10 }}><ErrorNote error={approveState.error ?? rejectState.error} /></div>
      )}
    </div>
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
      <ConsoleHead title="Run decisions" />
      <div className="stack">
        <Card title="Single customer" endpoint="POST /decisions/evaluate">
          <div className="stack">
            <div className="grid-3">
              <Field label="Customer ref">
                <input className="input" list="known-refs" placeholder="cus_…" value={ref} onChange={(e) => setRef(e.target.value.trim())} />
              </Field>
              <Field label="As of" hint="Defaults to the simulator clock.">
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

        <Card title="Batch" endpoint="POST /decisions/batch">
          <div className="stack">
            <Field label="Customer refs" hint={parsedIds.length ? `${parsedIds.length} customers` : "Leave empty to run all customers."}>
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
