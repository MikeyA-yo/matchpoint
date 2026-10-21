import { useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, Loading, Simulated, Stat } from "../../components/ui";
import { useApi, useTechnical } from "../../lib/context";
import { fmtDateTime, fmtPct } from "../../lib/format";
import { useAction, useQuery } from "../../lib/hooks";
import type { Experiment, Strategy, StrategyResult } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

const STRATEGIES: { value: Strategy; label: string; description: string }[] = [
  { value: "blast", label: "Blast", description: "Every eligible customer, every matching product" },
  { value: "caps_only", label: "Caps only", description: "Same, with message caps and cooldowns" },
  { value: "matchpoint", label: "MATCHPOINT", description: "Consent, contact rules, targeting model, priority" },
];

type Metric = { key: keyof StrategyResult; label: string; format: (n: number) => string; better: "low" | "high" };
const METRICS: Metric[] = [
  { key: "messages_per_customer", label: "Messages per customer", format: (n) => n.toFixed(2), better: "low" },
  { key: "opt_out_rate", label: "Opt-out rate", format: (n) => fmtPct(n), better: "low" },
  { key: "sustained_adoption_60d", label: "Sustained adoption at 60 days", format: (n) => fmtPct(n), better: "high" },
  { key: "fatigue_index", label: "Fatigue index", format: (n) => n.toFixed(2), better: "low" },
];

// ---------- POST /experiments/run, GET /experiments/{id} ----------

export function Experiments() {
  const api = useApi();
  const [seed, setSeed] = useState(42);
  const [days, setDays] = useState(90);
  const [picked, setPicked] = useState<Strategy[]>(["blast", "caps_only", "matchpoint"]);
  const [run, runState] = useAction(api.runExperiment);
  const [lookupId, setLookupId] = useState("");
  const [lookup, lookupState] = useAction(api.experiment);
  const shown = lookupState.data ?? runState.data;

  const toggle = (s: Strategy) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  return (
    <>
      <ConsoleHead title="Experiments" />
      <div className="stack">
        <Card title="Run an experiment" endpoint="POST /experiments/run">
          <div className="stack">
            <div className="grid-3">
              <Field label="Seed"><input className="input" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></Field>
              <Field label="Days"><input className="input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
            </div>
            <div className="grid-3">
              {STRATEGIES.map((s) => (
                <label key={s.value} className="checkbox card" style={{ padding: 12 }}>
                  <input type="checkbox" checked={picked.includes(s.value)} onChange={() => toggle(s.value)} />
                  <span><strong>{s.label}</strong><span className="hint" style={{ display: "block" }}>{s.description}</span></span>
                </label>
              ))}
            </div>
            <ErrorNote error={runState.error} />
            <div className="row">
              <Button variant="primary" loading={runState.loading} onClick={() => run(seed, picked, days)}>Run</Button>
              <span className="spacer" />
              <input className="input input-sm" style={{ maxWidth: 180 }} placeholder="exp_…" value={lookupId} onChange={(e) => setLookupId(e.target.value.trim())} aria-label="Experiment id" />
              <Button size="sm" disabled={!lookupId} loading={lookupState.loading} onClick={() => lookup(lookupId)}>Open</Button>
            </div>
            <ErrorNote error={lookupState.error} />
          </div>
        </Card>
        {shown && <ExperimentResult exp={shown} />}
      </div>
    </>
  );
}

function ExperimentResult({ exp }: { exp: Experiment }) {
  const { technical } = useTechnical();
  const best = (m: Metric) => {
    const values = exp.results.map((r) => r[m.key] as number);
    return m.better === "low" ? Math.min(...values) : Math.max(...values);
  };
  const mp = exp.results.find((r) => r.strategy === "matchpoint");
  return (
    <Card
      title={<>Results <code className="small">{exp.id}</code></>}
      sub={`Seed ${exp.seed} · ${exp.days} days · ${fmtDateTime(exp.created_at)}`}
      actions={<Simulated />}
      bodyClass=""
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Metric</th>
              {exp.results.map((r) => <th key={r.strategy} className="num">{STRATEGIES.find((s) => s.value === r.strategy)?.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const top = best(m);
              return (
                <tr key={m.key}>
                  <td>{m.label} <span className="faint small">({m.better === "low" ? "lower" : "higher"} is better)</span></td>
                  {exp.results.map((r) => {
                    const v = r[m.key] as number;
                    return (
                      <td key={r.strategy} className="num" style={v === top ? { color: "var(--green)", fontWeight: 700 } : undefined}>
                        {m.format(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mp?.uplift_recovery !== undefined && (
        <div className="card-body row" style={{ borderTop: "1px solid var(--border)" }}>
          <Badge tone="green">{technical ? "Uplift recovery" : "Targeting accuracy"} {mp.uplift_recovery.toFixed(2)}</Badge>
          <span className="small muted">Qini against ground truth</span>
        </div>
      )}
      <div className="card-body small faint" style={{ borderTop: "1px solid var(--border)" }}>
        Synthetic data. These numbers show the method works against known ground truth, not production performance.
      </div>
    </Card>
  );
}

// ---------- POST /model/train, GET /model/info ----------

export function Model() {
  const api = useApi();
  const info = useQuery(() => api.modelInfo(), []);
  const [train, trainState] = useAction(api.trainModel);
  const model = trainState.data ?? info.data;

  return (
    <>
      <ConsoleHead title="Targeting model" />
      <div className="stack">
        <ErrorNote error={info.error ?? trainState.error} />
        {model ? (
          <div className="grid-3">
            <Stat label="Version" value={<code style={{ fontSize: 22 }}>{model.version}</code>} />
            <Stat label="Qini on held-out data" value={model.qini?.toFixed(3) ?? "—"} hint="0 = random targeting" />
            <Stat label="Trained" value={<span style={{ fontSize: 18 }}>{fmtDateTime(model.trained_at)}</span>} />
          </div>
        ) : (
          info.loading && <Loading />
        )}
        <Card title="Train" sub="Uses the latest response logs." endpoint={["POST /model/train", "GET /model/info"]} actions={<Simulated />}>
          <Button variant="primary" loading={trainState.loading} onClick={() => train()}>Train new version</Button>
        </Card>
      </div>
    </>
  );
}
