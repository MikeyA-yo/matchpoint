// In-browser stand-in for the FastAPI backend, so the UI can be built and demoed before
// the real endpoints exist. It follows the same contract (types.ts) and a simplified
// version of the pipeline in docs/api_design.md section 6. State lives in localStorage
// and events cross tabs via BroadcastChannel, so the phone and console stay in sync.

import type { RequestOptions } from "./api";
import { ApiError } from "./errors";
import { getMode } from "./mode";
import { DEMO_CUSTOMERS, DEMO_PASSWORD, PATTERN_TRIGGER, PERSONAS, SEGMENTS } from "./personas";
import { KEYS, load, save } from "./storage";
import {
  CHANNELS,
  OUTCOME_LABEL,
  REASON_LABEL,
  STAFF_ROLES,
  type AuditEntry,
  type CampaignRequest,
  type Candidate,
  type Channel,
  type Consent,
  type ConsentInput,
  type Counts,
  type Customer,
  type Decision,
  type EligibilityRule,
  type EvalMode,
  type Experiment,
  type ForYouItem,
  type Message,
  type ModelInfo,
  type Outcome,
  type Pattern,
  type Persona,
  type Policy,
  type PolicyDraft,
  type Product,
  type ReasonCode,
  type RewardItem,
  type RewardsAccount,
  type Role,
  type RuleCheck,
  type SimState,
  type Strategy,
  type StrategyResult,
  type StreamEvent,
  type Trigger,
} from "./types";

// ---------- helpers ----------

const DAY = 86_400_000;
const WAT = 3_600_000;
const START_CLOCK = "2026-12-03T09:00:00+01:00";

/** ISO 8601 in West Africa Time, e.g. 2026-12-03T09:02:00+01:00 */
function wat(ms: number): string {
  return new Date(ms + WAT).toISOString().slice(0, 19) + "+01:00";
}
const ms = (iso: string) => Date.parse(iso);
const minutesOfDayWat = (iso: string) => {
  const d = new Date(ms(iso) + WAT);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

function hash(input: string, len = 4): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let out = (h >>> 0).toString(16).padStart(8, "0");
  while (out.length < len) out += hash(out + input, 8);
  return out.slice(0, len);
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message, `trc_${hash(String(Math.random()))}`);
}

function requireRole(role: Role | undefined, allowed: Role[]) {
  if (!role || !allowed.includes(role)) {
    fail(403, "ROLE_FORBIDDEN", `This action needs role ${allowed.join(" or ")}. Current role: ${role ?? "none"}.`);
  }
}

// ---------- catalogue of triggers and copy ----------

type TriggerDef = { evidence: string; sentence: string; category: string; label: string; products: string[] };

// Trigger types follow the backend's signal names; products are Zenith's confirmed catalogue
const TRIGGERS: Record<string, TriggerDef> = {
  salary_regular: {
    evidence: "salary on the 25th, 4 months",
    sentence: "your salary arrives on the 25th",
    category: "income",
    label: "salary payments",
    products: ["prd_save4me", "prd_salary_advance", "prd_personal_loan"],
  },
  fee_season: {
    evidence: "fees paid each January and September",
    sentence: "you have paid school fees each January and September",
    category: "education",
    label: "school fee payments",
    products: ["prd_save4me", "prd_education_loan"],
  },
  surplus: {
    evidence: "₦150k+ left at month end, 4 months",
    sentence: "you usually have money left over at the end of the month",
    category: "income",
    label: "account balance",
    products: ["prd_fixed_deposit", "prd_eazysave_premium"],
  },
  pos_inflow_growth: {
    evidence: "POS inflows up 38% over 3 months",
    sentence: "your POS sales have grown for three months",
    category: "business",
    label: "POS sales",
    products: ["prd_msme_loan"],
  },
  small_frequent_spend: {
    evidence: "40+ card payments under ₦5k a month",
    sentence: "you make lots of small card payments",
    category: "spending",
    label: "card payments",
    products: ["prd_eazysave_classic", "prd_aspire"],
  },
  recurring_bill_pattern: {
    evidence: "DSTV and power paid monthly, 6 months",
    sentence: "you pay DSTV and power bills every month",
    category: "bills",
    label: "bill payments",
    products: ["prd_virtual_card"],
  },
  international_spend: {
    evidence: "USD card payments online, 3 months",
    sentence: "you often pay for things in dollars online",
    category: "spending",
    label: "online dollar payments",
    products: ["prd_domiciliary", "prd_virtual_card"],
  },
  betting_spend: {
    evidence: "regular payments to betting merchants",
    sentence: "",
    category: "betting",
    label: "betting payments",
    products: [],
  },
};

const BASE_UPLIFT: Record<string, number> = {
  prd_save4me: 0.071,
  prd_eazysave_classic: 0.034,
  prd_eazysave_premium: 0.044,
  prd_fixed_deposit: 0.06,
  prd_domiciliary: 0.058,
  prd_virtual_card: 0.036,
  prd_aspire: 0.03,
  prd_timeless: 0.02,
  prd_salary_advance: 0.052,
  prd_personal_loan: 0.047,
  prd_education_loan: 0.055,
  prd_msme_loan: 0.052,
};

const TITLES: Record<string, string> = {
  prd_save4me: "Make your salary work towards a goal",
  prd_eazysave_classic: "Save your spare change",
  prd_eazysave_premium: "Earn more on what you keep",
  prd_fixed_deposit: "Put idle cash to work",
  prd_domiciliary: "Hold dollars in your own account",
  prd_virtual_card: "Pay online with a virtual card",
  prd_aspire: "Banking built for students",
  prd_timeless: "An account made for over-60s",
  prd_salary_advance: "A cushion before payday",
  prd_personal_loan: "A loan with fixed repayments",
  prd_education_loan: "School fees, paid straight to the school",
  prd_msme_loan: "Funding to grow your business",
};

// Zenith Bank's confirmed retail products. Features are described generically: no rates or terms.
function seedProducts(): Product[] {
  const adult: EligibilityRule = { fact: "age", op: ">=", value: 18 };
  const notHeld = (id: string): EligibilityRule => ({ fact: "holds", op: "not_contains", value: id });
  const segments = (...s: string[]): EligibilityRule => ({ fact: "segment", op: "in", value: s });
  const p = (
    id: string, name: string, category: string, is_credit: boolean,
    features: string[], key_facts: string[], rules: EligibilityRule[],
  ): Product => ({ id, name, category, is_credit, features, key_facts, eligibility: { all: rules }, version: 1 });

  return [
    p("prd_save4me", "Save4Me", "savings", false,
      ["Save towards a goal", "Automatic monthly transfer"], ["Set your own target", "Choose how often you save"],
      [adult, notHeld("prd_save4me")]),
    p("prd_eazysave_classic", "eaZySave Classic", "savings", false,
      ["Save small amounts often", "Withdraw when you need to"], ["Low opening balance", "Interest on savings"],
      [adult, notHeld("prd_eazysave_classic")]),
    p("prd_eazysave_premium", "eaZySave Premium", "savings", false,
      ["A higher tier for larger balances", "Withdraw when you need to"], ["Interest on savings"],
      [adult, segments("salaried", "sme", "trader"), notHeld("prd_eazysave_premium")]),
    p("prd_fixed_deposit", "Fixed Deposit", "investments", false,
      ["Lock in a rate for a fixed term", "Interest paid at maturity"], ["Choose your term"],
      [adult]),
    p("prd_domiciliary", "Domiciliary Account", "fx", false,
      ["Hold USD, EUR or GBP", "Send and receive foreign currency"], ["Multi-currency"],
      [adult, notHeld("prd_domiciliary")]),
    p("prd_virtual_card", "Virtual card", "cards", false,
      ["Pay online and for subscriptions", "Freeze it any time in the app"], ["Instant to set up"],
      [adult, notHeld("prd_virtual_card")]),
    p("prd_aspire", "Zenith Aspire", "youth", false,
      ["An account built for students", "Comes with an Aspire card"], ["For students"],
      [segments("student"), notHeld("prd_aspire")]),
    p("prd_timeless", "Zenith Timeless Account", "seniors", false,
      ["An account for customers over 60"], ["For over-60s"],
      [{ fact: "age", op: ">=", value: 60 }, notHeld("prd_timeless")]),
    p("prd_salary_advance", "Salary Advance", "credit", true,
      ["Access part of your salary before payday", "Repaid from your next salary"], ["For salary earners"],
      [adult, segments("salaried"), notHeld("prd_salary_advance")]),
    p("prd_personal_loan", "Personal Loan", "credit", true,
      ["Fixed monthly repayments", "Repay over an agreed term"], ["For salary earners"],
      [{ fact: "age", op: ">=", value: 21 }, segments("salaried"), notHeld("prd_personal_loan"), notHeld("personal_loan")]),
    p("prd_education_loan", "Education Loan", "credit", true,
      ["Paid directly to the school", "Spread the cost of fees"], ["Paid to the school"],
      [{ fact: "age", op: ">=", value: 21 }, segments("salaried"), notHeld("prd_education_loan")]),
    p("prd_msme_loan", "MSME Loan", "credit", true,
      ["Working capital for small businesses", "Repayments matched to your cash flow"], ["For small businesses"],
      [segments("trader", "sme"), notHeld("prd_msme_loan")]),
  ];
}

