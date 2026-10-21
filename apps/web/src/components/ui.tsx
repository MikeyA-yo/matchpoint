import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ApiError } from "../lib/api";
import { useTechnical } from "../lib/context";
import { OUTCOME_LABEL, REASON_LABEL, REASONS, type Outcome, type ReasonCode } from "../lib/types";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  block?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, block, className = "", children, disabled, ...rest }: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, size !== "md" && `btn-${size}`, block && "btn-block", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

/** A card. `endpoint` labels which API call(s) the card exercises, e.g. "POST /decisions/evaluate". */
export function Card({
  title,
  sub,
  endpoint,
  actions,
  children,
  bodyClass = "card-body",
}: {
  title?: ReactNode;
  sub?: ReactNode;
  endpoint?: string | string[];
  actions?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  const { technical } = useTechnical();
  const endpoints = technical && endpoint ? (Array.isArray(endpoint) ? endpoint : [endpoint]) : [];
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
            {endpoints.length > 0 && (
              <div className="row" style={{ marginTop: 4, gap: 10 }}>
                {endpoints.map((e) => <Endpoint key={e} value={e} />)}
              </div>
            )}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** An API route label. Only shown in Developer view. */
export function Endpoint({ value }: { value: string }) {
  const { technical } = useTechnical();
  const [method, ...path] = value.split(" ");
  if (!technical) return null;
  return (
    <span className="endpoint">
      <b>{method}</b> {path.join(" ")}
    </span>
  );
}

type Tone = "green" | "accent" | "amber" | "red" | "blue" | "grey";

export function Badge({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const OUTCOME_TONE: Record<Outcome, Tone> = { send: "green", hold: "amber", silent: "grey", review: "blue", shown: "grey" };

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const { technical } = useTechnical();
  return <Badge tone={OUTCOME_TONE[outcome]}>{technical ? outcome : OUTCOME_LABEL[outcome]}</Badge>;
}

/** A reason code in Developer view, a short plain label otherwise. */
export function ReasonChip({ code }: { code: ReasonCode }) {
  const { technical } = useTechnical();
  const r = REASONS[code];
  if (!technical) return <span className="reason">{REASON_LABEL[code] ?? code}</span>;
  return (
    <span className="chip" title={r ? `${r.meaning} → ${r.effect}` : code}>
      {code}
    </span>
  );
}

export function Simulated() {
  return (
    <Badge tone="grey">
      <span aria-hidden>◇</span> Simulated
    </Badge>
  );
}

export function ErrorNote({ error }: { error?: ApiError }) {
  const { technical } = useTechnical();
  const [copied, setCopied] = useState(false);
  if (!error) return null;
  if (!technical)
    return (
      <div className="alert alert-error" role="alert">
        <div>{error.message}</div>
      </div>
    );

  // Same shape as the API's error envelope, plus where the request went
  const report = {
    status: error.status,
    code: error.code,
    message: error.message,
    trace_id: error.traceId ?? null,
    request: error.endpoint ?? null,
    served_by: error.servedBy ?? null,
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the details are on screen
    }
  };
  return (
    <div className="alert alert-error error-dev" role="alert">
      <div className="stack-sm" style={{ gap: 4, minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 8 }}>
          <code className="error-status">{error.status || "—"}</code>
          <code><strong>{error.code}</strong></code>
          {error.servedBy && <span className="error-by">{error.servedBy === "live" ? "Live API" : "Mock"}</span>}
          <span className="spacer" />
          <button type="button" className="error-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <div>{error.message}</div>
        {(error.endpoint || error.traceId) && (
          <div className="small error-meta">
            {error.endpoint && <code>{error.endpoint}</code>}
            {error.traceId && <code>trace {error.traceId}</code>}
          </div>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty row" style={{ justifyContent: "center" }}>
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <span>
        <span>{label}</span>
        {description && <span className="hint" style={{ display: "block" }}>{description}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? "active" : ""}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
