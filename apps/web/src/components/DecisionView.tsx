import type { ReactNode } from "react";
import { fmtDateTime, humanize } from "../lib/format";
import type { Decision } from "../lib/types";
import { useApi } from "../lib/context";
import { useQuery } from "../lib/hooks";
import { Badge, Drawer, ErrorNote, Loading, OutcomeBadge, ReasonChip, Simulated } from "./ui";

/** Full decision with its trace (GET /decisions/{id} shape). */
export function DecisionView({ decision: d }: { decision: Decision }) {
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <OutcomeBadge outcome={d.outcome} />
          {d.reasons.map((r) => <ReasonChip key={r} code={r} />)}
          {d.review && (
            <Badge tone={d.review.action === "approved" ? "green" : "red"}>
              {d.review.action} by {humanize(d.review.by)}
            </Badge>
          )}
        </div>
        <Simulated />
      </div>

      <dl className="grid-2 small" style={{ margin: 0 }}>
        <Meta label="Decision" value={<code>{d.id}</code>} />
        <Meta label="Customer" value={<code>{d.customer_ref}</code>} />
        <Meta label="As of" value={fmtDateTime(d.as_of)} />
        <Meta label="Product" value={d.product_id ? humanize(d.product_id) : "—"} />
        <Meta label="Channel" value={d.channel ?? "—"} />
        <Meta label="Scheduled for" value={d.scheduled_for ? fmtDateTime(d.scheduled_for) : "Now"} />
        <Meta label="Policy" value={<code>{d.trace.policy_version}</code>} />
        <Meta label="Model" value={<code>{d.trace.model_version}</code>} />
      </dl>

      {d.message && (
        <div className="msg-preview">
          <div className="t">{d.message.title}</div>
          <div className="b">{d.message.body}</div>
          <div className="w">Why: {d.message.why}</div>
        </div>
      )}
      {d.review?.note && <p className="small muted">Reviewer note: {d.review.note}</p>}

      <TraceSection title="Triggers">
        {d.trace.triggers.length === 0 ? (
          <p className="muted small">None read.</p>
        ) : (
          d.trace.triggers.map((t) => (
            <div key={t.type} className="row small" style={{ padding: "4px 0" }}>
              <code>{t.type}</code>
              <span className="muted">{t.evidence}</span>
              {t.blocked && <Badge tone="red">blocked: {t.category}</Badge>}
            </div>
          ))
        )}
      </TraceSection>

      {d.trace.candidates.length > 0 && (
        <TraceSection title="Candidates">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Product</th><th>Eligible</th><th className="num">Uplift</th><th>Dropped</th></tr>
              </thead>
              <tbody>
                {d.trace.candidates.map((c) => (
                  <tr key={c.product_id}>
                    <td>{humanize(c.product_id)}</td>
                    <td>{c.eligible ? "yes" : "no"}</td>
                    <td className="num">{c.uplift.toFixed(3)}</td>
                    <td>{c.dropped ? <ReasonChip code={c.dropped} /> : c.product_id === d.product_id ? <Badge tone="green">chosen</Badge> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TraceSection>
      )}

      <TraceSection title="Rules">
        {d.trace.rules.map((r, i) => (
          <div key={i} className="rule small">
            <span className={r.passed ? "rule-ok" : "rule-fail"} aria-label={r.passed ? "passed" : "failed"}>
              {r.passed ? "✓" : "✕"}
            </span>
            <code>{r.rule}</code>
            <span className="muted">{r.detail}</span>
          </div>
        ))}
      </TraceSection>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="faint">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

function TraceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function DecisionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApi();
  const d = useQuery(() => api.decision(id), [id]);
  return (
    <Drawer title="Decision trace" onClose={onClose}>
      {d.data ? <DecisionView decision={d.data} /> : d.error ? <ErrorNote error={d.error} /> : <Loading />}
    </Drawer>
  );
}