const DEFAULT_POLICY: Policy = {
  id: "pol_v3",
  status: "active",
  max_messages_per_30d: 2,
  same_product_gap_days: 60,
  cooldown_after_ignored_days: 14,
  quiet_hours: {
    sms: { start: "20:00", end: "08:00" },
    whatsapp: { start: "21:00", end: "07:00" },
    app: { start: "22:00", end: "07:00" },
  },
  min_uplift: 0.02,
  credit_requires_review: true,
  blocked_trigger_categories: ["health", "religion", "politics", "betting"],
  created_at: "2026-11-28T10:00:00+01:00",
  approved_by: "compliance",
};

// ---------- database ----------

type StoredCustomer = Customer & {
  password: string;
  patterns: Pattern[];
  epoch: number;
  triggers: string[];
  uplift: number;
  complaint_open: boolean;
};

interface Db {
  customers: Record<string, StoredCustomer>;
  consent: Record<string, Consent>;
  ledger: Consent[];
  decisions: Decision[];
  messages: Message[];
  cooldowns: Record<string, string>;
  policies: Policy[];
  products: Product[];
  campaigns: CampaignRequest[];
  experiments: Experiment[];
  model: ModelInfo;
  sim: SimState;
  rewards: Record<string, RewardsLedger>;
  // IDs of decisions copied from the live API (see mockRecordDecision)
  liveDecisionIds: string[];
}

// Mirrors the API's rewards rules (apps/api/src/matchpoint/rewards/rules.py)
interface RewardsLedger {
  balance: number;
  lifetime: number;
  keys: string[];
}
const EARN_POINTS: Record<string, number> = { consent_granted: 50, offer_feedback: 5 };
const TIERS: [string, number][] = [["Base", 0], ["Silver", 200], ["Gold", 600]];
const REWARD_CATALOGUE: RewardItem[] = [
  { id: "rwi_airtime_500", name: "Airtime ₦500", points: 100, kind: "airtime" },
  { id: "rwi_fee_waiver", name: "Transfer fee waiver", points: 150, kind: "fee_waiver" },
  { id: "rwi_voucher_1000", name: "₦1,000 voucher", points: 300, kind: "voucher" },
];
const tierOf = (points: number) => TIERS.filter(([, at]) => points >= at).at(-1)![0];

// Same shape as the backend's HMAC refs: cus_ + 12 hex
const refFor = (phone: string) => `cus_${hash(`phone:${phone}`, 12)}`;

function emptyDb(): Db {
  return {
    customers: {},
    consent: {},
    ledger: [],
    decisions: [],
    messages: [],
    cooldowns: {},
    policies: [DEFAULT_POLICY],
    products: seedProducts(),
    campaigns: [],
    experiments: [],
    model: { version: "upl_0.3", qini: 0.274, trained_at: "2026-11-30T16:00:00+01:00", simulated: true },
    sim: { running: true, seed: 42, n_customers: 5000, days: 120, scenario: "baseline", clock: START_CLOCK, simulated: true },
    rewards: {},
    liveDecisionIds: [],
  };
}

function addCustomer(db: Db, customer: Omit<StoredCustomer, "patterns" | "epoch">, consent: ConsentInput, source: string, at: string) {
  const stored: StoredCustomer = { ...customer, holdings: [...customer.holdings], patterns: [], epoch: 0 };
  db.customers[stored.customer_ref] = stored;
  writeConsent(db, stored.customer_ref, consent, source, at);
  return stored;
}

function fromPersona(name: string, phone: string, password: string, persona: Persona): Omit<StoredCustomer, "patterns" | "epoch"> {
  const p = PERSONAS[persona];
  return {
    customer_ref: refFor(phone), name, phone, password, persona,
    age_band: p.age_band, segment: p.segment, holdings: p.holdings, triggers: p.triggers, uplift: p.uplift, complaint_open: false,
  };
}

function seedDb(): Db {
  const db = emptyDb();
  const at = "2026-11-20T18:41:00+01:00";
  for (const c of DEMO_CUSTOMERS) {
    addCustomer(
      db,
      {
        customer_ref: c.ref, name: c.name, phone: c.phone, password: DEMO_PASSWORD, story: c.note,
        age_band: c.age_band, segment: c.segment, holdings: c.holdings, triggers: c.triggers, uplift: c.uplift,
        complaint_open: Boolean(c.complaint_open),
      },
      { personalised_offers: c.personalised_offers, channels: c.channels },
      "demo_seed",
      at,
    );
  }

  // A small synthetic population so the console has something to show
  const r = rng(42);
  const first = ["Bola", "Chinedu", "Damilola", "Funke", "Gbenga", "Ifeoma", "Kemi", "Olu", "Sade", "Yusuf", "Uche", "Zainab"];
  const last = ["Adeyemi", "Okafor", "Bello", "Nwosu", "Lawal", "Eze", "Ibrahim", "Ogunleye"];
  const personas = Object.keys(PERSONAS) as Persona[];
  const synthetic: StoredCustomer[] = [];
  for (let i = 0; i < 28; i++) {
    const picked = CHANNELS.filter(() => r() > 0.5);
    const channels = Object.fromEntries(CHANNELS.map((ch) => [ch, picked.includes(ch)])) as Record<Channel, boolean>;
    const name = `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`;
    const c = addCustomer(
      db,
      fromPersona(name, `0809${String(1000000 + i).slice(1)}`, "", personas[Math.floor(r() * personas.length)]),
      { personalised_offers: r() > 0.2, channels },
      "onboarding",
      at,
    );
    synthetic.push(c);
  }

  // Some history so restraint rules have something to bite on
  synthetic.forEach((c, i) => {
    if (i % 5 === 1) evaluate(db, c.customer_ref, "2026-11-20T10:00:00+01:00", "live");
    if (i % 7 === 2) for (const p of db.products) db.cooldowns[`${c.customer_ref}:${p.id}`] = "2027-01-15T09:00:00+01:00";
  });
  for (const c of Object.values(db.customers)) evaluate(db, c.customer_ref, "2026-12-03T08:30:00+01:00", "dry_run");
  pending.length = 0;
  return db;
}

function loadDb(): Db {
  const db = load<Db | null>(KEYS.mockDb, null) ?? seedDb();
  db.rewards ??= {};
  db.liveDecisionIds ??= [];
  return db;
}

