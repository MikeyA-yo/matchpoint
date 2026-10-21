import { Button, Card, ErrorNote, Loading, Simulated, Stat } from "../../components/ui";
import { useApi } from "../../lib/context";
import { fmtNum, fmtPct } from "../../lib/format";
import { useQuery, useStream } from "../../lib/hooks";
import { ConsoleHead } from "./ConsolePage";

export function Overview() {
  const api = useApi();
  const overview = useQuery(() => api.metricsOverview(), []);
  const byProduct = useQuery(() => api.metricsByProduct(), []);

  useStream((e) => {
    if (e.type === "decision_created" || e.type === "consent_changed") {
      overview.reload();
      byProduct.reload();
    }
  });

  const o = overview.data;
  const total = o ? o.sent + o.held + o.silent + o.review : 0;
  const share = (n: number) => (total ? `${(n / total) * 100}%` : "0%");

  return (
    <>
      <ConsoleHead title="Metrics">How much MATCHPOINT sent, how much it held back, and whether it worked.</ConsoleHead>
      <div className="stack">
        <ErrorNote error={overview.error} />
        {o ? (
          <>
            <div className="row-between">
              <span className="endpoint"><b>GET</b> /metrics/overview</span>
              <Simulated />
            </div>
            <div className="grid-3">
              <Stat label="Sent" value={fmtNum(o.sent)} hint={`${fmtPct(o.sent / (total || 1))} of decisions`} />
              <Stat label="Held back" value={fmtNum(o.held + o.silent)} hint={`${fmtNum(o.held)} held, ${fmtNum(o.silent)} silent`} />
              <Stat label="In review" value={fmtNum(o.review)} hint="Credit offers waiting for a person" />
              <Stat label="Opt-outs" value={fmtNum(o.opt_outs)} hint={`${fmtPct(o.opt_outs / (o.sent || 1), 2)} of messages sent`} />
              <Stat label="Sustained use at 60 days" value={fmtPct(o.sustained_use_60d, 0)} hint="Of accepted offers, still in use" />
              <Stat label="Decisions" value={fmtNum(total)} hint="Across the simulated population" />
            </div>
            <Card title="Outcome mix">
              <div className="bar" aria-label="Outcome mix">
                <span style={{ width: share(o.sent), background: "var(--green)" }} />
                <span style={{ width: share(o.review), background: "var(--blue)" }} />
                <span style={{ width: share(o.held), background: "var(--amber)" }} />
                <span style={{ width: share(o.silent), background: "var(--border-strong)" }} />
              </div>
              <div className="row small muted" style={{ marginTop: 10, gap: 16 }}>
                <span><span className="green">■</span> send</span>
                <span><span style={{ color: "var(--blue)" }}>■</span> review</span>
                <span><span style={{ color: "var(--amber)" }}>■</span> hold</span>
                <span><span className="faint">■</span> silent</span>
              </div>
            </Card>
          </>
        ) : (
          overview.loading && <Loading />
        )}

        <Card
          title="By product"
          endpoint="GET /metrics/by-product"
          actions={<><Simulated /><Button size="sm" variant="ghost" onClick={byProduct.reload}>Refresh</Button></>}
          bodyClass=""
        >
          <ErrorNote error={byProduct.error} />
          {byProduct.data ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Sent</th>
                    <th className="num">Held</th>
                    <th className="num">Opt-outs</th>
                    <th className="num">Sustained 60d</th>
                  </tr>
                </thead>
                <tbody>
                  {byProduct.data.items.map((p) => (
                    <tr key={p.product_id}>
                      <td>{p.name}<div className="small faint mono">{p.product_id}</div></td>
                      <td className="num">{fmtNum(p.sent)}</td>
                      <td className="num">{fmtNum(p.held)}</td>
                      <td className="num">{fmtNum(p.opt_outs)}</td>
                      <td className="num">{fmtPct(p.sustained_use_60d, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            byProduct.loading && <Loading />
          )}
        </Card>
      </div>
    </>
  );
}
