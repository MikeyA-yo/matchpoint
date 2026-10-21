// API contract shared by the live client and the mock backend.
// Shapes follow docs/api_design.md; anything the doc leaves open is defined here (see section 5.5).

export type Outcome = "send" | "hold" | "silent" | "review";
export type Channel = "app" | "whatsapp" | "sms" | "email";
export type Role = "product_owner" | "campaign_manager" | "compliance" | "dpo" | "customer";
export type Persona = "salaried_parent" | "sme_owner" | "young_professional";
export type Pattern = "salary_pattern" | "fee_season" | "sme_growth";
export type RespondAction = "opened" | "accepted" | "not_now" | "stop_offers";
export type EvalMode = "live" | "dry_run";

export const CHANNELS: Channel[] = ["app", "whatsapp", "sms", "email"];
export const STAFF_ROLES: Role[] = ["product_owner", "campaign_manager", "compliance", "dpo"];
export const PATTERNS: Pattern[] = ["salary_pattern", "fee_season", "sme_growth"];

export const REASONS = {
  OK: { meaning: "Passed every check", effect: "send" },
  NO_CONSENT: { meaning: "No profiling consent", effect: "silent" },
  OPTED_OUT: { meaning: "Customer stopped offers", effect: "silent" },
  NO_CHANNEL_CONSENT: { meaning: "No consent for any usable channel", effect: "hold" },
  SENSITIVE_TRIGGER: { meaning: "Trigger came from a blocked category", effect: "hold" },
  NOT_ELIGIBLE: { meaning: "Fails the product's eligibility rule", effect: "dropped" },
  ALREADY_HOLDS: { meaning: "Customer already uses the product", effect: "dropped" },
  NO_MATCH: { meaning: "No suitable product", effect: "silent" },
  CAP_30D: { meaning: "Message cap reached in the last 30 days", effect: "hold" },
  SAME_PRODUCT_60D: { meaning: "Same product promoted within the gap", effect: "hold" },
  COOLDOWN_IGNORED: { meaning: "Recently ignored or declined an offer", effect: "hold" },
  QUIET_HOURS: { meaning: "Outside the allowed send window", effect: "reschedule" },
  LOW_UPLIFT: { meaning: "Predicted benefit below threshold", effect: "hold" },
  ATTENTION_BUDGET: { meaning: "Customer's attention budget is spent", effect: "hold" },
  GOVERNOR_LOST: { meaning: "Another product won the slot", effect: "hold" },
  CREDIT_REVIEW: { meaning: "Credit product, needs a person", effect: "review" },
  GUARDRAIL_BLOCKED: { meaning: "Explainer output failed the safety check", effect: "hold" },
} as const;
export type ReasonCode = keyof typeof REASONS;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface Counts {
  send: number;
  hold: number;
  silent: number;
  review: number;
}

// ---- Customers and consent ----

export interface Customer {
  customer_ref: string;
  name: string;
  phone: string;
  persona: Persona;
  age_band: string;
  segment: string;
  holdings: string[];
}

export interface Consent {
  customer_ref: string;
  personalised_offers: boolean;
  channels: Record<Channel, boolean>;
  updated_at: string;
  source: string;
}

export type ConsentInput = Pick<Consent, "personalised_offers" | "channels">;

export interface AuthResponse {
  customer: Customer;
  token: string;
}

export interface SignUpInput {
  name: string;
  phone: string;
  password: string;
  persona: Persona;
  consent: ConsentInput;
}

// ---- Catalogue and policy ----

export interface EligibilityRule {
  fact: string;
  op: string;
  value: unknown;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  is_credit: boolean;
  features: string[];
  eligibility: { all: EligibilityRule[] };
  version: number;
}

export type QuietHours = Partial<Record<Channel, { start: string; end: string }>>;

export interface Policy {
  id: string;
  status: "draft" | "active" | "retired";
  max_messages_per_30d: number;
  same_product_gap_days: number;
  cooldown_after_ignored_days: number;
  quiet_hours: QuietHours;
  min_uplift: number;
  credit_requires_review: boolean;
  blocked_trigger_categories: string[];
  created_at: string;
  approved_by?: Role;
}

export type PolicyDraft = Omit<Policy, "id" | "status" | "created_at" | "approved_by">;