/** Awards points once per key, like the API's idempotent earn events. */
function earn(db: Db, ref: string, event: string, key: string) {
  const acct = (db.rewards[ref] ??= { balance: 0, lifetime: 0, keys: [] });
  const points = EARN_POINTS[event];
  if (!points || acct.keys.includes(key)) return;
  const before = tierOf(acct.balance);
  acct.balance += points;
  acct.lifetime += points;
  acct.keys.push(key);
  const tier = tierOf(acct.balance);
  emit(db, "points_awarded", { customer_ref: ref, event, points, balance: acct.balance, tier });
  if (tier !== before) emit(db, "tier_changed", { customer_ref: ref, from_tier: before, to_tier: tier });
}

function rewardsView(db: Db, ref: string): RewardsAccount {
  const acct = db.rewards[ref] ?? { balance: 0, lifetime: 0, keys: [] };
  const next = TIERS.find(([, at]) => at > acct.balance);
  return {
    customer_ref: ref,
    balance: acct.balance,
    lifetime_earned: acct.lifetime,
    tier: tierOf(acct.balance),
    next_tier: next ? { name: next[0], points_needed: next[1] - acct.balance } : null,
  };
}

// Synthetic baseline per channel, plus whatever the sandbox has really sent
const CHANNEL_BASE: Record<Channel, { share: number; click: number; uptake: number }> = {
  app: { share: 0.46, click: 0.34, uptake: 0.048 },
  whatsapp: { share: 0.31, click: 0.41, uptake: 0.052 },
  sms: { share: 0.15, click: 0.12, uptake: 0.021 },
  email: { share: 0.05, click: 0.09, uptake: 0.015 },
  ussd: { share: 0.03, click: 0.06, uptake: 0.011 },
};

function channelStats(db: Db) {
  const n = db.sim.running ? db.sim.n_customers : 0;
  const rate = (part: number, whole: number) => (whole ? round(part / whole) : 0);
  const rows = CHANNELS.map((channel) => {
    const base = CHANNEL_BASE[channel];
    const baseSent = Math.round(n * 0.082 * base.share);
    const mine = db.messages.filter((m) => m.channel === channel && m.status !== "cancelled" && m.status !== "scheduled");
    const opened = Math.round(baseSent * base.click) + mine.filter((m) => m.status !== "delivered").length;
    const accepted = Math.round(baseSent * base.uptake) + mine.filter((m) => m.status === "accepted").length;
    const sent = baseSent + mine.length;
    return { channel, sent, opened, accepted, click_rate: rate(opened, sent), product_uptake: rate(accepted, sent) };
  });
  const sent = rows.reduce((a, r) => a + r.sent, 0);
  const opened = rows.reduce((a, r) => a + r.opened, 0);
  const accepted = rows.reduce((a, r) => a + r.accepted, 0);
  return {
    channels: rows.map(({ channel, sent, click_rate, product_uptake }) => ({ channel, sent, click_rate, product_uptake })),
    total: { sent, click_rate: rate(opened, sent), product_uptake: rate(accepted, sent) },
  };
}

const GAINS: Record<string, { amount_ngn: number; period_months: number; basis: string; example_rate: boolean }> = {
  prd_save4me: { amount_ngn: 8500, period_months: 12, basis: "An illustrative 10% a year.", example_rate: true },
  prd_eazysave_classic: { amount_ngn: 6800, period_months: 12, basis: "An illustrative 8% a year.", example_rate: true },
  prd_eazysave_premium: { amount_ngn: 12000, period_months: 12, basis: "An illustrative 10% a year.", example_rate: true },
  prd_fixed_deposit: { amount_ngn: 42000, period_months: 12, basis: "An illustrative 14% a year on ₦300,000.", example_rate: true },
};

// ---------- events ----------

type Listener = (e: StreamEvent) => void;
const listeners = new Set<Listener>();
const pending: StreamEvent[] = [];
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("matchpoint-mock") : null;
channel?.addEventListener("message", (e: MessageEvent<StreamEvent>) => listeners.forEach((l) => l(e.data)));

function emit(db: Db, type: StreamEvent["type"], data: StreamEvent["data"]) {
  pending.push({ type, at: db.sim.clock ?? wat(Date.now()), data });
}

function flush() {
  for (const e of pending.splice(0)) {
    listeners.forEach((l) => l(e));
    channel?.postMessage(e);
  }
}

/** True if the mock knows this customer (e.g. a sign-up the backend can't see yet). */
export function mockKnowsCustomer(ref: string): boolean {
  return Boolean(loadDb().customers[ref]);
}

/**
 * Copies a decision the live API made into the mock store, so views whose endpoints are not
 * built yet (GET /decisions, the review queue, the message log) still show it. The API's own
 * stream announces it, so nothing is emitted here. Remove once GET /decisions exists.
 */
export function mockRecordDecision(d: Decision): void {
  const db = loadDb();
  if (!db.liveDecisionIds.includes(d.id)) db.liveDecisionIds.push(d.id);
  if (!db.decisions.some((x) => x.id === d.id)) db.decisions.unshift(d);
  save(KEYS.mockDb, db);
}

export function mockSubscribe(onEvent: Listener): () => void {
  listeners.add(onEvent);
  return () => listeners.delete(onEvent);
}

// ---------- domain ----------

function activePolicy(db: Db): Policy {
  return db.policies.find((p) => p.status === "active") ?? DEFAULT_POLICY;
}

// Seeded demo customers keep the backend's refs, so look people up by phone, not by derived ref
const byPhone = (db: Db, phone: string) => Object.values(db.customers).find((c) => c.phone === phone);

function getCustomer(db: Db, ref: string): StoredCustomer {
  return db.customers[ref] ?? fail(404, "CUSTOMER_NOT_FOUND", `No customer ${ref}.`);
}

function publicCustomer({ password: _p, patterns: _q, epoch: _e, triggers: _t, uplift: _u, complaint_open: _c, ...c }: StoredCustomer): Customer {
  return c;
}

function writeConsent(db: Db, ref: string, input: ConsentInput, source: string, at: string): Consent {
  const consent: Consent = {
    customer_ref: ref,
    personalised_offers: Boolean(input.personalised_offers),
    channels: Object.fromEntries(CHANNELS.map((c) => [c, Boolean(input.channels?.[c])])) as Record<Channel, boolean>,
    updated_at: at,
    source,
  };
  db.ledger.push(consent);
  db.consent[ref] = consent;
  invalidate(db, ref);
  if (!consent.personalised_offers) {
    for (const m of db.messages) if (m.customer_ref === ref && m.status === "scheduled") m.status = "cancelled";
  }
  emit(db, "consent_changed", { customer_ref: ref, personalised_offers: consent.personalised_offers, source });
  return consent;
}

/** Bumps the customer's epoch, which is part of the idempotency key, so cached decisions are re-run. */
function invalidate(db: Db, ref: string) {
  if (db.customers[ref]) db.customers[ref].epoch += 1;
}

function checkEligibility(c: StoredCustomer, rules: EligibilityRule[]): ReasonCode | null {
  const age = Number.parseInt(c.age_band, 10);
  for (const rule of rules) {
    const fact = rule.fact === "age" ? age : rule.fact === "holds" ? c.holdings : rule.fact === "segment" ? c.segment : undefined;
    const v = rule.value;
    const ok =
      rule.op === ">=" ? Number(fact) >= Number(v)
      : rule.op === "<=" ? Number(fact) <= Number(v)
      : rule.op === "==" ? fact === v
      : rule.op === "contains" ? Array.isArray(fact) && fact.includes(v as string)
      : rule.op === "not_contains" ? Array.isArray(fact) && !fact.includes(v as string)
      : rule.op === "in" ? Array.isArray(v) && v.includes(fact)
      : true;
    if (!ok) return rule.fact === "holds" ? "ALREADY_HOLDS" : "NOT_ELIGIBLE";
  }
  return null;
}

