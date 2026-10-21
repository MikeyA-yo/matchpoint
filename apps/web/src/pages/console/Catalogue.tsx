import { useState } from "react";
import { Badge, Button, Card, Drawer, Empty, ErrorNote, Field, Loading, Simulated, Switch } from "../../components/ui";
import { useApi } from "../../lib/context";
import { fmtDateTime, fmtNum, humanize } from "../../lib/format";
import { useAction, useQuery } from "../../lib/hooks";
import { SEGMENTS } from "../../lib/personas";
import type { CampaignRequest, Product } from "../../lib/types";
import { ConsoleHead } from "./ConsolePage";

// ---------- GET/POST/PUT /products ----------

export function Products() {
  const api = useApi();
  const list = useQuery(() => api.products(), []);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  return (
    <>
      <ConsoleHead title="Products">The versioned catalogue the matcher draws from. Edits create a new version.</ConsoleHead>
      <Card
        title="Catalogue"
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
                      {p.name} {p.is_credit && <Badge tone="blue">credit</Badge>}
                      <div className="small faint mono">{p.id}</div>
                    </td>
                    <td className="small">{p.category}</td>
                    <td className="small muted">{p.features.join(" · ")}</td>
                    <td className="small mono">{p.eligibility.all.map((r) => `${r.fact} ${r.op} ${JSON.stringify(r.value)}`).join(" AND ")}</td>
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

function ProductForm({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const [id, setId] = useState(product?.id ?? "prd_");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "savings");
  const [isCredit, setIsCredit] = useState(product?.is_credit ?? false);
  const [features, setFeatures] = useState(product?.features.join("\n") ?? "");
  const [eligibility, setEligibility] = useState(
    JSON.stringify(product?.eligibility ?? { all: [{ fact: "age", op: ">=", value: 18 }] }, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [save, state] = useAction(async () => {
    const body = { name, category, is_credit: isCredit, features: features.split("\n").map((f) => f.trim()).filter(Boolean), eligibility: JSON.parse(eligibility) };
    return product ? api.updateProduct(product.id, body) : api.createProduct({ id, ...body });
  });

  const submit = async () => {
    try {
      JSON.parse(eligibility);
      setJsonError(null);
    } catch {
      setJsonError("Eligibility is not valid JSON.");
      return;
    }
    if (await save()) onSaved();
  };

  return (
    <Drawer title={product ? `Edit ${product.name}` : "New product"} onClose={onClose}>
      <div className="stack">
        <div className="endpoint">{product ? <><b>PUT</b> /products/{product.id}</> : <><b>POST</b> /products</>}</div>
        <Field label="ID"><input className="input mono" value={id} disabled={!!product} onChange={(e) => setId(e.target.value)} /></Field>
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Category"><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <Switch checked={isCredit} onChange={setIsCredit} label="Credit product" description="Credit offers go to the review queue." />
        <Field label="Features" hint="One per line."><textarea className="textarea" rows={3} value={features} onChange={(e) => setFeatures(e.target.value)} /></Field>
        <Field label="Eligibility (JSON)" hint='Facts: age, holds, segment. Ops: >=, <=, ==, contains, not_contains, in.'>
          <textarea className="textarea" rows={8} value={eligibility} onChange={(e) => setEligibility(e.target.value)} />
        </Field>
        {jsonError && <div className="alert alert-error">{jsonError}</div>}
        <ErrorNote error={state.error} />
        <div className="row">
          <Button variant="primary" loading={state.loading} onClick={submit}>{product ? `Save as v${product.version + 1}` : "Create product"}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
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
      <ConsoleHead title="Campaign requests">
        A product team asks to reach an audience. The governor gives each customer at most one slot.
      </ConsoleHead>
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
                  {SEGMENTS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              </Field>
              <Field label="Priority" hint="1 is lowest. Higher wins more contested slots.">
                <input className="input" type="number" min={1} max={5} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
              </Field>
            </div>
            <ErrorNote error={createState.error} />
            <div><Button variant="primary" loading={createState.loading} onClick={submit}>Submit request</Button></div>
          </div>
        </Card>

        <Card title="Look up a request" endpoint="GET /campaign-requests/{id}">
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
          <Card><Empty title="No requests yet this session">Submit one above to see how the governor splits the audience.</Empty></Card>
        ) : (
          created.map((c) => <CampaignResult key={c.id} c={c} card />)
        )}
      </div>
    </>
  );
}

function CampaignResult({ c, card }: { c: CampaignRequest; card?: boolean }) {
  const parts = [
    { label: "Won the slot", n: c.won, color: "var(--green)" },
    { label: "Governor lost", n: c.governor_lost, color: "var(--amber)" },
    { label: "Held by rules", n: c.held_by_rules, color: "var(--border-strong)" },
  ];
  const body = (
    <div className="stack-sm">
      <div className="row-between">
        <span>
          <code>{c.id}</code> · {humanize(c.product_id)} → {humanize(c.audience.segment)} · priority {c.priority}
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
