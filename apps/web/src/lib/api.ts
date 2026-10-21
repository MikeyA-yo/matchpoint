import { ApiError } from "./errors";
import { getMode } from "./mode";
import { mockRequest, mockSubscribe } from "./mock";
import { KEYS, load } from "./storage";
import {
  STREAM_EVENTS,
  type AuditEntry,
  type AuthResponse,
  type BatchResult,
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
}

function token(): string | undefined {
  return load<AuthResponse | null>(KEYS.session, null)?.token;
}

async function liveRequest<T>(path: string, { method = "GET", body, query, role }: RequestOptions) {
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

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return getMode() === "mock" ? mockRequest<T>(path, options) : liveRequest<T>(path, options);
}

/** Subscribes to GET /stream (SSE). Returns an unsubscribe function. */
export function subscribe(onEvent: (event: StreamEvent) => void): () => void {
  if (getMode() === "mock") return mockSubscribe(onEvent);

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

    // 5.4 Demo control and evidence
    simStart: (config: SimConfig) => post<SimState>("/sim/start", config),
    simReset: () => post<SimState>("/sim/reset"),
    simInject: (pattern: Pattern, customer_ref?: string) =>
      post<{ pattern: Pattern; customer_ref: string | null; affected: number }>("/sim/inject", { pattern, customer_ref }),
    simState: () => get<SimState>("/sim/state"),
    runExperiment: (seed: number, strategies: Strategy[], days: number) =>
      post<Experiment>("/experiments/run", { seed, strategies, days }),
    experiment: (id: string) => get<Experiment>(`/experiments/${id}`),
    trainModel: () => post<ModelInfo>("/model/train"),
    modelInfo: () => get<ModelInfo>("/model/info"),
  };
}

export type Api = ReturnType<typeof createApi>;
