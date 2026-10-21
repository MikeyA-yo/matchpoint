import { CHANNEL_LABEL, fmtTime, humanize } from "./format";
import { segmentLabel } from "./personas";
import type { Channel, Decision, EligibilityRule, ReasonCode } from "./types";

export const VIA: Record<Channel, string> = {
  app: "in the app",
  whatsapp: "on WhatsApp",
  sms: "by SMS",
  email: "by email",
  ussd: "by USSD",
};

export interface PlainDecision {
  /** One word: Sent, Held, Not sent, In review, Declined */
  status: string;
  /** Short reason or destination, no codes */
  detail: string;
  tone: "sent" | "check" | "held" | "quiet";
}

const HELD: Partial<Record<ReasonCode, string>> = {
  CAP_30D: "Monthly message limit reached",
  ATTENTION_BUDGET: "Monthly message limit reached",
  SAME_PRODUCT_60D: "Already offered in the last 60 days",
  COOLDOWN_IGNORED: "You chose Not now",
  LOW_UPLIFT: "Low expected benefit",
  NO_CHANNEL_CONSENT: "No contact channel allowed",
  SENSITIVE_TRIGGER: "Based on excluded spending",
  GOVERNOR_LOST: "Another offer took priority",
  GUARDRAIL_BLOCKED: "Message failed content check",
};

const NOT_SENT: Partial<Record<ReasonCode, string>> = {
  NO_CONSENT: "Personalised offers are off",
  OPTED_OUT: "Offers paused on this account",
  NO_MATCH: "No suitable product",
};

/** A decision as a short log line: status, plus product and reason in plain words. */
export function describeDecision(d: Decision, productName: string): PlainDecision {
  const reason: ReasonCode = d.reasons.find((r) => r !== "OK") ?? d.reasons[0];
  const withProduct = (text: string) => (productName ? `${productName} · ${text}` : text);

  if (d.outcome === "send") {
    const when = d.scheduled_for ? `, scheduled ${fmtTime(d.scheduled_for)}` : "";
    return { status: "Sent", detail: withProduct(`${d.channel ? CHANNEL_LABEL[d.channel] : "Sent"}${when}`), tone: "sent" };
  }
  if (d.outcome === "review") {
    if (d.review?.action === "approved") return { status: "Sent", detail: withProduct("approved by staff"), tone: "sent" };
    if (d.review?.action === "rejected") return { status: "Declined", detail: withProduct("declined by staff"), tone: "quiet" };
    return { status: "In review", detail: withProduct("awaiting staff approval"), tone: "check" };
  }
  if (d.outcome === "hold") {
    const text = HELD[reason] ?? "Held";
    // Reasons about the customer as a whole read better without a product name
    const productless = reason === "CAP_30D" || reason === "ATTENTION_BUDGET" || reason === "NO_CHANNEL_CONSENT";
    return { status: "Held", detail: productless ? text : withProduct(text.charAt(0).toLowerCase() + text.slice(1)), tone: "held" };
  }
  return { status: "Not sent", detail: NOT_SENT[reason] ?? "No message", tone: "quiet" };
}

/** An eligibility rule as staff would say it, e.g. "Age 18+" or "Doesn't already have Personal loan". */
export function describeRule(r: EligibilityRule, productName: (id: string) => string): string {
  const v = r.value;
  if (r.fact === "age" && r.op === ">=") return `Age ${v}+`;
  if (r.fact === "age" && r.op === "<=") return `Age up to ${v}`;
  if (r.fact === "holds" && r.op === "not_contains") return `Doesn't already have ${productName(String(v))}`;
  if (r.fact === "holds" && r.op === "contains") return `Has ${productName(String(v))}`;
  if (r.fact === "segment" && r.op === "in" && Array.isArray(v)) return `${v.map((s) => segmentLabel(String(s))).join(" or ")} customers`;
  if (r.fact === "segment" && r.op === "==") return `${segmentLabel(String(v))} customers`;
  return `${humanize(r.fact)} ${r.op} ${JSON.stringify(v)}`;
}