/** Next time the channel's quiet window ends, or null if `asOf` is outside it. */
function quietUntil(policy: Policy, channel: Channel, asOf: string): string | null {
  const win = policy.quiet_hours[channel];
  if (!win) return null;
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const [start, end, now] = [toMin(win.start), toMin(win.end), minutesOfDayWat(asOf)];
  const quiet = start > end ? now >= start || now < end : now >= start && now < end;
  if (!quiet) return null;
  const minutesAhead = (end - now + 1440) % 1440;
  return wat(ms(asOf) + minutesAhead * 60_000);
}

function compose(product: Product, triggers: Trigger[]) {
  const sentences = triggers.map((t) => TRIGGERS[t.type]?.sentence).filter(Boolean);
  const evidence = sentences.join(", and ");
  const lead = evidence ? evidence[0].toUpperCase() + evidence.slice(1) + ". " : "";
  const labels = triggers.map((t) => TRIGGERS[t.type]?.label).filter(Boolean);
  return {
    title: TITLES[product.id] ?? `${product.name} could help`,
    body: `${lead}${product.name} can help: ${product.features.map((f) => f.charAt(0).toLowerCase() + f.slice(1)).join(", ")}.`,
    why: `Based on your ${labels.join(" and ")}. You allowed personalised offers.`,
  };
}

function evaluate(db: Db, ref: string, asOf: string, mode: EvalMode): Decision {
  const c = getCustomer(db, ref);
  const policy = activePolicy(db);
  const consent = db.consent[ref];
  const trace: Decision["trace"] = { triggers: [], candidates: [], rules: [], policy_version: policy.id, model_version: db.model.version };
  const rules: RuleCheck[] = trace.rules;
  let product: Product | null = null;
  let channel: Channel | null = null;
  let message: Decision["message"] = null;
  let scheduled: string | undefined;

  const finish = (outcome: Outcome, reasons: ReasonCode[]): Decision => {
    const id = `dec_${hash(`${ref}|${product?.id ?? "none"}|${asOf}|${mode}|${c.epoch}`, 6)}`;
    const existing = db.decisions.find((d) => d.id === id);
    if (existing) return existing;
    const decision: Decision = {
      id, customer_ref: ref, as_of: asOf, mode, outcome, product_id: product?.id ?? null, channel, reasons, trace, message, simulated: true,
      ...(scheduled ? { scheduled_for: scheduled } : {}),
    };
    db.decisions.unshift(decision);
    emit(db, "decision_created", { customer_ref: ref, decision_id: id, outcome, reasons, mode });
    if (mode === "live" && outcome === "send" && product && channel && message) deliver(db, decision);
    return decision;
  };

  // 2. Consent gate: first, and nothing else is read without it
  if (!consent?.personalised_offers) {
    const code: ReasonCode = consent?.source === "stop_offers" ? "OPTED_OUT" : "NO_CONSENT";
    rules.push({ rule: code, passed: false, detail: "No profiling consent on file. Nothing else was read." });
    return finish("silent", [code]);
  }
  rules.push({ rule: "NO_CONSENT", passed: true, detail: `Consent from ${consent.source}, ${consent.updated_at.slice(0, 10)}` });
  if (c.complaint_open) {
    rules.push({ rule: "OPTED_OUT", passed: false, detail: "Open complaint on file; marketing is paused." });
    return finish("silent", ["OPTED_OUT"]);
  }
  rules.push({ rule: "OPTED_OUT", passed: true, detail: "No stop request and no open complaint." });

  // 3. Detect and screen
  const types = new Set([...c.triggers, ...c.patterns.map((p) => PATTERN_TRIGGER[p])]);
  for (const type of types) {
    const def = TRIGGERS[type];
    trace.triggers.push({ type, evidence: def.evidence, category: def.category, blocked: policy.blocked_trigger_categories.includes(def.category) });
  }
  const usable = trace.triggers.filter((t) => !t.blocked);
  const blocked = trace.triggers.filter((t) => t.blocked);
  rules.push({
    rule: "SENSITIVE_TRIGGER",
    passed: usable.length > 0,
    detail: blocked.length ? `${blocked.length} trigger screened out (${blocked.map((t) => t.category).join(", ")})` : "No blocked categories",
  });
  if (!usable.length) return blocked.length ? finish("hold", ["SENSITIVE_TRIGGER"]) : finish("silent", ["NO_MATCH"]);

  // 4. Match
  const productIds = [...new Set(usable.flatMap((t) => TRIGGERS[t.type].products))];
  const boost = 0.02 * c.patterns.length;
  for (const id of productIds) {
    const p = db.products.find((x) => x.id === id);
    if (!p) continue;
    const dropped = checkEligibility(c, p.eligibility.all);
    const uplift = round((BASE_UPLIFT[id] ?? 0.03) * c.uplift + boost);
    trace.candidates.push({ product_id: id, eligible: !dropped, uplift, ...(dropped ? { dropped } : {}) });
  }
  const eligible = trace.candidates.filter((x) => x.eligible).sort((a, b) => b.uplift - a.uplift);
  if (!eligible.length) {
    rules.push({ rule: "NO_MATCH", passed: false, detail: "Every candidate was dropped" });
    return finish("silent", ["NO_MATCH"]);
  }
  const productOf = (cand: Candidate) => db.products.find((p) => p.id === cand.product_id)!;
  product = productOf(eligible[0]);
  rules.push({ rule: "NO_MATCH", passed: true, detail: `${eligible.length} eligible` });

  // 5. Hard rules: customer-wide first, then each candidate in uplift order
  channel = CHANNELS.find((ch) => consent.channels[ch]) ?? null;
  rules.push({ rule: "NO_CHANNEL_CONSENT", passed: !!channel, detail: channel ? `Using ${channel}` : "No channel consented" });
  if (!channel) return finish("hold", ["NO_CHANNEL_CONSENT"]);

  const t = ms(asOf);
  const history = db.messages.filter((m) => m.customer_ref === ref && m.status !== "cancelled" && ms(m.delivered_at) <= t);
  const recent = history.filter((m) => ms(m.delivered_at) > t - 30 * DAY);
  const max = policy.max_messages_per_30d;
  rules.push({ rule: "CAP_30D", passed: recent.length < max, detail: `${recent.length} of ${max} used` });
  if (recent.length >= max) return finish("hold", ["CAP_30D"]);

  const gap = policy.same_product_gap_days;
  const blockedBy = (cand: Candidate): RuleCheck | null => {
    const name = productOf(cand).name;
    const same = history.find((m) => m.product_id === cand.product_id && ms(m.delivered_at) > t - gap * DAY);
    if (same) return { rule: "SAME_PRODUCT_60D", passed: false, detail: `${name} promoted on ${same.delivered_at.slice(0, 10)}` };
    const until = db.cooldowns[`${ref}:${cand.product_id}`];
    if (until && ms(until) > t) return { rule: "COOLDOWN_IGNORED", passed: false, detail: `${name} cooling down until ${until.slice(0, 10)}` };
    return null;
  };
  let best: Candidate | undefined;
  for (const cand of eligible) {
    if (best) {
      cand.dropped = "GOVERNOR_LOST";
      continue;
    }
    const block = blockedBy(cand);
    if (block) {
      cand.dropped = block.rule;
      rules.push(block);
    } else {
      best = cand;
    }
  }
  if (!best) return finish("hold", [eligible[0].dropped!]);
  product = productOf(best);
  rules.push({ rule: "SAME_PRODUCT_60D", passed: true, detail: `${product.name} not promoted in ${gap} days` });
  rules.push({ rule: "COOLDOWN_IGNORED", passed: true, detail: `No cooldown on ${product.name}` });

  message = compose(product, usable);
  if (product.is_credit && policy.credit_requires_review) {
    rules.push({ rule: "CREDIT_REVIEW", passed: false, detail: "Credit product, a person must approve" });
    const waiting = db.decisions.find((x) => x.customer_ref === ref && x.product_id === product!.id && x.outcome === "review" && !x.review && x.mode === mode);
    if (waiting) return waiting;
    return finish("review", ["CREDIT_REVIEW"]);
  }

  // 6. Learned rule: can only make the system quieter
  rules.push({ rule: "LOW_UPLIFT", passed: best.uplift >= policy.min_uplift, detail: `${best.uplift} vs threshold ${policy.min_uplift}` });
  if (best.uplift < policy.min_uplift) {
    message = null;
    return finish("hold", ["LOW_UPLIFT"]);
  }
  rules.push({ rule: "ATTENTION_BUDGET", passed: true, detail: `${max - recent.length} of ${max} left` });

  // 8. Explain + guardrail
  rules.push({ rule: "GUARDRAIL_BLOCKED", passed: true, detail: "No sensitive content in the message" });

  // 9. Quiet hours reschedule instead of dropping
  scheduled = quietUntil(policy, channel, asOf) ?? undefined;
  rules.push({ rule: "QUIET_HOURS", passed: !scheduled, detail: scheduled ? `Rescheduled to ${scheduled.slice(11, 16)}` : "Inside the send window" });
  return finish("send", scheduled ? ["OK", "QUIET_HOURS"] : ["OK"]);
}

