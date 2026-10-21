import { ApiError } from "./errors";
import { getMode } from "./mode";
import { DEMO_CUSTOMERS } from "./personas";
import { mockKnowsCustomer, mockRecordDecision, mockRequest, mockSubscribe } from "./mock";
import { KEYS, load } from "./storage";
import {
  STREAM_EVENTS,
  type ActivityKind,
  type ActivityResult,
  type AuditEntry,
  type AuthResponse,
  type BatchResult,
  type Channel,
  type ForYou,
  type MessageStatus,
  type MetricsByChannel,
  type RedeemResult,
  type RewardItem,
  type RewardsAccount,
  type CampaignRequest,
  type CampaignRequestInput,
  type Consent,
  type ConsentInput,
  type Customer,
  type Decision,
  type DecisionFilters,
  type EvalMode,
  type Experiment,
  type Message,
  type MetricsOverview,
  type ModelInfo,
  type Page,
  type Pattern,
  type Policy,
  type PolicyDraft,
  type PolicyList,
  type PolicySimulation,
  type Product,
  type ProductMetrics,
  type RespondAction,
  type RespondResult,
  type Role,
  type SignUpInput,
  type SimConfig,
  type SimState,
  type Strategy,
  type StreamEvent,
  type TransactionPage,
  type WhyResponse,
} from "./types";

export { ApiError };

const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api/v1`;

type Query = Record<string, string | number | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  query?: Query;
  role?: Role;
  headers?: Record<string, string>;
}

function token(): string | undefined {
  return load<AuthResponse | null>(KEYS.session, null)?.token;
}

async function liveRequest<T>(path: string, { method = "GET", body, query, role, headers }: RequestOptions) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const url = `${API_BASE}${path}${qs.size ? `?${qs}` : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(role ? { "X-Role": role } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the API. Is the backend running?");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText, err?.trace_id);
  }
  return data as T;
}

// ---- Live where ready ----
// In live mode every call goes to the API first. If the API has no such route yet, the call
// falls back to the mock, so the app keeps working while endpoints land one by one.

export type Served = "live" | "mock";
const served = new Map<string, Served>();
const servedListeners = new Set<() => void>();

/** "POST /decisions/{id}/approve" style key, so IDs don't multiply entries. */
function routeKey(method: string, path: string): string {
  return `${method} ${path.replace(/\/(cus|dec|msg|pol|prd|cr|exp)_\w+/g, (_, p) => `/{${p === "cus" ? "ref" : "id"}}`)}`;
}

function markServed(method: string, path: string, by: Served) {
  const key = routeKey(method, path);
  if (served.get(key) === by) return;
  served.set(key, by);
  servedListeners.forEach((l) => l());
}

