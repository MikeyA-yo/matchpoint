import { useState } from "react";
import { Badge, Button, Card, Drawer, Empty, Endpoint, ErrorNote, Field, Loading, Simulated, Switch } from "../../components/ui";
import { useApi, useTechnical } from "../../lib/context";
import { describeRule } from "../../lib/describe";
import { fmtDateTime, fmtNum, humanize } from "../../lib/format";
import { useAction, useQuery } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { SEGMENTS, segmentLabel } from "../../lib/personas";
import type { CampaignRequest, EligibilityRule, Product } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

// ---------- GET/POST/PUT /products ----------

export function Products() {
  const api = useApi();
  const { technical } = useTechnical();
  const productName = useProductNames();
  const list = useQuery(() => api.products(), []);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  return (
    <>
      <ConsoleHead title="Products">{list.data ? `${list.data.items.length} active` : null}</ConsoleHead>
      <Card
        endpoint="GET /products"
        actions={<Button variant="primary" size="sm" onClick={() => setEditing("new")}>New product</Button>}
        bodyClass=""
      >
        <ErrorNote error={list.error} />
        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Product</th><th>Category</th><th>Features</th><th>Eligibility</th><th className="num">Version</th><th /></tr></thead>
              <tbody>
                {list.data?.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name} {p.is_credit && <Badge tone="blue">Credit</Badge>}
                      {technical && <div className="small faint mono">{p.id}</div>}
                    </td>
                    <td className="small">{humanize(p.category)}</td>
                    <td className="small muted">{p.features.join(" · ")}</td>
                    <td className={technical ? "small mono" : "small"}>{technical ? p.eligibility.all.map((r) => `${r.fact} ${r.op} ${JSON.stringify(r.value)}`).join(" AND ") : p.eligibility.all.map((r) => describeRule(r, productName)).join(" · ")}</td>
                    <td className="num">v{p.version}</td>
                    <td className="num"><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

const CATEGORIES = ["savings", "business", "credit", "cards", "service"];
const SEGMENT_CHOICES = SEGMENTS.filter((s) => s !== "all");
// Products a customer can already hold that are not offers themselves
const HELD_ONLY = ["current_account", "savings_account", "personal_loan"];

interface RuleFields {
  minAge: string;
  segments: string[];
  excludeHolders: string[];
  // Anything the simple fields can't express is kept as-is
  other: EligibilityRule[];
}

function toFields(rules: EligibilityRule[]): RuleFields {
  const fields: RuleFields = { minAge: "", segments: [], excludeHolders: [], other: [] };
  for (const r of rules) {
    if (r.fact === "age" && r.op === ">=") fields.minAge = String(r.value);
    else if (r.fact === "segment" && r.op === "in" && Array.isArray(r.value)) fields.segments = r.value.map(String);
    else if (r.fact === "holds" && r.op === "not_contains") fields.excludeHolders.push(String(r.value));
    else fields.other.push(r);
  }
  return fields;
}

function toRules(f: RuleFields): EligibilityRule[] {
  return [
    ...(f.minAge ? [{ fact: "age", op: ">=", value: Number(f.minAge) }] : []),
    ...(f.segments.length ? [{ fact: "segment", op: "in", value: f.segments }] : []),
    ...f.excludeHolders.map((id) => ({ fact: "holds", op: "not_contains", value: id })),
    ...f.other,
  ];
}

const slug = (name: string) => `prd_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

function ProductForm({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const { technical } = useTechnical();
  const productName = useProductNames();
  const catalogue = useQuery(() => api.products(), []);
  const [id, setId] = useState(product?.id ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "savings");
  const [isCredit, setIsCredit] = useState(product?.is_credit ?? false);
  const [features, setFeatures] = useState(product?.features.join("\n") ?? "");
  const initialRules = product?.eligibility.all ?? [{ fact: "age", op: ">=", value: 18 }];
  const [fields, setFields] = useState<RuleFields>(() => toFields(initialRules));
  const [json, setJson] = useState(() => JSON.stringify({ all: initialRules }, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [save, state] = useAction(async (eligibility: { all: EligibilityRule[] }) => {
    const body = { name, category, is_credit: isCredit, features: features.split("\n").map((f) => f.trim()).filter(Boolean), eligibility };
    return product ? api.updateProduct(product.id, body) : api.createProduct({ id: id || slug(name), ...body });
  });

  const holdable = [...new Set([...HELD_ONLY, ...(catalogue.data?.items.map((p) => p.id) ?? [])])].filter(
    (h, i, all) => fields.excludeHolders.includes(h) || all.findIndex((o) => productName(o) === productName(h)) === i,
  );
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = async () => {
    let eligibility: { all: EligibilityRule[] };
    if (technical) {
      try {
        eligibility = JSON.parse(json);
        setJsonError(null);
      } catch {
        setJsonError("Eligibility is not valid JSON.");
        return;
      }
    } else {
      eligibility = { all: toRules(fields) };
    }
    if (await save(eligibility)) onSaved();
  };

  return (
    <Drawer title={product ? `Edit ${product.name}` : "New product"} onClose={onClose}>
      <div className="stack">
        <Endpoint value={product ? `PUT /products/${product.id}` : "POST /products"} />
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {technical && (
          <Field label="ID" hint={product ? undefined : `Defaults to ${slug(name || "name")}`}>
            <input className="input mono" value={id} disabled={!!product} placeholder={slug(name || "name")} onChange={(e) => setId(e.target.value)} />
          </Field>
        )}
        <Field label="Category">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {[...new Set([...CATEGORIES, category])].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </Field>
        <Switch checked={isCredit} onChange={setIsCredit} label="Credit product" description="Offers need staff approval before they're sent." />
        <Field label="Features" hint="One per line. Used in the message."><textarea className="textarea" style={{ fontFamily: "var(--font)" }} rows={3} value={features} onChange={(e) => setFeatures(e.target.value)} /></Field>

        {technical ? (
          <Field label="Eligibility (JSON)" hint="Facts: age, holds, segment. Ops: >=, <=, ==, contains, not_contains, in.">
            <textarea className="textarea" rows={8} value={json} onChange={(e) => setJson(e.target.value)} />
          </Field>
        ) : (
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Who can get it</legend>
            <Field label="Minimum age">
              <input className="input" type="number" min={16} max={100} style={{ maxWidth: 120 }} value={fields.minAge} onChange={(e) => setFields({ ...fields, minAge: e.target.value })} />
            </Field>
            <div className="field">
              <span className="label">Customer types</span>
              <div className="row" style={{ gap: 16 }}>
                {SEGMENT_CHOICES.map((s) => (
                  <label key={s} className="checkbox">
                    <input type="checkbox" checked={fields.segments.includes(s)} onChange={() => setFields({ ...fields, segments: toggle(fields.segments, s) })} />
                    {segmentLabel(s)}
                  </label>
                ))}
              </div>
              <span className="hint">None ticked means all customer types.</span>
            </div>
            <div className="field">
              <span className="label">Not for customers who already have</span>
              <div className="row" style={{ gap: 16 }}>
                {holdable.map((h) => (
                  <label key={h} className="checkbox">
                    <input type="checkbox" checked={fields.excludeHolders.includes(h)} onChange={() => setFields({ ...fields, excludeHolders: toggle(fields.excludeHolders, h) })} />
                    {productName(h)}
                  </label>
                ))}
              </div>
            </div>
            {fields.other.length > 0 && <span className="hint">{fields.other.length} more rule(s) kept unchanged.</span>}
          </fieldset>
        )}

        {jsonError && <div className="alert alert-error">{jsonError}</div>}
        <ErrorNote error={state.error} />
        <div className="row">
          <Button variant="primary" loading={state.loading} disabled={!name.trim()} onClick={submit}>{product ? "Save changes" : "Create product"}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {product && <span className="small faint">Saves as version {product.version + 1}</span>}
        </div>
      </div>
    </Drawer>
  );
}

// ---------- POST /campaign-requests, GET /campaign-requests/{id} ----------

export function Campaigns() {
  const api = useApi();
  const products = useQuery(() => api.products(), []);
  const [productId, setProductId] = useState("");
  const [segment, setSegment] = useState(SEGMENTS[1]);
  const [priority, setPriority] = useState(2);
  const [create, createState] = useAction(api.createCampaign);
  const [created, setCreated] = useState<CampaignRequest[]>([]);
  const [lookupId, setLookupId] = useState("");
  const [lookup, lookupState] = useAction(api.campaign);

  const submit = async () => {
    const res = await create({ product_id: productId || products.data?.items[0]?.id || "", audience: { segment }, priority });
    if (res) setCreated((prev) => [res, ...prev.filter((c) => c.id !== res.id)]);
  };

  return (
    <>
      <ConsoleHead title="Campaign requests" />
      <div className="stack">
        <Card title="New request" endpoint="POST /campaign-requests">
          <div className="stack">
            <div className="grid-3">
              <Field label="Product">
                <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Audience segment">
                <select className="select" value={segment} onChange={(e) => setSegment(e.target.value)}>
                  {SEGMENTS.map((s) => <option key={s} value={s}>{segmentLabel(s)}</option>)}
                </select>
              </Field>
              <Field label="Priority" hint="1 (lowest) to 5">
                <input className="input" type="number" min={1} max={5} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
              </Field>
            </div>
            <ErrorNote error={createState.error} />
            <div><Button variant="primary" loading={createState.loading} onClick={submit}>Submit request</Button></div>
          </div>
        </Card>

        <Card title="Find a request" endpoint="GET /campaign-requests/{id}">
          <div className="row">
            <input className="input" style={{ maxWidth: 240 }} placeholder="cr_…" value={lookupId} onChange={(e) => setLookupId(e.target.value.trim())} />
            <Button disabled={!lookupId} loading={lookupState.loading} onClick={() => lookup(lookupId)}>Find</Button>
          </div>
          <div style={{ marginTop: 12 }}>
            <ErrorNote error={lookupState.error} />
            {lookupState.data && <CampaignResult c={lookupState.data} />}
          </div>
        </Card>

        {created.length === 0 ? (
          <Card><Empty title="No campaign requests yet" /></Card>
        ) : (
          created.map((c) => <CampaignResult key={c.id} c={c} card />)
        )}
      </div>
    </>
  );
}

function CampaignResult({ c, card }: { c: CampaignRequest; card?: boolean }) {
  const productName = useProductNames();
  const parts = [
    { label: "Scheduled", n: c.won, color: "var(--green)" },
    { label: "Lost to higher priority", n: c.governor_lost, color: "var(--amber)" },
    { label: "Blocked by contact rules", n: c.held_by_rules, color: "var(--border-strong)" },
  ];
  const body = (
    <div className="stack-sm">
      <div className="row-between">
        <span>
          <code>{c.id}</code> · {productName(c.product_id)} → {segmentLabel(c.audience.segment)} · priority {c.priority}
        </span>
        <span className="row"><span className="small faint">{fmtDateTime(c.created_at)}</span><Simulated /></span>
      </div>
      <div className="bar">
        {parts.map((p) => <span key={p.label} style={{ width: `${(p.n / (c.reached || 1)) * 100}%`, background: p.color }} />)}
      </div>
      <div className="row small" style={{ gap: 16 }}>
        <span className="muted">Reached <strong style={{ color: "var(--text)" }}>{fmtNum(c.reached)}</strong></span>
        {parts.map((p) => (
          <span key={p.label} className="muted"><span style={{ color: p.color }}>■</span> {p.label} <strong style={{ color: "var(--text)" }}>{fmtNum(p.n)}</strong></span>
        ))}
      </div>
    </div>
  );
  return card ? <Card>{body}</Card> : body;
}