function deliver(db: Db, d: Decision) {
  const at = d.scheduled_for ?? d.as_of;
  const msg: Message = {
    id: `msg_${hash(d.id, 6)}`,
    decision_id: d.id,
    customer_ref: d.customer_ref,
    product_id: d.product_id!,
    channel: d.channel!,
    title: d.message!.title,
    body: d.message!.body,
    why: d.message!.why,
    delivered_at: at,
    // Only quiet hours push a message later than the decision itself
    status: d.scheduled_for ? "scheduled" : "delivered",
    simulated: true,
  };
  db.messages.unshift(msg);
  emit(db, "message_delivered", { customer_ref: d.customer_ref, message_id: msg.id, channel: msg.channel, product_id: msg.product_id });
}

function requireSim(db: Db): string {
  if (!db.sim.running || !db.sim.clock) fail(409, "SIM_NOT_STARTED", "Start the simulator first (POST /sim/start).");
  return db.sim.clock;
}

function countOutcomes(decisions: Decision[]): Counts {
  const counts: Counts = { send: 0, hold: 0, silent: 0, review: 0 };
  for (const d of decisions) if (d.outcome !== "shown") counts[d.outcome] += 1;
  return counts;
}

function validatePolicy(p: PolicyDraft) {
  const bad = (field: string, why: string) => fail(422, "VALIDATION_ERROR", `${field}: ${why}`);
  if (!Number.isInteger(p.max_messages_per_30d) || p.max_messages_per_30d < 0) bad("max_messages_per_30d", "whole number, 0 or more");
  if (!Number.isInteger(p.same_product_gap_days) || p.same_product_gap_days < 0) bad("same_product_gap_days", "whole number, 0 or more");
  if (!Number.isInteger(p.cooldown_after_ignored_days) || p.cooldown_after_ignored_days < 0) bad("cooldown_after_ignored_days", "whole number, 0 or more");
  if (!(p.min_uplift >= 0 && p.min_uplift <= 1)) bad("min_uplift", "between 0 and 1");
  for (const [ch, w] of Object.entries(p.quiet_hours ?? {})) {
    if (!/^\d\d:\d\d$/.test(w?.start ?? "") || !/^\d\d:\d\d$/.test(w?.end ?? "")) bad(`quiet_hours.${ch}`, "use HH:MM");
  }
}

function validateProduct(p: Partial<Product>, requireId: boolean) {
  const bad = (why: string) => fail(422, "VALIDATION_ERROR", why);
  if (requireId && !/^prd_[a-z0-9_]+$/.test(p.id ?? "")) bad("id must look like prd_name");
  if (!p.name?.trim()) bad("name is required");
  if (!p.category?.trim()) bad("category is required");
  if (!Array.isArray(p.eligibility?.all)) bad('eligibility must be { "all": [rules] }');
  for (const r of p.eligibility!.all) if (!r.fact || !r.op) bad("each eligibility rule needs fact, op and value");
}

function simulatePolicy(db: Db, p: PolicyDraft) {
  const n = db.sim.running ? db.sim.n_customers : 5000;
  const noConsent = Math.round(n * 0.17);
  const sensitive = Math.round(n * 0.006 * p.blocked_trigger_categories.length);
  const noMatch = Math.round((n - noConsent) * 0.21);
  let pool = n - noConsent - sensitive - noMatch;
  const take = (share: number) => {
    const k = Math.round(pool * clamp(share, 0, 0.95));
    pool -= k;
    return k;
  };
  const by_reason: Partial<Record<ReasonCode, number>> = {
    NO_CONSENT: noConsent,
    SENSITIVE_TRIGGER: sensitive,
    NO_MATCH: noMatch,
    CAP_30D: take(0.3 - 0.09 * (p.max_messages_per_30d - 2)),
    SAME_PRODUCT_60D: take(0.0012 * p.same_product_gap_days),
    COOLDOWN_IGNORED: take(0.004 * p.cooldown_after_ignored_days),
    CREDIT_REVIEW: p.credit_requires_review ? take(0.03) : 0,
    LOW_UPLIFT: take(0.12 + (p.min_uplift - 0.02) * 6),
  };
  const hold = (["SENSITIVE_TRIGGER", "CAP_30D", "SAME_PRODUCT_60D", "COOLDOWN_IGNORED", "LOW_UPLIFT"] as const).reduce((s, k) => s + (by_reason[k] ?? 0), 0);
  by_reason.OK = pool;
  return {
    counts: { send: pool, hold, silent: noConsent + noMatch, review: by_reason.CREDIT_REVIEW ?? 0 },
    by_reason,
    population: n,
    simulated: true as const,
  };
}

const page = <T>(items: T[], query: Record<string, unknown>) => {
  const limit = Number(query.limit ?? 50);
  const start = Number(query.cursor ?? 0);
  const end = start + limit;
  return { items: items.slice(start, end), next_cursor: end < items.length ? String(end) : null };
};

// ---------- routes ----------

type Ctx = { db: Db; params: string[]; body: any; query: Record<string, unknown>; role?: Role };
type Route = [method: string, pattern: RegExp, handler: (ctx: Ctx) => unknown];