/** Which endpoints were answered by the live API and which fell back to the mock, this session. */
export function servedEndpoints(): [string, Served][] {
  return [...served.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function onServedChange(listener: () => void): () => void {
  servedListeners.add(listener);
  return () => servedListeners.delete(listener);
}

/** The API answered "no such route" (not a domain 404 like CUSTOMER_NOT_FOUND). */
const isMissingRoute = (e: ApiError) => (e.status === 404 && e.code === "NOT_FOUND") || e.status === 405;

function customerRefOf(path: string, body: unknown): string | undefined {
  const fromBody = (body as { customer_ref?: unknown } | undefined)?.customer_ref;
  return typeof fromBody === "string" ? fromBody : path.match(/\/customers\/(cus_\w+)/)?.[1];
}

// The API's shapes for a few customer endpoints differ from the contract in types.ts.
// These adapters map them; remove each once the API returns the contract shape.
type ApiInboxMessage = {
  id: string;
  sent_at: string;
  channel: Channel;
  product_id: string;
  title: string;
  body: string;
  status: string;
  response: string | null;
};

const INBOX_STATUS: Record<string, MessageStatus> = {
  sent: "delivered",
  delivered: "delivered",
  queued: "scheduled",
  scheduled: "scheduled",
  opened: "opened",
  accepted: "accepted",
  not_now: "not_now",
  cancelled: "cancelled",
};

function adapt(path: string, result: unknown): unknown {
  const inbox = path.match(/^\/customers\/(cus_\w+)\/inbox$/);
  if (inbox && result && Array.isArray((result as { messages?: unknown }).messages)) {
    const messages = (result as { messages: ApiInboxMessage[] }).messages;
    return {
      items: messages.map(
        (m): Message => ({
          id: m.id,
          decision_id: "",
          customer_ref: inbox[1],
          product_id: m.product_id,
          channel: m.channel,
          title: m.title,
          body: m.body,
          why: "",
          delivered_at: m.sent_at,
          status: INBOX_STATUS[m.response ?? m.status] ?? "delivered",
          simulated: true,
        }),
      ),
      next_cursor: null,
    } satisfies Page<Message>;
  }
  const why = path.match(/^\/messages\/(msg_\w+)\/why$/);
  if (why && result && "reason" in (result as object)) {
    const r = result as { message_id: string; reason: string; data_used?: { kind: string }[]; consent_url?: string };
    return {
      message_id: r.message_id,
      why: r.reason,
      data_categories: (r.data_used ?? []).map((d) => d.kind),
      consent_url: r.consent_url ?? "",
    } satisfies WhyResponse;
  }
  return result;
}

/** Live decisions are copied into the mock store until GET /decisions exists. */
function mirror(path: string, result: unknown) {
  if (path === "/decisions/evaluate") mockRecordDecision(result as Decision);
  if (path === "/decisions/batch") (result as BatchResult).decisions.forEach(mockRecordDecision);
}

// The API only knows its seven demo customers. For anyone else (a sign-up made in the
// mock) it answers consent and rewards with empty defaults instead of 404, so route those
// customers to the mock until /auth/signup exists.
const API_CUSTOMERS = new Set(DEMO_CUSTOMERS.map((c) => c.ref));

async function liveWhereReady<T>(path: string, options: RequestOptions): Promise<T> {
  const method = options.method ?? "GET";
  const ref = customerRefOf(path, options.body);
  if (ref !== undefined && !API_CUSTOMERS.has(ref) && mockKnowsCustomer(ref)) {
    markServed(method, path, "mock");
    return mockRequest<T>(path, options);
  }
  try {
    const result = adapt(path, await liveRequest<T>(path, options)) as T;
    markServed(method, path, "live");
    mirror(path, result);
    return result;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (!isMissingRoute(e)) {
      markServed(method, path, "live");
      throw e;
    }
    markServed(method, path, "mock");
    return mockRequest<T>(path, options);
  }
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return getMode() === "mock" ? mockRequest<T>(path, options) : liveWhereReady<T>(path, options);
}

/** Subscribes to GET /stream (SSE). Returns an unsubscribe function. */
export function subscribe(onEvent: (event: StreamEvent) => void): () => void {
  const unsubscribeMock = mockSubscribe(onEvent);
  if (getMode() === "mock") return unsubscribeMock;

  // Live mode still hears mock events, which cover endpoints that fell back to the mock.
  // Until the API has /stream, the EventSource gets a 404 and closes without retrying.
  const source = new EventSource(`${API_BASE}/stream`);
  const handlers = STREAM_EVENTS.map((type) => {
    const handler = (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      onEvent({ type, at: data.at ?? new Date().toISOString(), data });
    };
    source.addEventListener(type, handler);
    return [type, handler] as const;
  });
  return () => {
    unsubscribeMock();
    for (const [type, handler] of handlers) source.removeEventListener(type, handler);
    source.close();
  };
}

/** Every endpoint in docs/api_design.md, bound to the caller's role (sent as X-Role). */
export function createApi(role: Role) {
  const get = <T>(path: string, query?: Query) => request<T>(path, { role, query });
  const post = <T>(path: string, body?: unknown) => request<T>(path, { role, method: "POST", body });
  const put = <T>(path: string, body: unknown) => request<T>(path, { role, method: "PUT", body });

  return {
    health: () => get<{ status: string; env: string; version: string }>("/health"),

    // 5.5 Customer accounts (demo)
    signUp: (input: SignUpInput) => post<AuthResponse>("/auth/signup", input),
    signIn: (phone: string, password: string) => post<AuthResponse>("/auth/signin", { phone, password }),
    customer: (ref: string) => get<Customer>(`/customers/${ref}`),

    // 5.1 Decisions
    evaluate: (customer_ref: string, mode: EvalMode, as_of?: string) =>
      post<Decision>("/decisions/evaluate", { customer_ref, mode, as_of }),
    batch: (ids: string[], mode: EvalMode, as_of?: string) =>
      post<BatchResult>("/decisions/batch", { segment: { ids }, mode, as_of }),
    decisions: (filters: DecisionFilters & { limit?: number; cursor?: string } = {}) =>
      get<Page<Decision>>("/decisions", { ...filters }),
    decision: (id: string) => get<Decision>(`/decisions/${id}`),
    approve: (id: string, note?: string) => post<Decision>(`/decisions/${id}/approve`, { note }),
    reject: (id: string, reason: string) => post<Decision>(`/decisions/${id}/reject`, { reason }),

    // 5.2 Customer surface
    inbox: (ref: string) => get<Page<Message>>(`/customers/${ref}/inbox`),
    respond: (messageId: string, action: RespondAction) =>
      post<RespondResult>(`/messages/${messageId}/respond`, { action }),
    why: (messageId: string) => get<WhyResponse>(`/messages/${messageId}/why`),
    consent: (ref: string) => get<Consent>(`/customers/${ref}/consent`),
    setConsent: (ref: string, consent: ConsentInput) => put<Consent>(`/customers/${ref}/consent`, consent),

    // 5.3 Console
    metricsOverview: () => get<MetricsOverview>("/metrics/overview"),
    metricsByProduct: () => get<{ items: ProductMetrics[]; simulated: true }>("/metrics/by-product"),
    metricsByChannel: () => get<MetricsByChannel>("/metrics/by-channel"),
    policies: () => get<PolicyList>("/policies"),
    savePolicy: (draft: PolicyDraft) => put<Policy>("/policies", draft),
    approvePolicy: (version: string) => post<Policy>(`/policies/${version}/approve`),
    simulatePolicy: (draft: PolicyDraft) => post<PolicySimulation>("/policies/simulate", draft),
    products: () => get<Page<Product>>("/products"),
    createProduct: (product: Omit<Product, "version">) => post<Product>("/products", product),
    updateProduct: (id: string, product: Omit<Product, "id" | "version">) => put<Product>(`/products/${id}`, product),
    createCampaign: (input: CampaignRequestInput) => post<CampaignRequest>("/campaign-requests", input),
    campaign: (id: string) => get<CampaignRequest>(`/campaign-requests/${id}`),
    auditLog: () => get<Page<AuditEntry>>("/audit/log"),
    auditExport: () => get<{ entries: AuditEntry[]; exported_at: string }>("/audit/export"),

    // Phone: account, recommendations and rewards
    transactions: (ref: string, limit = 100) => get<TransactionPage>(`/customers/${ref}/transactions`, { limit }),
    forYou: (ref: string) => get<ForYou>(`/customers/${ref}/for-you`),
    rewards: (ref: string) => get<RewardsAccount>(`/customers/${ref}/rewards`),
    rewardsCatalogue: () => get<{ catalogue: RewardItem[]; simulated: true }>("/rewards/catalogue"),
    redeem: (ref: string, rewardId: string) =>
      request<RedeemResult>(`/customers/${ref}/rewards/redeem`, {
        role,
        method: "POST",
        body: { reward_id: rewardId },
        // A fresh key per tap; a retry of the same tap would reuse it
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),

    // 5.4 Demo control and evidence
    simStart: (config: SimConfig) => post<SimState>("/sim/start", config),
    simReset: () => post<SimState>("/sim/reset"),
    simInject: (pattern: Pattern, customer_ref?: string) =>
      post<{ pattern: Pattern; customer_ref: string | null; affected: number }>("/sim/inject", { pattern, customer_ref }),
    simState: () => get<SimState>("/sim/state"),
    simActivity: (customer_ref: string, kind: ActivityKind, at?: string) =>
      post<ActivityResult>("/sim/activity", { customer_ref, kind, at }),
    runExperiment: (seed: number, strategies: Strategy[], days: number) =>
      post<Experiment>("/experiments/run", { seed, strategies, days }),
    experiment: (id: string) => get<Experiment>(`/experiments/${id}`),
    trainModel: () => post<ModelInfo>("/model/train"),
    modelInfo: () => get<ModelInfo>("/model/info"),
  };
}

export type Api = ReturnType<typeof createApi>;