export interface PolicyList {
  active_id: string | null;
  items: Policy[];
}

export interface PolicySimulation {
  counts: Counts;
  by_reason: Partial<Record<ReasonCode, number>>;
  population: number;
  simulated: true;
}

// ---- Decisions and messages ----

export interface Trigger {
  type: string;
  evidence: string;
  category?: string;
  blocked?: boolean;
}

export interface Candidate {
  product_id: string;
  eligible: boolean;
  uplift: number;
  dropped?: ReasonCode;
}

export interface RuleCheck {
  rule: ReasonCode;
  passed: boolean;
  detail: string;
}

export interface Decision {
  id: string;
  customer_ref: string;
  as_of: string;
  mode: EvalMode;
  outcome: Outcome;
  product_id: string | null;
  channel: Channel | null;
  reasons: ReasonCode[];
  scheduled_for?: string;
  trace: {
    triggers: Trigger[];
    candidates: Candidate[];
    rules: RuleCheck[];
    policy_version: string;
    model_version: string;
  };
  message: { title: string; body: string; why: string } | null;
  review?: { action: "approved" | "rejected"; by: Role; at: string; note?: string };
  simulated: true;
}

export interface DecisionFilters {
  outcome?: Outcome;
  reason?: ReasonCode;
  product_id?: string;
  customer_ref?: string;
  since?: string;
}

export interface BatchResult {
  decisions: Decision[];
  counts: Counts;
  simulated: true;
}

export type MessageStatus = "delivered" | "scheduled" | "opened" | "accepted" | "not_now" | "cancelled";

export interface Message {
  id: string;
  decision_id: string;
  customer_ref: string;
  product_id: string;
  channel: Channel;
  title: string;
  body: string;
  why: string;
  delivered_at: string;
  status: MessageStatus;
  simulated: true;
}

export interface WhyResponse {
  message_id: string;
  why: string;
  data_categories: string[];
  consent_url: string;
}

export interface RespondResult {
  message: Message;
  consent?: Consent;
}

// ---- Console ----

export interface MetricsOverview {
  sent: number;
  held: number;
  silent: number;
  review: number;
  opt_outs: number;
  sustained_use_60d: number;
  simulated: true;
}

export interface ProductMetrics {
  product_id: string;
  name: string;
  sent: number;
  held: number;
  opt_outs: number;
  sustained_use_60d: number;
}

export interface CampaignRequestInput {
  product_id: string;
  audience: { segment: string };
  priority: number;
}

export interface CampaignRequest extends CampaignRequestInput {
  id: string;
  status: "done";
  reached: number;
  won: number;
  governor_lost: number;
  held_by_rules: number;
  created_at: string;
  simulated: true;
}

export interface AuditEntry {
  at: string;
  kind: "decision" | "consent" | "policy";
  ref: string;
  summary: string;
}

// ---- Demo control ----

export interface SimConfig {
  seed: number;
  n_customers: number;
  days: number;
  scenario: string;
}

export interface SimState extends SimConfig {
  running: boolean;
  clock: string | null;
  simulated: true;
}

export type Strategy = "blast" | "caps_only" | "matchpoint";

export interface StrategyResult {
  strategy: Strategy;
  messages_per_customer: number;
  opt_out_rate: number;
  sustained_adoption_60d: number;
  fatigue_index: number;
  uplift_recovery?: number;
}

export interface Experiment {
  id: string;
  seed: number;
  days: number;
  status: "done";
  results: StrategyResult[];
  created_at: string;
  simulated: true;
}

export interface ModelInfo {
  version: string;
  qini: number | null;
  trained_at: string | null;
  simulated: true;
}

export type StreamEventType =
  | "decision_created"
  | "message_delivered"
  | "outcome_recorded"
  | "consent_changed"
  | "policy_changed";

export const STREAM_EVENTS: StreamEventType[] = [
  "decision_created",
  "message_delivered",
  "outcome_recorded",
  "consent_changed",
  "policy_changed",
];

export interface StreamEvent {
  type: StreamEventType;
  at: string;
  // Every event payload carries customer_ref when it concerns one customer
  data: { customer_ref?: string; [key: string]: unknown };
}