const routes: Route[] = [
  ["GET", /^\/health$/, () => ({ status: "ok", env: "mock", version: "0.1.0" })],

  // 5.5 Customer accounts
  ["POST", /^\/auth\/signup$/, ({ db, body }) => {
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!String(body.name ?? "").trim()) fail(422, "VALIDATION_ERROR", "Name is required.");
    if (phone.length < 10 || phone.length > 14) fail(422, "VALIDATION_ERROR", "Enter a phone number with 10 to 14 digits.");
    if (String(body.password ?? "").length < 6) fail(422, "VALIDATION_ERROR", "Password must be at least 6 characters.");
    if (!(body.persona in PERSONAS)) fail(422, "VALIDATION_ERROR", "Choose a persona.");
    if (byPhone(db, phone)) fail(409, "PHONE_TAKEN", "An account with this phone number already exists.");
    const c = addCustomer(db, fromPersona(body.name.trim(), phone, body.password, body.persona), body.consent ?? {}, "signup", db.sim.clock ?? wat(Date.now()));
    return { customer: publicCustomer(c), token: `demo_${hash(c.customer_ref + Date.now(), 12)}` };
  }],
  ["POST", /^\/auth\/signin$/, ({ db, body }) => {
    const c = byPhone(db, String(body.phone ?? "").replace(/\D/g, ""));
    if (!c || !c.password || c.password !== body.password) fail(401, "INVALID_CREDENTIALS", "Phone number or password is wrong.");
    return { customer: publicCustomer(c), token: `demo_${hash(c.customer_ref + Date.now(), 12)}` };
  }],
  ["GET", /^\/customers\/(cus_\w+)$/, ({ db, params }) => publicCustomer(getCustomer(db, params[0]))],

  // 5.1 Decisions
  ["POST", /^\/decisions\/evaluate$/, ({ db, body }) => {
    const clock = requireSim(db);
    return evaluate(db, body.customer_ref, body.as_of || clock, body.mode === "live" ? "live" : "dry_run");
  }],
  ["POST", /^\/decisions\/batch$/, ({ db, body }) => {
    const clock = requireSim(db);
    const ids: string[] = body.segment?.ids?.length ? body.segment.ids : Object.keys(db.customers);
    const decisions = ids.map((id) => evaluate(db, id, body.as_of || clock, body.mode === "live" ? "live" : "dry_run"));
    return { decisions, counts: countOutcomes(decisions), simulated: true };
  }],
  ["GET", /^\/decisions$/, ({ db, query }) => {
    const since = query.since ? ms(String(query.since)) : null;
    // In live mode only show what the API decided, not the mock's sample population
    const source = getMode() === "live" ? db.decisions.filter((d) => db.liveDecisionIds.includes(d.id)) : db.decisions;
    const items = source.filter((d) =>
      (!query.outcome || d.outcome === query.outcome) &&
      (!query.reason || d.reasons.includes(query.reason as ReasonCode)) &&
      (!query.product_id || d.product_id === query.product_id) &&
      (!query.customer_ref || d.customer_ref === query.customer_ref) &&
      (since === null || ms(d.as_of) >= since));
    return page(items, query);
  }],
  ["GET", /^\/decisions\/(dec_\w+)$/, ({ db, params }) =>
    db.decisions.find((d) => d.id === params[0]) ?? fail(404, "DECISION_NOT_FOUND", `No decision ${params[0]}.`)],
  ["POST", /^\/decisions\/(dec_\w+)\/(approve|reject)$/, ({ db, params, body, role }) => {
    requireRole(role, ["compliance", "campaign_manager"]);
    const d = db.decisions.find((x) => x.id === params[0]) ?? fail(404, "DECISION_NOT_FOUND", `No decision ${params[0]}.`);
    if (d.outcome !== "review" || d.review) fail(409, "NOT_IN_REVIEW", "This decision is not waiting for review.");
    const approved = params[1] === "approve";
    if (!approved && !String(body.reason ?? "").trim()) fail(422, "VALIDATION_ERROR", "Give a reason for rejecting.");
    d.review = { action: approved ? "approved" : "rejected", by: role!, at: db.sim.clock ?? wat(Date.now()), note: approved ? body.note : body.reason };
    if (approved && d.channel && d.message) deliver(db, d);
    emit(db, "outcome_recorded", { customer_ref: d.customer_ref, decision_id: d.id, review: d.review.action });
    return d;
  }],

  // 5.2 Customer surface
  ["GET", /^\/customers\/(cus_\w+)\/inbox$/, ({ db, params, query }) => {
    getCustomer(db, params[0]);
    return page(db.messages.filter((m) => m.customer_ref === params[0] && m.status !== "cancelled"), query);
  }],
  ["POST", /^\/messages\/(msg_\w+)\/respond$/, ({ db, params, body }) => {
    const m = db.messages.find((x) => x.id === params[0]) ?? fail(404, "MESSAGE_NOT_FOUND", `No message ${params[0]}.`);
    const at = db.sim.clock ?? wat(Date.now());
    const c = getCustomer(db, m.customer_ref);
    let consent: Consent | undefined;
    switch (body.action) {
      case "opened":
        if (m.status === "delivered" || m.status === "scheduled") m.status = "opened";
        break;
      case "accepted":
        m.status = "accepted";
        if (!c.holdings.includes(m.product_id)) c.holdings.push(m.product_id);
        invalidate(db, c.customer_ref);
        break;
      case "not_now":
        m.status = "not_now";
        db.cooldowns[`${c.customer_ref}:${m.product_id}`] = wat(ms(at) + 60 * DAY);
        invalidate(db, c.customer_ref);
        if (db.consent[c.customer_ref]?.personalised_offers) earn(db, c.customer_ref, "offer_feedback", `${c.customer_ref}|offer_feedback|${m.product_id}`);
        break;
      case "stop_offers":
        consent = writeConsent(db, c.customer_ref, { ...db.consent[c.customer_ref], personalised_offers: false }, "stop_offers", at);
        break;
      default:
        fail(422, "VALIDATION_ERROR", "action must be opened, accepted, not_now or stop_offers.");
    }
    emit(db, "outcome_recorded", { customer_ref: c.customer_ref, message_id: m.id, action: body.action });
    return { message: m, ...(consent ? { consent } : {}) };
  }],
  ["GET", /^\/messages\/(msg_\w+)\/why$/, ({ db, params }) => {
    const m = db.messages.find((x) => x.id === params[0]) ?? fail(404, "MESSAGE_NOT_FOUND", `No message ${params[0]}.`);
    const d = db.decisions.find((x) => x.id === m.decision_id);
    const data_categories = (d?.trace.triggers ?? []).filter((t) => !t.blocked).map((t) => TRIGGERS[t.type]?.label ?? t.type);
    return { message_id: m.id, why: m.why, data_categories, consent_url: "/app?tab=settings" };
  }],
  ["GET", /^\/customers\/(cus_\w+)\/consent$/, ({ db, params }) => {
    getCustomer(db, params[0]);
    return db.consent[params[0]] ?? fail(404, "CONSENT_NOT_FOUND", "No consent on file.");
  }],
  ["PUT", /^\/customers\/(cus_\w+)\/consent$/, ({ db, params, body, role }) => {
    requireRole(role, ["customer", "dpo"]);
    getCustomer(db, params[0]);
    if (typeof body.personalised_offers !== "boolean" || typeof body.channels !== "object") {
      fail(422, "VALIDATION_ERROR", "Send personalised_offers (boolean) and channels.");
    }
    const before = db.consent[params[0]]?.personalised_offers;
    const consent = writeConsent(db, params[0], body, role === "dpo" ? "dpo_console" : "app_settings", db.sim.clock ?? wat(Date.now()));
    if (consent.personalised_offers && !before) earn(db, params[0], "consent_granted", `${params[0]}|consent_granted`);
    return consent;
  }],

  // Phone: recommendations and rewards
  ["GET", /^\/customers\/(cus_\w+)\/for-you$/, ({ db, params }) => {
    const c = getCustomer(db, params[0]);
    const offers = db.consent[c.customer_ref]?.personalised_offers;
    const item = (p: Product, rank: number, why: string): ForYouItem => ({
      rank, product_id: p.id, name: p.name, why, gain: GAINS[p.id] ?? null, key_facts: p.key_facts ?? [], compare: [],
    });
    if (!offers) {
      const general = db.products.filter((p) => !p.is_credit).slice(0, 3);
      return { personalised: false, items: general.map((p, i) => item(p, i + 1, "Available to all customers.")), note: null, simulated: true };
    }
    const types = new Set([...c.triggers, ...c.patterns.map((pt) => PATTERN_TRIGGER[pt])]);
    const policy = activePolicy(db);
    const usable = [...types].map((t) => ({ type: t, def: TRIGGERS[t] })).filter((t) => t.def && !policy.blocked_trigger_categories.includes(t.def.category));
    const scored = [...new Set(usable.flatMap((t) => t.def.products))]
      .map((id) => db.products.find((p) => p.id === id))
      .filter((p): p is Product => !!p && !p.is_credit && !checkEligibility(c, p.eligibility.all))
      .map((p) => ({ p, uplift: (BASE_UPLIFT[p.id] ?? 0.03) * c.uplift }))
      .sort((a, b) => b.uplift - a.uplift)
      .slice(0, 3);
    const labels = usable.map((t) => t.def.label);
    const why = `Based on your ${labels.join(" and ")}. You allowed personalised offers.`;
    const items = scored.map(({ p }, i) => item(p, i + 1, why));
    if (items.length < 3) {
      items.push({
        rank: items.length + 1, product_id: "prd_talk_loans", name: "Talk to us about loans",
        why: "A credit product needs a person to review it with you.", gain: null,
        key_facts: ["No obligation.", "Speak to a banker about your needs."], compare: [],
      });
    }
    return { personalised: true, items, note: scored.length ? null : "No products fit you now.", simulated: true };
  }],
  ["GET", /^\/customers\/(cus_\w+)\/rewards$/, ({ db, params }) => {
    getCustomer(db, params[0]);
    return rewardsView(db, params[0]);
  }],
  ["GET", /^\/rewards\/catalogue$/, () => ({ catalogue: REWARD_CATALOGUE, simulated: true })],
  ["POST", /^\/customers\/(cus_\w+)\/rewards\/redeem$/, ({ db, params, body }) => {
    getCustomer(db, params[0]);
    const item = REWARD_CATALOGUE.find((r) => r.id === body.reward_id) ?? fail(404, "REWARD_NOT_FOUND", "Reward not found.");
    const acct = (db.rewards[params[0]] ??= { balance: 0, lifetime: 0, keys: [] });
    if (acct.balance < item.points) fail(402, "INSUFFICIENT_POINTS", "Not enough points.");
    acct.balance -= item.points;
    const at = db.sim.clock ?? wat(Date.now());
    emit(db, "points_redeemed", { customer_ref: params[0], reward_id: item.id, points: item.points, balance: acct.balance });
    return { customer_ref: params[0], balance: acct.balance, receipt: { redemption_id: `rdm_${hash(`${params[0]}|${item.id}|${acct.keys.length}|${Date.now()}`, 8)}`, status: "fulfilled", at } };
  }],

  // 5.3 Console
  ["GET", /^\/metrics\/overview$/, ({ db }) => {
    const n = db.sim.running ? db.sim.n_customers : 0;
    const real = countOutcomes(db.decisions);
    const optOuts = Object.values(db.consent).filter((c) => c.source === "stop_offers").length;
    const totals = channelStats(db).total;
    return {
      sent: Math.round(n * 0.082) + real.send,
      held: Math.round(n * 0.224) + real.hold,
      silent: Math.round(n * 0.17) + real.silent,
      review: Math.round(n * 0.006) + real.review,
      opt_outs: Math.round(n * 0.0009) + optOuts,
      sustained_use_60d: 0.41,
      window_days: 30,
      as_of: db.sim.clock ?? wat(Date.now()),
      notifications_sent: totals.sent,
      click_rate: totals.click_rate,
      product_uptake: totals.product_uptake,
      control_group_uptake: 0.022,
      simulated: true,
    };
  }],
  ["GET", /^\/metrics\/by-channel$/, ({ db }) => ({ window_days: 30, ...channelStats(db), simulated: true })],
  ["GET", /^\/metrics\/by-product$/, ({ db }) => {
    const n = db.sim.running ? db.sim.n_customers : 0;
    const weights = [0.34, 0.18, 0.22, 0.14, 0.12];
    const items = db.products.map((p, i) => {
      const w = weights[i] ?? 0.05;
      const mine = db.decisions.filter((d) => d.product_id === p.id);
      return {
        product_id: p.id,
        name: p.name,
        sent: Math.round(n * 0.082 * w) + mine.filter((d) => d.outcome === "send").length,
        held: Math.round(n * 0.224 * w) + mine.filter((d) => d.outcome === "hold").length,
        opt_outs: Math.round(n * 0.0009 * w),
        sustained_use_60d: round(0.3 + ((i * 37) % 25) / 100, 2),
      };
    });
    return { items, simulated: true };
  }],
  ["GET", /^\/policies$/, ({ db }) => ({ active_id: activePolicy(db).id, items: [...db.policies].reverse() })],
  ["PUT", /^\/policies$/, ({ db, body }) => {
    validatePolicy(body);
    const n = Math.max(...db.policies.map((p) => Number(p.id.replace("pol_v", "")))) + 1;
    const { id: _i, status: _s, created_at: _c, approved_by: _a, ...draft } = body;
    const policy: Policy = { ...draft, id: `pol_v${n}`, status: "draft", created_at: db.sim.clock ?? wat(Date.now()) };
    db.policies.push(policy);
    emit(db, "policy_changed", { policy_id: policy.id, status: "draft" });
    return policy;
  }],
  ["POST", /^\/policies\/(pol_v\d+)\/approve$/, ({ db, params, role }) => {
    requireRole(role, ["compliance"]);
    const p = db.policies.find((x) => x.id === params[0]) ?? fail(404, "POLICY_NOT_FOUND", `No policy ${params[0]}.`);
    if (p.status !== "draft") fail(409, "NOT_DRAFT", "Only drafts can be approved.");
    for (const other of db.policies) if (other.status === "active") other.status = "retired";
    p.status = "active";
    p.approved_by = role;
    for (const ref of Object.keys(db.customers)) invalidate(db, ref);
    emit(db, "policy_changed", { policy_id: p.id, status: "active" });
    return p;
  }],
  ["POST", /^\/policies\/simulate$/, ({ db, body }) => {
    validatePolicy(body);
    return simulatePolicy(db, body);
  }],
  ["GET", /^\/products$/, ({ db, query }) => page(db.products, query)],
  ["POST", /^\/products$/, ({ db, body }) => {
    validateProduct(body, true);
    if (db.products.some((p) => p.id === body.id)) fail(409, "PRODUCT_EXISTS", `${body.id} already exists. Edit it instead.`);
    const product: Product = { ...body, features: body.features ?? [], is_credit: Boolean(body.is_credit), version: 1 };
    db.products.push(product);
    return product;
  }],
  ["PUT", /^\/products\/(prd_\w+)$/, ({ db, params, body }) => {
    const i = db.products.findIndex((p) => p.id === params[0]);
    if (i < 0) fail(404, "PRODUCT_NOT_FOUND", `No product ${params[0]}.`);
    validateProduct(body, false);
    db.products[i] = { ...body, id: params[0], is_credit: Boolean(body.is_credit), version: db.products[i].version + 1 };
    return db.products[i];
  }],
  ["POST", /^\/campaign-requests$/, ({ db, body }) => {
    const product = db.products.find((p) => p.id === body.product_id) ?? fail(422, "VALIDATION_ERROR", "Unknown product_id.");
    const segment = String(body.audience?.segment ?? "");
    if (!SEGMENTS.includes(segment)) fail(422, "VALIDATION_ERROR", `segment must be one of ${SEGMENTS.join(", ")}.`);
    const priority = clamp(Number(body.priority) || 1, 1, 5);
    const n = db.sim.running ? db.sim.n_customers : 5000;
    const reached = segment === "all" ? n : Math.round(n * (({ salaried: 0.46, trader: 0.12, sme: 0.09, student: 0.14 } as Record<string, number>)[segment] ?? 0.1));
    const held_by_rules = Math.round(reached * (product.is_credit ? 0.55 : 0.42));
    const won = Math.round((reached - held_by_rules) * clamp(0.25 + 0.1 * priority, 0, 0.9));
    const at = db.sim.clock ?? wat(Date.now());
    const campaign: CampaignRequest = {
      id: `cr_${hash(`${body.product_id}|${segment}|${priority}|${db.campaigns.length}`)}`,
      product_id: product.id, audience: { segment }, priority, status: "done",
      reached, won, governor_lost: reached - held_by_rules - won, held_by_rules, created_at: at, simulated: true,
    };
    db.campaigns.unshift(campaign);
    return campaign;
  }],
  ["GET", /^\/campaign-requests\/(cr_\w+)$/, ({ db, params }) =>
    db.campaigns.find((c) => c.id === params[0]) ?? fail(404, "CAMPAIGN_NOT_FOUND", `No campaign request ${params[0]}.`)],
  ["GET", /^\/audit\/log$/, ({ db, query }) => page(auditEntries(db), query)],
  ["GET", /^\/audit\/export$/, ({ db }) => ({ entries: auditEntries(db), exported_at: wat(Date.now()) })],

  // 5.4 Demo control and evidence
  ["POST", /^\/sim\/start$/, ({ db, body }) => {
    const n = Number(body.n_customers), days = Number(body.days), seed = Number(body.seed);
    if (!Number.isInteger(seed)) fail(422, "VALIDATION_ERROR", "seed must be a whole number.");
    if (!(n >= 1 && n <= 100_000)) fail(422, "VALIDATION_ERROR", "n_customers must be between 1 and 100000.");
    if (!(days >= 1 && days <= 365)) fail(422, "VALIDATION_ERROR", "days must be between 1 and 365.");
    db.sim = { running: true, seed, n_customers: n, days, scenario: String(body.scenario || "baseline"), clock: START_CLOCK, simulated: true };
    return db.sim;
  }],
  ["POST", /^\/sim\/reset$/, ({ db }) => {
    const fresh = seedDb();
    // Keep accounts people signed up with, but reset their history
    for (const [ref, c] of Object.entries(db.customers)) {
      if (!fresh.customers[ref] && c.password) {
        fresh.customers[ref] = { ...c, holdings: c.persona ? [...PERSONAS[c.persona].holdings] : c.holdings, patterns: [], epoch: 0 };
        fresh.consent[ref] = db.consent[ref];
      }
    }
    Object.assign(db, fresh, { sim: { ...fresh.sim, running: false, clock: null } });
    return db.sim;
  }],
  ["POST", /^\/sim\/inject$/, ({ db, body }) => {
    requireSim(db);
    if (!(body.pattern in PATTERN_TRIGGER)) fail(422, "VALIDATION_ERROR", "pattern must be salary_pattern, fee_season or sme_growth.");
    if (body.customer_ref) {
      const c = getCustomer(db, body.customer_ref);
      if (!c.patterns.includes(body.pattern)) c.patterns.push(body.pattern);
      invalidate(db, c.customer_ref);
      return { pattern: body.pattern, customer_ref: c.customer_ref, affected: 1 };
    }
    return { pattern: body.pattern, customer_ref: null, affected: Math.round(db.sim.n_customers * 0.05) };
  }],
  ["GET", /^\/sim\/state$/, ({ db }) => db.sim],
  ["POST", /^\/experiments\/run$/, ({ db, body }) => {
    const strategies: Strategy[] = (body.strategies ?? []).filter((s: string) => ["blast", "caps_only", "matchpoint"].includes(s));
    if (!strategies.length) fail(422, "VALIDATION_ERROR", "Pick at least one strategy.");
    const seed = Number(body.seed) || 42;
    const days = clamp(Number(body.days) || 90, 1, 365);
    const r = rng(seed);
    const j = () => 1 + (r() - 0.5) * 0.1;
    const scale = days / 90;
    const base: Record<Strategy, Omit<StrategyResult, "strategy">> = {
      blast: { messages_per_customer: 6.4 * scale, opt_out_rate: 0.081, sustained_adoption_60d: 0.029, fatigue_index: 0.68 },
      caps_only: { messages_per_customer: 1.9 * scale, opt_out_rate: 0.031, sustained_adoption_60d: 0.034, fatigue_index: 0 },
      matchpoint: { messages_per_customer: 0.8 * scale, opt_out_rate: 0.007, sustained_adoption_60d: 0.051, fatigue_index: 0, uplift_recovery: 0.62 },
    };
    const results = strategies.map((s) => {
      const b = base[s];
      return {
        strategy: s,
        messages_per_customer: round(b.messages_per_customer * j(), 2),
        opt_out_rate: round(b.opt_out_rate * j()),
        sustained_adoption_60d: round(b.sustained_adoption_60d * j()),
        fatigue_index: round(b.fatigue_index * j(), 2),
        ...(b.uplift_recovery ? { uplift_recovery: round(b.uplift_recovery * j(), 2) } : {}),
      };
    });
    const exp: Experiment = {
      id: `exp_${hash(`${seed}|${days}|${strategies.join(",")}`)}`,
      seed, days, status: "done", results, created_at: wat(Date.now()), simulated: true,
    };
    db.experiments = [exp, ...db.experiments.filter((e) => e.id !== exp.id)];
    return exp;
  }],
  ["GET", /^\/experiments\/(exp_\w+)$/, ({ db, params }) =>
    db.experiments.find((e) => e.id === params[0]) ?? fail(404, "EXPERIMENT_NOT_FOUND", `No experiment ${params[0]}.`)],
  ["POST", /^\/model\/train$/, ({ db }) => {
    const minor = Number(db.model.version.split(".")[1] ?? 0) + 1;
    db.model = { version: `upl_0.${minor}`, qini: round(0.24 + rng(minor)() * 0.08), trained_at: wat(Date.now()), simulated: true };
    return db.model;
  }],
  ["GET", /^\/model\/info$/, ({ db }) => db.model],
];

