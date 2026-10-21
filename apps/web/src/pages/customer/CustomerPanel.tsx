import { Card, Empty, ErrorNote, Loading } from "../../components/ui";
import { useApi } from "../../lib/context";
import { describeDecision, type PlainDecision } from "../../lib/describe";
import { CHANNEL_LABEL, fmtDay } from "../../lib/format";
import { useQuery, useStream } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { CONTACT_CHANNELS, type Customer, type Decision } from "../../lib/types";

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
