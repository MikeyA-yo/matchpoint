import { fmtTime } from "./format";
import type { Channel, Decision, ReasonCode } from "./types";

export const VIA: Record<Channel, string> = { app: "in the app", whatsapp: "on WhatsApp", sms: "by SMS", email: "by email" };

export interface PlainDecision {
  headline: string;
  text: string;
  tone: "sent" | "check" | "held" | "quiet";
}

/** Turns a decision into what a customer would understand, without codes or jargon. */
export function describeDecision(d: Decision, productName: string): PlainDecision {
  const product = productName ? productName.toLowerCase() : "a product";
  const reason: ReasonCode = d.reasons.find((r) => r !== "OK") ?? d.reasons[0];

  if (d.outcome === "send") {
    const via = d.channel ? ` ${VIA[d.channel]}` : "";
    const timing = d.scheduled_for ? ` We timed it for ${fmtTime(d.scheduled_for)} so it wouldn't disturb you at night.` : "";
    return { headline: "Offer sent", text: `We sent you an offer for a ${product}${via}.${timing}`, tone: "sent" };
  }

  if (d.outcome === "review") {
    if (d.review?.action === "approved") {
      return { headline: "Offer sent after a check", text: `Our team checked the ${product} offer and sent it to you.`, tone: "sent" };
    }
    if (d.review?.action === "rejected") {
      return { headline: "Offer not sent", text: `Our team checked the ${product} offer and decided it wasn't right for you.`, tone: "quiet" };
    }
    return {
      headline: "Being checked first",
      text: `A ${product} might suit you. Because it's a loan, a person on our team checks it before you hear about it.`,
      tone: "check",
    };
  }

  const held: Partial<Record<ReasonCode, string>> = {
    CAP_30D: "We held back an offer so you don't get too many messages in one month.",
    ATTENTION_BUDGET: "We held back an offer so you don't get too many messages in one month.",
    SAME_PRODUCT_60D: `You heard about the ${product} recently, so we didn't repeat ourselves.`,
    COOLDOWN_IGNORED: `You said "not now" to the ${product}, so we're giving it a rest.`,
    LOW_UPLIFT: `We found a ${product}, but it wasn't likely to make enough difference for you to be worth a message.`,
    NO_CHANNEL_CONSENT: "We had something for you, but you haven't chosen a way for us to reach you.",
    SENSITIVE_TRIGGER: "Some of your spending is private, and we never use it for offers.",
    GOVERNOR_LOST: "Another offer was more useful to you, so we only sent that one.",
    GUARDRAIL_BLOCKED: "We stopped a message that didn't meet our standards.",
  };
  const quiet: Partial<Record<ReasonCode, string>> = {
    NO_CONSENT: "You haven't agreed to personalised offers, so we didn't look at your activity.",
    OPTED_OUT: "You turned off offers, so we didn't look at your activity.",
    NO_MATCH: "Nothing we offer fits you right now, so we didn't message you.",
  };

  if (d.outcome === "hold") {
    return { headline: "Held back", text: held[reason] ?? "We decided not to message you this time.", tone: "held" };
  }
  return { headline: "Stayed quiet", text: quiet[reason] ?? "We didn't message you.", tone: "quiet" };
}
