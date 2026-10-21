import { Button, Card, Endpoint, ErrorNote, Loading, Simulated, Stat } from "../../components/ui";
import { useApi } from "../../lib/context";
import { CHANNEL_LABEL, fmtNum, fmtPct } from "../../lib/format";
import { useQuery, useStream } from "../../lib/hooks";
import { OUTCOME_LABEL } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

export function Overview() {
  const api = useApi();
  const overview = useQuery(() => api.metricsOverview(), []);
  const byChannel = useQuery(() => api.metricsByChannel(), []);

  useStream((e) => {
    if (e.type === "decision_created" || e.type === "message_delivered" || e.type === "consent_changed") {
      overview.reload();
      byChannel.reload();
    }
  });

  const o = overview.data;
  const total = o ? o.sent + o.held + o.silent + o.review : 0;
  const share = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  const uptake = o?.product_uptake;
  const control = o?.control_group_uptake;

  return (
    <>
      <ConsoleHead title="Overview">{o?.window_days ? `Last ${o.window_days} days` : null}</ConsoleHead>
      <div className="stack">
        <ErrorNote error={overview.error} />
        {o ? (
          <>
            <div className="row-between">
              <Endpoint value="GET /metrics/overview" />
              <span className="spacer" />
              <Simulated />
            </div>
            {o.notifications_sent !== undefined && (
              <div className="grid-4">
                <Stat label="Notifications sent" value={fmtNum(o.notifications_sent)} />
                <Stat label="Click rate" value={fmtPct(o.click_rate ?? 0)} hint="Opened after delivery" />
                <Stat
                  label="Product uptake"
                  value={fmtPct(uptake ?? 0)}
                  hint={control !== undefined ? `Control group ${fmtPct(control)}` : undefined}
                />
                <Stat label="Opt-outs" value={fmtNum(o.opt_outs)} hint={`${fmtPct(o.opt_outs / (o.sent || 1), 2)} of messages sent`} />
              </div>
            )}
            <div className="grid-4">
              <Stat label="Decisions" value={fmtNum(total)} />
              <Stat label="Held back" value={fmtNum(o.held + o.silent)} hint={`${fmtNum(o.held)} held · ${fmtNum(o.silent)} not contacted`} />
              <Stat label="In review" value={fmtNum(o.review)} hint="Awaiting staff approval" />
              <Stat label="Sustained use at 60 days" value={fmtPct(o.sustained_use_60d, 0)} hint="Accepted offers still in use" />
            </div>
            <Card title="Outcome mix">
              <div className="bar" aria-label="Outcome mix">
                <span style={{ width: share(o.sent), background: "var(--green)" }} />
                <span style={{ width: share(o.review), background: "var(--blue)" }} />
                <span style={{ width: share(o.held), background: "var(--amber)" }} />
                <span style={{ width: share(o.silent), background: "var(--border-strong)" }} />
              </div>
              <div className="row small muted" style={{ marginTop: 10, gap: 16 }}>
                <span><span className="green">■</span> {OUTCOME_LABEL.send} {fmtNum(o.sent)}</span>
                <span><span style={{ color: "var(--blue)" }}>■</span> {OUTCOME_LABEL.review} {fmtNum(o.review)}</span>
                <span><span style={{ color: "var(--amber)" }}>■</span> {OUTCOME_LABEL.hold} {fmtNum(o.held)}</span>
                <span><span className="faint">■</span> {OUTCOME_LABEL.silent} {fmtNum(o.silent)}</span>
              </div>
            </Card>
          </>
        ) : (
          overview.loading && <Loading />
        )}

        <Card
          title="By channel"
          endpoint="GET /metrics/by-channel"
          actions={<><Simulated /><Button size="sm" variant="ghost" onClick={byChannel.reload}>Refresh</Button></>}
          bodyClass=""
        >
          <ErrorNote error={byChannel.error} />
          {byChannel.data ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="num">Sent</th>
                    <th className="num">Click rate</th>
                    <th className="num">Product uptake</th>
                  </tr>
                </thead>
                <tbody>
                  {byChannel.data.channels.map((c) => (
                    <tr key={c.channel}>
                      <td>{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                      <td className="num">{fmtNum(c.sent)}</td>
                      <td className="num">{c.sent ? fmtPct(c.click_rate) : "—"}</td>
                      <td className="num">{c.sent ? fmtPct(c.product_uptake) : "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="num"><strong>{fmtNum(byChannel.data.total.sent)}</strong></td>
                    <td className="num"><strong>{fmtPct(byChannel.data.total.click_rate)}</strong></td>
                    <td className="num"><strong>{fmtPct(byChannel.data.total.product_uptake)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            byChannel.loading && <Loading />
          )}
        </Card>
      </div>
    </>
  );
}
