// API contract shared by the live client and the mock backend.
// Shapes follow docs/api_design.md; anything the doc leaves open is defined here (see section 5.5).

// "shown" is logged by the API when For you lists a product; it is never delivered
export type Outcome = "send" | "hold" | "silent" | "review" | "shown";
export type Channel = "app" | "whatsapp" | "sms" | "email" | "ussd";
export type Role = "product_owner" | "campaign_manager" | "compliance" | "dpo" | "customer";
export type Persona = "salaried_parent" | "sme_owner" | "young_professional";
export type Pattern = "salary_pattern" | "fee_season" | "sme_growth";
export type RespondAction = "opened" | "accepted" | "not_now" | "stop_offers";
export type EvalMode = "live" | "dry_run";

export const CHANNELS: Channel[] = ["app", "whatsapp", "sms", "ussd", "email"];
// Channels a customer can turn on. The API stores email as always off (api_design.md 5.3).
export const CONTACT_CHANNELS: Channel[] = ["app", "whatsapp", "sms", "ussd"];
export const STAFF_ROLES: Role[] = ["product_owner", "campaign_manager", "compliance", "dpo"];
export const PATTERNS: Pattern[] = ["salary_pattern", "fee_season", "sme_growth"];
// Account events the sandbox can post for one customer (POST /sim/activity)
export type ActivityKind = "salary" | "allowance" | "school_fees" | "textbooks" | "pos_sales" | "dollar_payment" | "bills";
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  salary: "Salary received",
  allowance: "Allowance received",
  school_fees: "School fees paid",
  textbooks: "Textbooks bought",
  pos_sales: "POS sales received",
  dollar_payment: "Dollar payment online",
  bills: "DSTV and power paid",
};
/** The pattern the API's /sim/inject plants for each activity, where it has one. */
export const ACTIVITY_PATTERN: Record<ActivityKind, Pattern | null> = {
  salary: "salary_pattern",
  allowance: null,
  school_fees: "fee_season",
  textbooks: null,
  pos_sales: "sme_growth",
  dollar_payment: null,
  bills: null,
};

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

/** What staff see when Developer view is off. */
export const REASON_LABEL: Record<ReasonCode, string> = {
  OK: "All checks passed",
  NO_CONSENT: "No consent",
  OPTED_OUT: "Opted out",
  NO_CHANNEL_CONSENT: "No contact channel",
  SENSITIVE_TRIGGER: "Excluded data",
  NOT_ELIGIBLE: "Not eligible",
  ALREADY_HOLDS: "Already has it",
  NO_MATCH: "No suitable product",
  CAP_30D: "Monthly limit reached",
  SAME_PRODUCT_60D: "Offered recently",
  COOLDOWN_IGNORED: "Customer said not now",
  QUIET_HOURS: "Quiet hours",
  LOW_UPLIFT: "Low expected benefit",
  ATTENTION_BUDGET: "Monthly limit reached",
  GOVERNOR_LOST: "Lower priority",
  CREDIT_REVIEW: "Needs approval",
  GUARDRAIL_BLOCKED: "Failed content check",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  send: "Sent",
  hold: "Held",
  silent: "Not contacted",
  review: "In review",
  shown: "Shown in app",
};

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
  // Set for sign-ups; the seeded demo customers have their own story instead
  persona?: Persona;
  story?: string;
  age_band: string;
  segment: string;
  holdings: string[];
}

export interface Consent {
  customer_ref: string;
  personalised_offers: boolean;
  channels: Record<Channel, boolean>;
  updated_at: string;
  // The API leaves this out on GET
  source?: string;
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
  key_facts?: string[];
  gain_model?: string | null;
  compare_group?: string | null;
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
  category?: string | null;
  blocked?: boolean;
}

export interface Candidate {
  product_id: string;
  eligible: boolean;
  uplift: number;
  dropped?: ReasonCode | null;
}

/** One pipeline step as the backend ran it (docs/api_design.md section 6). */
export interface StepTrace {
  step: number;
  name: string;
  status: "ok" | "stop";
  reason: string;
  detail: string;
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
  scheduled_for?: string | null;
  trace: {
    triggers: Trigger[];
    candidates: Candidate[];
    rules: RuleCheck[];
    steps?: StepTrace[];
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
  // Illustrative benefit for savings products; the API puts it in the body instead
  gain?: Gain | null;
  simulated: true;
}

export interface WhyResponse {
  message_id: string;
  why: string;
  data_categories: string[];
  consent_url: string;
}

export interface RespondResult {
  // The API returns { status } for most actions and the new consent for stop_offers
  status?: string;
  message?: Message;
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
  // Results strip (30-day window)
  window_days?: number;
  as_of?: string;
  notifications_sent?: number;
  click_rate?: number;
  product_uptake?: number;
  control_group_uptake?: number;
  simulated: true;
}

export interface ChannelMetrics {
  channel: Channel;
  sent: number;
  click_rate: number;
  product_uptake: number;
}

export interface MetricsByChannel {
  window_days: number;
  channels: ChannelMetrics[];
  total: Omit<ChannelMetrics, "channel">;
  simulated: true;
}

// ---- For you (GET /customers/{ref}/for-you) ----

export interface Gain {
  amount_ngn: number;
  period_months: number;
  basis: string;
  example_rate?: boolean;
}

export interface ForYouItem {
  rank: number;
  product_id: string;
  name: string;
  why: string;
  gain: Gain | null;
  key_facts: string[];
  compare: { product_id: string; when_it_fits: string }[];
}

export interface ForYou {
  personalised: boolean;
  items: ForYouItem[];
  note: string | null;
  simulated: true;
}

// ---- Account (GET /customers/{ref}/transactions) ----

// Same kinds as the API's Txn model (apps/api/src/matchpoint/models.py)
export type TxnKind = "salary" | "nip_in" | "nip_out" | "pos" | "atm" | "bill" | "airtime" | "charge" | "stamp_duty" | "reversal" | "other";

export interface Transaction {
  id: string;
  customer_ref: string;
  at: string;
  direction: "credit" | "debit";
  kind: TxnKind;
  amount_kobo: number;
  currency: string;
  narration: string;
  simulated: true;
}

export interface TransactionPage extends Page<Transaction> {
  account_no: string;
  balance_kobo: number;
}

export interface ActivityResult {
  customer_ref: string;
  kind: ActivityKind;
  transactions: Transaction[];
  balance_kobo: number;
}

// ---- Rewards ----

export interface RewardsAccount {
  customer_ref: string;
  balance: number;
  lifetime_earned: number;
  tier: string;
  next_tier: { name: string; points_needed: number } | null;
}

export interface RewardItem {
  id: string;
  name: string;
  points: number;
  kind: "airtime" | "voucher" | "fee_waiver";
}

export interface RedeemResult {
  customer_ref: string;
  balance: number;
  receipt: { redemption_id: string; status: string; at: string; provider_ref?: string | null } | null;
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
  simulated_customers?: number;
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
  | "policy_changed"
  | "points_awarded"
  | "tier_changed"
  | "points_redeemed"
  | "transaction_posted";

export const STREAM_EVENTS: StreamEventType[] = [
  "decision_created",
  "message_delivered",
  "outcome_recorded",
  "consent_changed",
  "policy_changed",
  "points_awarded",
  "tier_changed",
  "points_redeemed",
  "transaction_posted",
];

export interface StreamEvent {
  type: StreamEventType;
  at: string;
  // Every event payload carries customer_ref when it concerns one customer
  data: { customer_ref?: string; [key: string]: unknown };
}
