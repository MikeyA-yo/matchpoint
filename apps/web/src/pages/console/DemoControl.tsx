import { useState } from "react";
import { EventFeed } from "../../components/EventFeed";
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Simulated } from "../../components/ui";
import { useApi } from "../../lib/context";
import { fmtDateTime, humanize } from "../../lib/format";
import { useAction, useEventLog, useQuery } from "../../lib/hooks";
import { PATTERNS, STREAM_EVENTS, type Pattern, type SimConfig, type StreamEventType } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

// ---------- /sim/* ----------

export function Simulator() {
  const api = useApi();
  const state = useQuery(() => api.simState(), []);
  const [config, setConfig] = useState<SimConfig>({ seed: 42, n_customers: 5000, days: 120, scenario: "baseline" });
  const [start, startState] = useAction(api.simStart);
  const [reset, resetState] = useAction(api.simReset);
  const [pattern, setPattern] = useState<Pattern>("fee_season");
  const [target, setTarget] = useState("");
  const [inject, injectState] = useAction(api.simInject);
  const s = state.data;

  return (
    <>
      <ConsoleHead title="Simulator">Simulated clock and synthetic customers. Same seed, same population, same result.</ConsoleHead>
      <div className="stack">
        <Card title="State" endpoint="GET /sim/state" actions={<><Simulated /><Button size="sm" variant="ghost" onClick={state.reload}>Refresh</Button></>}>
          <ErrorNote error={state.error} />
          {s ? (
            <div className="grid-4 small">
              <div><div className="faint">Status</div>{s.running ? <Badge tone="green">running</Badge> : <Badge tone="amber">stopped</Badge>}</div>
              <div><div className="faint">Clock</div>{fmtDateTime(s.clock)}</div>
              <div><div className="faint">Seed · scenario</div>{s.seed} · {s.scenario}</div>
              <div><div className="faint">Population</div>{s.n_customers.toLocaleString()} customers, {s.days} days</div>
            </div>
          ) : (
            state.loading && <Loading />
          )}
        </Card>

        <Card title="Start" endpoint="POST /sim/start">
          <div className="stack">
            <div className="grid-4">
              <Field label="Seed"><input className="input" type="number" value={config.seed} onChange={(e) => setConfig({ ...config, seed: Number(e.target.value) })} /></Field>
              <Field label="Customers"><input className="input" type="number" min={1} value={config.n_customers} onChange={(e) => setConfig({ ...config, n_customers: Number(e.target.value) })} /></Field>
              <Field label="Days"><input className="input" type="number" min={1} max={365} value={config.days} onChange={(e) => setConfig({ ...config, days: Number(e.target.value) })} /></Field>
              <Field label="Scenario">
                <select className="select" value={config.scenario} onChange={(e) => setConfig({ ...config, scenario: e.target.value })}>
                  <option value="baseline">baseline</option>
                  <option value="fee_season_peak">fee_season_peak</option>
                  <option value="sme_boom">sme_boom</option>
                </select>
              </Field>
            </div>
            <ErrorNote error={startState.error} />
            <div className="row">
              <Button variant="primary" loading={startState.loading} onClick={async () => (await start(config)) && state.reload()}>Start simulation</Button>
            </div>
          </div>
        </Card>

        <Card title="Inject a pattern" sub="Plant a pattern on demand, for one customer or across the population." endpoint="POST /sim/inject">
          <div className="stack">
            <div className="grid-3">
              <Field label="Pattern">
                <select className="select" value={pattern} onChange={(e) => setPattern(e.target.value as Pattern)}>
                  {PATTERNS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </select>
              </Field>
              <Field label="Customer ref" hint="Optional. Empty applies to a share of the population.">
                <input className="input" placeholder="cus_…" value={target} onChange={(e) => setTarget(e.target.value.trim())} />
              </Field>
            </div>
            <ErrorNote error={injectState.error} />
            <div className="row">
              <Button loading={injectState.loading} onClick={() => inject(pattern, target || undefined)}>Inject</Button>
              {injectState.data && <span className="small green">Planted {humanize(injectState.data.pattern).toLowerCase()} for {injectState.data.affected.toLocaleString()} customer(s).</span>}
            </div>
          </div>
        </Card>

        <Card title="Reset" sub="Clears decisions, messages and experiments and stops the clock. Demo accounts are kept." endpoint="POST /sim/reset">
          <ErrorNote error={resetState.error} />
          <Button
            variant="danger"
            loading={resetState.loading}
            onClick={async () => {
              if (window.confirm("Reset the simulation? Decisions, messages and experiments will be cleared.")) {
                if (await reset()) state.reload();
              }
            }}
          >
            Reset simulation
          </Button>
        </Card>
      </div>
    </>
  );
}

// ---------- GET /stream ----------

export function Events() {
  const [types, setTypes] = useState<StreamEventType[]>(STREAM_EVENTS);
  const [events, clear] = useEventLog((e) => types.includes(e.type), 100);
  const toggle = (t: StreamEventType) => setTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  return (
    <>
      <ConsoleHead title="Live events">Server-sent events from every part of the pipeline. Keep this open next to the phone view.</ConsoleHead>
      <Card
        title={<><span className="live-dot" aria-hidden /> Stream</>}
        endpoint="GET /stream"
        actions={<Button size="sm" variant="ghost" onClick={clear}>Clear</Button>}
      >
        <div className="row" style={{ marginBottom: 12, gap: 14 }}>
          {STREAM_EVENTS.map((t) => (
            <label key={t} className="checkbox small">
              <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} />
              <code>{t}</code>
            </label>
          ))}
        </div>
        <EventFeed events={events} emptyHint="Open the customer view in another tab and run a decision." />
      </Card>
    </>
  );
}

// ---------- GET /audit/log, GET /audit/export ----------

export function Audit() {
  const api = useApi();
  const log = useQuery(() => api.auditLog(), []);
  const [exportLog, exportState] = useAction(api.auditExport);

  const download = async () => {
    const data = await exportLog();
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `matchpoint-audit-${data.exported_at.slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <ConsoleHead title="Audit log">The decision log, consent ledger and policy history, joined. All append-only.</ConsoleHead>
      <Card
        title={<>Entries <Badge tone="amber">stub</Badge></>}
        sub="Marked X (stub) in the API guideline."
        endpoint={["GET /audit/log", "GET /audit/export"]}
        actions={<Button size="sm" loading={exportState.loading} onClick={download}>Export JSON</Button>}
        bodyClass=""
      >
        <ErrorNote error={log.error ?? exportState.error} />
        {log.loading && !log.data ? (
          <Loading />
        ) : !log.data?.items.length ? (
          <Empty title="No entries" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Kind</th><th>Ref</th><th>Summary</th></tr></thead>
              <tbody>
                {log.data.items.map((e, i) => (
                  <tr key={`${e.ref}-${i}`}>
                    <td className="small">{fmtDateTime(e.at)}</td>
                    <td><Badge tone={e.kind === "consent" ? "amber" : e.kind === "policy" ? "blue" : "grey"}>{e.kind}</Badge></td>
                    <td><code>{e.ref}</code></td>
                    <td className="small muted">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
