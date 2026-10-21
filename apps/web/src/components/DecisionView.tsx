import type { ReactNode } from "react";
import { useApi, useTechnical } from "../lib/context";
import { CHANNEL_LABEL, fmtDateTime, fmtDay, humanize } from "../lib/format";
import type { Channel, Decision } from "../lib/types";
import { useQuery } from "../lib/hooks";
import { useProductNames } from "../lib/products";
import { Badge, Drawer, ErrorNote, Loading, OutcomeBadge, ReasonChip, Simulated } from "./ui";

// Check names when Developer view is off (phrased as what was checked, not the failure code)
const CHECK_LABEL: Partial<Record<string, string>> = {
  NO_CONSENT: "Consent to personalised offers",
  OPTED_OUT: "No opt-out or open complaint",
  SENSITIVE_TRIGGER: "Excluded data screened out",
  NO_MATCH: "Suitable product",
  NO_CHANNEL_CONSENT: "Contact channel allowed",
  CAP_30D: "Monthly message limit",
  SAME_PRODUCT_60D: "Not offered recently",
  COOLDOWN_IGNORED: "No recent \"Not now\"",
  CREDIT_REVIEW: "Credit approval",
  LOW_UPLIFT: "Expected benefit",
  ATTENTION_BUDGET: "Attention budget",
  GUARDRAIL_BLOCKED: "Message content check",
  QUIET_HOURS: "Send window",
};

function checkDetail(rule: string, passed: boolean, detail: string): string {
  if (rule === "NO_CONSENT") return passed ? "Given" : "Not given";
  if (rule === "LOW_UPLIFT") return passed ? "Above threshold" : "Below threshold";
  return detail
    .replace(/\b(app|whatsapp|sms|email|ussd)\b/g, (ch) => CHANNEL_LABEL[ch as Channel])
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (day) => fmtDay(`${day}T12:00:00+01:00`));
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A decision with its trace. Plain language by default; raw trace in Developer view. */
export function DecisionView({ decision: d }: { decision: Decision }) {
  const productName = useProductNames();
  const { technical } = useTechnical();
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <OutcomeBadge outcome={d.outcome} />
          {d.reasons.filter((r) => technical || r !== "OK").map((r) => <ReasonChip key={r} code={r} />)}
          {d.review && (
            <Badge tone={d.review.action === "approved" ? "green" : "red"}>
              {d.review.action === "approved" ? "Approved" : "Declined"} by {humanize(d.review.by)}
            </Badge>
          )}
        </div>
        <Simulated />
      </div>

      <dl className="grid-2 small" style={{ margin: 0 }}>
        <Meta label="Customer" value={<code>{d.customer_ref}</code>} />
        <Meta label="Date" value={fmtDateTime(d.as_of)} />
        <Meta label="Product" value={productName(d.product_id) || "—"} />
        <Meta label="Channel" value={d.channel ? CHANNEL_LABEL[d.channel] : "—"} />
        {d.scheduled_for && <Meta label="Scheduled for" value={fmtDateTime(d.scheduled_for)} />}
        {technical && (
          <>
            <Meta label="Decision" value={<code>{d.id}</code>} />
            <Meta label="Mode" value={<code>{d.mode}</code>} />
            <Meta label="Policy" value={<code>{d.trace.policy_version}</code>} />
            <Meta label="Model" value={<code>{d.trace.model_version}</code>} />
          </>
        )}
      </dl>

      {d.message && (
        <div className="msg-preview">
          <div className="t">{d.message.title}</div>
          <div className="b">{d.message.body}</div>
          <div className="w">Why: {d.message.why}</div>
        </div>
      )}
      {d.review?.note && <p className="small muted">Reviewer note: {d.review.note}</p>}

      <TraceSection title={technical ? "Triggers" : "Signals"}>
        {d.trace.triggers.length === 0 ? (
          <p className="muted small">None</p>
        ) : (
          d.trace.triggers.map((t) => (
            <div key={t.type} className="row small" style={{ padding: "4px 0" }}>
              {technical && <code>{t.type}</code>}
              <span className={technical ? "muted" : ""}>{technical ? t.evidence : sentence(t.evidence)}</span>
              {t.blocked && <Badge tone="red">{technical ? `blocked: ${t.category}` : "Not used"}</Badge>}
            </div>
          ))
        )}
      </TraceSection>

      {d.trace.candidates.length > 0 && (
        <TraceSection title={technical ? "Candidates" : "Products considered"}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  {technical && <th>Eligible</th>}
                  {technical && <th className="num">Uplift</th>}
                  <th>{technical ? "Dropped" : "Result"}</th>
                </tr>
              </thead>
              <tbody>
                {d.trace.candidates.map((c) => (
                  <tr key={c.product_id}>
                    <td>{productName(c.product_id)}</td>
                    {technical && <td>{c.eligible ? "yes" : "no"}</td>}
                    {technical && <td className="num">{c.uplift.toFixed(3)}</td>}
                    <td>{c.dropped ? <ReasonChip code={c.dropped} /> : c.product_id === d.product_id ? <Badge tone="green">Chosen</Badge> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TraceSection>
      )}

      {technical && d.trace.steps && d.trace.steps.length > 0 && (
        <TraceSection title="Pipeline steps">
          {d.trace.steps.map((s) => (
            <div key={s.step} className="rule small">
              <span className={s.status === "ok" ? "rule-ok" : "rule-fail"} aria-label={s.status}>
                {s.status === "ok" ? "✓" : "■"}
              </span>
              <code>{s.step}. {s.name}</code>
              <span className="muted">
                {s.reason !== "OK" && <code>{s.reason}</code>} {s.detail}
              </span>
            </div>
          ))}
        </TraceSection>
      )}

      <TraceSection title={technical ? "Rules" : "Checks"}>
        {d.trace.rules.map((r, i) => (
          <div key={i} className="rule small">
            <span className={r.passed ? "rule-ok" : "rule-fail"} aria-label={r.passed ? "passed" : "failed"}>
              {r.passed ? "✓" : "✕"}
            </span>
            {technical ? <code>{r.rule}</code> : <span>{CHECK_LABEL[r.rule] ?? humanize(r.rule)}</span>}
            <span className="muted">{technical ? r.detail : checkDetail(r.rule, r.passed, r.detail)}</span>
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
  const { technical } = useTechnical();
  const d = useQuery(() => api.decision(id), [id]);
  return (
    <Drawer title={technical ? "Decision trace" : "Decision"} onClose={onClose}>
      {d.data ? <DecisionView decision={d.data} /> : d.error ? <ErrorNote error={d.error} /> : <Loading />}
    </Drawer>
  );
}
