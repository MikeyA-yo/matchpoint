import { useEffect, useState } from "react";
import { Button, Card, ErrorNote } from "../../components/ui";
import { useApi } from "../../lib/context";
import { describeDecision } from "../../lib/describe";
import { fmtDay, fmtTime, shiftDays } from "../../lib/format";
import { useAction, useQuery } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { load, save } from "../../lib/storage";
import { ACTIVITY_LABEL, ACTIVITY_PATTERN, type ActivityKind, type Decision } from "../../lib/types";

const ACTIVITIES: { kind: ActivityKind; label: string; money: "in" | "out" }[] = [
  { kind: "salary", label: "Salary arrives", money: "in" },
  { kind: "allowance", label: "Allowance arrives", money: "in" },
  { kind: "pos_sales", label: "POS sales come in", money: "in" },
  { kind: "school_fees", label: "Pay school fees", money: "out" },
  { kind: "textbooks", label: "Buy textbooks", money: "out" },
  { kind: "bills", label: "Pay DSTV and power", money: "out" },
  { kind: "dollar_payment", label: "Pay online in dollars", money: "out" },
];

/** Sandbox controls: post account activity for this customer, move the clock, run decisioning. */
export function SimulatePanel({ customerRef }: { customerRef: string }) {
  const api = useApi();
  const productName = useProductNames();
  const sim = useQuery(() => api.simState(), []);
  const timeKey = `matchpoint.demoTime.${customerRef}`;
  const [time, setTimeState] = useState<string | null>(() => load<string | null>(timeKey, null));
  const [last, setLast] = useState<{ kind?: ActivityKind; at: string; decision: Decision } | null>(null);
  const [busy, setBusy] = useState<ActivityKind | "run" | "week" | null>(null);
  const [start, startState] = useAction(api.simStart);
  const [run, runState] = useAction(async (at: string, kind?: ActivityKind) => {
    if (kind) {
      await api.simActivity(customerRef, kind, at);
      // The API reads its own transactions; planting the pattern lets its next decision see the activity
      const pattern = ACTIVITY_PATTERN[kind];
      if (pattern) await api.simInject(pattern, customerRef);
    }
    return api.evaluate(customerRef, "live", at);
  });

  const setTime = (t: string) => {
    save(timeKey, t);
    setTimeState(t);
  };

  useEffect(() => {
    if (!time && sim.data?.clock) setTime(sim.data.clock);
  }, [sim.data?.clock]);

  const go = async (what: ActivityKind | "run" | "week") => {
    if (!time) return;
    const at = what === "week" ? shiftDays(time, 7) : time;
    if (what === "week") setTime(at);
    const kind = what === "run" || what === "week" ? undefined : what;
    setBusy(what);
    const decision = await run(at, kind);
    setBusy(null);
    if (decision) setLast({ kind, at, decision });
  };

  const paused = sim.data && !sim.data.running;
  const plain = last ? describeDecision(last.decision, productName(last.decision.product_id)) : null;

  return (
    <Card
      title="Simulate"
      endpoint={["POST /sim/activity", "POST /sim/inject", "POST /decisions/evaluate"]}
      actions={time && !paused && <span className="small muted">{fmtDay(time, true)}, {fmtTime(time)}</span>}
    >
      {paused ? (
        <div className="row-between">
          <span className="small muted">Simulation stopped</span>
          <Button
            size="sm"
            variant="primary"
            loading={startState.loading}
            onClick={async () => (await start({ seed: 42, n_customers: 5000, days: 120, scenario: "baseline" })) && sim.reload()}
          >
            Start
          </Button>
        </div>
      ) : (
        <div className="stack">
          <div className="sim-grid">
            {ACTIVITIES.map((a) => (
              <button key={a.kind} type="button" className="sim-tile" disabled={!time || busy !== null} onClick={() => go(a.kind)}>
                <span className={`sim-ico sim-${a.money}`} aria-hidden>{a.money === "in" ? "↓" : "↑"}</span>
                <span className="sim-label">
                  {a.label}
                  <span className="small faint">{a.money === "in" ? "Money in" : "Money out"}</span>
                </span>
                {busy === a.kind && <span className="spinner" aria-hidden />}
              </button>
            ))}
          </div>
          <div className="row">
            <Button size="sm" disabled={!time || busy !== null} loading={busy === "run"} onClick={() => go("run")}>Run decisioning</Button>
            <Button size="sm" variant="ghost" disabled={!time || busy !== null} loading={busy === "week"} onClick={() => go("week")}>+1 week</Button>
          </div>
          <ErrorNote error={runState.error ?? startState.error ?? sim.error} />
          {last && plain && !runState.error && (
            <div className={`sim-result tone-${plain.tone}`} role="status">
              <span className="activity-dot" aria-hidden />
              <div>
                <div className="small faint">{last.kind ? ACTIVITY_LABEL[last.kind] : "Decisioning run"} · {fmtDay(last.at)}, {fmtTime(last.at)}</div>
                <strong>{plain.status}</strong> <span className="muted">{plain.detail}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