// Audit summaries are written for compliance staff, not developers
const CHANNEL_NAME: Record<Channel, string> = { app: "In-app", whatsapp: "WhatsApp", sms: "SMS", email: "Email", ussd: "USSD" };
const words = (s: string) => s.replace(/_/g, " ");

function auditEntries(db: Db): AuditEntry[] {
  const productName = (id: string | null) => db.products.find((p) => p.id === id)?.name ?? (id ? words(id) : "");
  const entries: AuditEntry[] = [
    ...db.decisions.map((d) => {
      const reason = d.reasons.find((r) => r !== "OK");
      const parts = [d.customer_ref, OUTCOME_LABEL[d.outcome], productName(d.product_id), reason ? REASON_LABEL[reason] : ""];
      return { at: d.as_of, kind: "decision" as const, ref: d.id, summary: parts.filter(Boolean).join(" · ") };
    }),
    ...db.ledger.map((c) => ({
      at: c.updated_at, kind: "consent" as const, ref: c.customer_ref,
      summary: [
        `Personalised offers ${c.personalised_offers ? "on" : "off"}`,
        CHANNELS.filter((ch) => c.channels[ch]).map((ch) => CHANNEL_NAME[ch]).join(", ") || "No channels",
        `via ${words(c.source ?? "api")}`,
      ].join(" · "),
    })),
    ...db.policies.map((p) => ({
      at: p.created_at, kind: "policy" as const, ref: p.id,
      summary: `${p.status.charAt(0).toUpperCase()}${p.status.slice(1)}${p.approved_by ? ` · approved by ${words(p.approved_by)}` : ""}`,
    })),
  ];
  return entries.sort((a, b) => ms(b.at) - ms(a.at));
}

export async function mockRequest<T>(path: string, { method = "GET", body, query, role }: RequestOptions): Promise<T> {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 160));
  const route = routes.find(([m, re]) => m === method && re.test(path));
  if (!route) fail(404, "NOT_FOUND", `${method} ${path} is not in the mock.`);
  if (role && role !== "customer" && !STAFF_ROLES.includes(role)) fail(400, "BAD_ROLE", `Unknown role ${role}.`);

  const db = loadDb();
  try {
    const result = route[2]({ db, params: path.match(route[1])!.slice(1), body: body ?? {}, query: query ?? {}, role });
    save(KEYS.mockDb, db);
    flush();
    return structuredClone(result) as T;
  } catch (e) {
    pending.length = 0;
    throw e;
  }
}
