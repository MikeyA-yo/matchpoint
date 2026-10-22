import { useState } from "react";
import { EVENT_LABEL, EventFeed } from "../../components/EventFeed";
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Simulated } from "../../components/ui";
import { useApi, useTechnical } from "../../lib/context";
import { fmtDateTime, humanize } from "../../lib/format";
import { useAction, useEventLog, useQuery } from "../../lib/hooks";
import { getMode } from "../../lib/mode";
import {
  KEYS,
  clearDemoData,
  deleteRestorePoint,
  demoDataKeys,
  listRestorePoints,
  restoreTo,
  save,
  saveRestorePoint,
  sizeOf,
  type RestorePoint,
} from "../../lib/storage";
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
      <ConsoleHead title="Simulator" />
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
                  <option value="baseline">Baseline</option>
                  <option value="fee_season_peak">School fee season</option>
                  <option value="sme_boom">Small business growth</option>
                </select>
              </Field>
            </div>
            <ErrorNote error={startState.error} />
            <div className="row">
              <Button variant="primary" loading={startState.loading} onClick={async () => (await start(config)) && state.reload()}>Start simulation</Button>
            </div>
          </div>
        </Card>

        <Card title="Inject pattern" endpoint="POST /sim/inject">
          <div className="stack">
            <div className="grid-3">
              <Field label="Pattern">
                <select className="select" value={pattern} onChange={(e) => setPattern(e.target.value as Pattern)}>
                  {PATTERNS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </select>
              </Field>
              <Field label="Customer ref" hint="Optional. Leave empty to apply across the population.">
                <input className="input" placeholder="cus_…" value={target} onChange={(e) => setTarget(e.target.value.trim())} />
              </Field>
            </div>
            <ErrorNote error={injectState.error} />
            <div className="row">
              <Button loading={injectState.loading} onClick={() => inject(pattern, target || undefined)}>Inject</Button>
              {injectState.data && <span className="small ok-text">✓ Planted {humanize(injectState.data.pattern).toLowerCase()} for {injectState.data.affected.toLocaleString()} customer(s).</span>}
            </div>
          </div>
        </Card>

        <Card title="Reset" sub="Clears decisions, messages and experiments. Accounts are kept." endpoint="POST /sim/reset">
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

// ---------- Demo data in this browser: restore points and reset ----------

const START_CONFIG: SimConfig = { seed: 42, n_customers: 5000, days: 120, scenario: "baseline" };

export function DemoData() {
  const api = useApi();
  const live = getMode() === "live";
  const [points, setPoints] = useState<RestorePoint[]>(listRestorePoints);
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const current = Object.fromEntries(demoDataKeys().map((k) => [k, localStorage.getItem(k) ?? ""]));

  const snapshot = (label: string): boolean => {
    try {
      saveRestorePoint(label);
      setPoints(listRestorePoints());
      return true;
    } catch {
      setNote({ ok: false, text: "Browser storage is full. Delete a restore point and try again." });
      return false;
    }
  };

  const restore = (p: RestorePoint) => {
    if (!window.confirm(`Restore "${p.name}"? The current demo data in this browser will be replaced.`)) return;
    restoreTo(p);
    window.location.reload();
  };

  const resetAll = async () => {
    const message = [
      "Reset all demo data?",
      "The demo customers stay, with their original balances and history. Offers, messages, added transactions, consent and rewards changes, sandbox dates and sign-up accounts are cleared.",
      live ? "The API simulation restarts too." : "",
      "You'll be signed out of the customer app. A restore point is saved first.",
    ].filter(Boolean).join("\n\n");
    if (!window.confirm(message)) return;
    setResetting(true);
    snapshot(`Before reset · ${fmtDateTime(new Date().toISOString())}`);
    if (live) {
      try {
        await api.simStart(START_CONFIG);
      } catch (e) {
        setResetting(false);
        setNote({ ok: false, text: `The API simulation wasn't reset: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
    }
    clearDemoData();
    save(KEYS.session, null);
    window.location.reload();
  };

  return (
    <>
      <ConsoleHead title="Demo data" />
      <div className="stack">
        <Card title="Restore points" sub={live ? "Restore points cover this browser's data, not the API's." : undefined}>
          <div className="stack">
            <div className="row">
              <input
                className="input"
                style={{ flex: "1 1 220px", maxWidth: 360 }}
                placeholder={`Restore point ${points.length + 1}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Restore point name"
              />
              <Button
                variant="primary"
                onClick={() => {
                  setNote(null);
                  if (snapshot(name.trim() || `Restore point ${points.length + 1}`)) {
                    setName("");
                    setNote({ ok: true, text: "Saved." });
                  }
                }}
              >
                Save restore point
              </Button>
              <span className="small faint">Current data {sizeOf(current)}</span>
            </div>
            {note && (note.ok ? <span className="small ok-text">✓ {note.text}</span> : <div className="alert alert-error" role="alert">{note.text}</div>)}
          </div>
        </Card>

        <Card title="Saved" actions={points.length > 0 && <span className="small faint">{points.length}</span>} bodyClass="">
          {!points.length ? (
            <Empty title="No restore points" />
          ) : (
            <div className="table-wrap">
              <table className="table table-cards">
                <thead><tr><th>Name</th><th>Saved</th><th className="num">Size</th><th /></tr></thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Name"><strong>{p.name}</strong></td>
                      <td data-label="Saved" className="small muted">{fmtDateTime(p.saved_at)}</td>
                      <td data-label="Size" className="num small muted">{sizeOf(p.data)}</td>
                      <td data-label="">
                        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <Button size="sm" onClick={() => restore(p)}>Restore</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (!window.confirm(`Delete "${p.name}"?`)) return;
                              deleteRestorePoint(p.id);
                              setPoints(listRestorePoints());
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Reset" endpoint={live ? "POST /sim/start" : undefined}>
          <div className="row">
            <Button variant="danger" loading={resetting} onClick={resetAll}>Reset all demo data</Button>
            <span className="small faint">Saves a restore point first.</span>
          </div>
        </Card>
      </div>
    </>
  );
}

// ---------- GET /stream ----------

export function Events() {
  const { technical } = useTechnical();
  const [types, setTypes] = useState<StreamEventType[]>(STREAM_EVENTS);
  const [events, clear] = useEventLog((e) => types.includes(e.type), 100);
  const toggle = (t: StreamEventType) => setTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  return (
    <>
      <ConsoleHead title="Event stream" />
      <Card
        title={<><span className="live-dot" aria-hidden /> Stream</>}
        endpoint="GET /stream"
        actions={<Button size="sm" variant="ghost" onClick={clear}>Clear</Button>}
      >
        <div className="row" style={{ marginBottom: 12, gap: 14 }}>
          {STREAM_EVENTS.map((t) => (
            <label key={t} className="checkbox small">
              <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} />
              {technical ? <code>{t}</code> : EVENT_LABEL[t]}
            </label>
          ))}
        </div>
        <EventFeed events={events} emptyHint="Events appear here as they happen." />
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
      <ConsoleHead title="Audit log" />
      <Card
        title={<>Entries <Badge tone="amber">stub</Badge></>}
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
            <table className="table table-cards">
              <thead><tr><th>When</th><th>Kind</th><th>Ref</th><th>Summary</th></tr></thead>
              <tbody>
                {log.data.items.map((e, i) => (
                  <tr key={`${e.ref}-${i}`}>
                    <td data-label="When" className="small">{fmtDateTime(e.at)}</td>
                    <td data-label="Kind"><Badge tone={e.kind === "consent" ? "amber" : e.kind === "policy" ? "blue" : "grey"}>{e.kind}</Badge></td>
                    <td data-label="Ref"><code>{e.ref}</code></td>
                    <td data-label="Summary" className="small muted">{e.summary}</td>
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
