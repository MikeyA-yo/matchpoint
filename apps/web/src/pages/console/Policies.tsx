import { useEffect, useState, type ChangeEvent } from "react";
import { Badge, Button, Card, ErrorNote, Field, Loading, Simulated, Switch } from "../../components/ui";
import { useApi, useRole, useTechnical } from "../../lib/context";
import { CHANNEL_LABEL, fmtDateTime, fmtNum, humanize } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { CHANNELS, OUTCOME_LABEL, REASON_LABEL, type Policy, type PolicyDraft, type PolicySimulation, type ReasonCode } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

function toDraft({ id: _i, status: _s, created_at: _c, approved_by: _a, ...draft }: Policy): PolicyDraft {
  return structuredClone(draft);
}

export function Policies() {
  const api = useApi();
  const role = useRole();
  const list = useQuery(() => api.policies(), []);
  const [approve, approveState] = useAction(api.approvePolicy);
  useStream((e) => e.type === "policy_changed" && list.reload());

  const active = list.data?.items.find((p) => p.id === list.data?.active_id);

  return (
    <>
      <ConsoleHead title="Policies">{active ? `Active: ${active.id}` : null}</ConsoleHead>
      <div className="stack">
        <ErrorNote error={list.error} />
        {list.loading && !list.data && <Loading />}
        {active && <PolicyEditor base={active} onSaved={list.reload} />}

        <Card title="Versions" endpoint={["GET /policies", "POST /policies/{version}/approve"]} bodyClass="">
          {role !== "compliance" && (
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <p className="small muted">Approving a draft requires the Compliance role.</p>
            </div>
          )}
          <div className="card-body" style={{ paddingTop: role !== "compliance" ? 12 : 0, paddingBottom: 0 }}>
            <ErrorNote error={approveState.error} />
          </div>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr><th>Version</th><th>Status</th><th>Created</th><th className="num">Max / 30 days</th><th className="num">Min benefit</th><th>Approved by</th><th /></tr>
              </thead>
              <tbody>
                {list.data?.items.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Version"><code>{p.id}</code></td>
                    <td data-label="Status"><Badge tone={p.status === "active" ? "green" : p.status === "draft" ? "amber" : "grey"}>{p.status}</Badge></td>
                    <td data-label="Created" className="small">{fmtDateTime(p.created_at)}</td>
                    <td data-label="Max / 30 days" className="num">{p.max_messages_per_30d}</td>
                    <td data-label="Min benefit" className="num">{p.min_uplift}</td>
                    <td data-label="Approved by" className="small">{p.approved_by ? humanize(p.approved_by) : "—"}</td>
                    <td data-label="" className="num">
                      {p.status === "draft" && (
                        <Button size="sm" variant="primary" loading={approveState.loading} onClick={async () => (await approve(p.id)) && list.reload()}>
                          Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function PolicyEditor({ base, onSaved }: { base: Policy; onSaved: () => void }) {
  const api = useApi();
  const [draft, setDraft] = useState<PolicyDraft>(() => toDraft(base));
  const [blocked, setBlocked] = useState(base.blocked_trigger_categories.join(", "));
  const [simulate, sim] = useAction(async (d: PolicyDraft) => {
    const [proposed, current] = await Promise.all([api.simulatePolicy(d), api.simulatePolicy(toDraft(base))]);
    return { proposed, current };
  });
  const [save, saveState] = useAction(api.savePolicy);

  useEffect(() => {
    setDraft(toDraft(base));
    setBlocked(base.blocked_trigger_categories.join(", "));
  }, [base.id]);

  const withBlocked = (): PolicyDraft => ({
    ...draft,
    blocked_trigger_categories: blocked.split(",").map((s) => s.trim()).filter(Boolean),
  });
  const num = (k: keyof PolicyDraft, float = false) => ({
    value: String(draft[k]),
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setDraft({ ...draft, [k]: float ? Number.parseFloat(e.target.value) : Number.parseInt(e.target.value, 10) }),
  });

  return (
    <Card
      title={<>New draft <span className="small muted">from <code>{base.id}</code></span></>}
      sub="Drafts take effect after compliance approval."
      endpoint={["POST /policies/simulate", "PUT /policies"]}
    >
      <div className="stack">
        <div className="grid-4">
          <Field label="Messages per customer / 30 days"><input className="input" type="number" min={0} {...num("max_messages_per_30d")} /></Field>
          <Field label="Days before repeating a product"><input className="input" type="number" min={0} {...num("same_product_gap_days")} /></Field>
          <Field label="Days to pause after Not now"><input className="input" type="number" min={0} {...num("cooldown_after_ignored_days")} /></Field>
          <Field label="Minimum expected benefit"><input className="input" type="number" min={0} max={1} step={0.005} {...num("min_uplift", true)} /></Field>
        </div>
        <Field label="Excluded data categories" hint="Comma separated. Never used for offers.">
          <input className="input" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
        </Field>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Quiet hours (WAT)</div>
          <div className="grid-4 quiet-grid">
            {CHANNELS.map((ch) => {
              const w = draft.quiet_hours[ch];
              const setW = (next?: { start: string; end: string }) =>
                setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, [ch]: next } });
              return (
                <div key={ch} className="stack-sm">
                  <span className="small">{CHANNEL_LABEL[ch]}</span>
                  {w ? (
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <input className="input input-sm" type="time" value={w.start} onChange={(e) => setW({ ...w, start: e.target.value })} aria-label={`${ch} quiet from`} />
                      <input className="input input-sm" type="time" value={w.end} onChange={(e) => setW({ ...w, end: e.target.value })} aria-label={`${ch} quiet until`} />
                      <Button size="sm" variant="ghost" onClick={() => setW(undefined)} aria-label={`Remove ${ch} quiet hours`}>✕</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setW({ start: "21:00", end: "07:00" })}>+ Add window</Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <Switch
          checked={draft.credit_requires_review}
          onChange={(v) => setDraft({ ...draft, credit_requires_review: v })}
          label="Credit products need a person to approve"
        />
        <ErrorNote error={sim.error ?? saveState.error} />
        <div className="row">
          <Button loading={sim.loading} onClick={() => simulate(withBlocked())}>Simulate</Button>
          <Button variant="primary" loading={saveState.loading} onClick={async () => (await save(withBlocked())) && onSaved()}>
            Save as draft
          </Button>
          {saveState.data && <span className="small green">Saved <code>{saveState.data.id}</code>. Approve it below.</span>}
        </div>
        {sim.data && <SimulationResult current={sim.data.current} proposed={sim.data.proposed} />}
      </div>
    </Card>
  );
}

function SimulationResult({ current, proposed }: { current: PolicySimulation; proposed: PolicySimulation }) {
  const { technical } = useTechnical();
  const reasons = [...new Set([...Object.keys(current.by_reason), ...Object.keys(proposed.by_reason)])] as ReasonCode[];
  const delta = (a = 0, b = 0) => {
    const d = b - a;
    return d === 0 ? <span className="faint">0</span> : <span className={d > 0 ? "green" : ""} style={d < 0 ? { color: "var(--amber)" } : undefined}>{d > 0 ? "+" : ""}{fmtNum(d)}</span>;
  };
  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="label">Projected impact · {fmtNum(proposed.population)} customers</span>
        <Simulated />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Outcome / reason</th><th className="num">Active</th><th className="num">Draft</th><th className="num">Change</th></tr></thead>
          <tbody>
            {(["send", "hold", "silent", "review"] as const).map((o) => (
              <tr key={o}>
                <td><strong>{technical ? o : OUTCOME_LABEL[o]}</strong></td>
                <td className="num">{fmtNum(current.counts[o])}</td>
                <td className="num">{fmtNum(proposed.counts[o])}</td>
                <td className="num">{delta(current.counts[o], proposed.counts[o])}</td>
              </tr>
            ))}
            {reasons.map((r) => (
              <tr key={r}>
                <td>{technical ? <code className="small">{r}</code> : <span className="small">{REASON_LABEL[r]}</span>}</td>
                <td className="num muted">{fmtNum(current.by_reason[r] ?? 0)}</td>
                <td className="num muted">{fmtNum(proposed.by_reason[r] ?? 0)}</td>
                <td className="num">{delta(current.by_reason[r], proposed.by_reason[r])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
