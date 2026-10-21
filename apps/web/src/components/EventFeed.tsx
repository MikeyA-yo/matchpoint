import { useTechnical } from "../lib/context";
import { CHANNEL_LABEL, fmtTime } from "../lib/format";
import { useProductNames } from "../lib/products";
import { OUTCOME_LABEL, REASON_LABEL, type Channel, type Outcome, type ReasonCode, type StreamEvent } from "../lib/types";
import { Badge, Empty } from "./ui";

const TONE = {
  decision_created: "grey",
  message_delivered: "green",
  outcome_recorded: "blue",
  consent_changed: "amber",
  policy_changed: "amber",
  points_awarded: "green",
  tier_changed: "green",
  points_redeemed: "blue",
} as const;

export const EVENT_LABEL: Record<StreamEvent["type"], string> = {
  decision_created: "Decision",
  message_delivered: "Message sent",
  outcome_recorded: "Customer response",
  consent_changed: "Consent updated",
  policy_changed: "Policy updated",
  points_awarded: "Points earned",
  tier_changed: "Tier change",
  points_redeemed: "Reward redeemed",
};

const EARN_LABEL: Record<string, string> = {
  consent_granted: "turning on personalised offers",
  preferences_reviewed: "reviewing preferences",
  offer_feedback: "offer feedback",
  product_use_milestone: "using a product",
};

const ACTION_LABEL: Record<string, string> = {
  opened: "Opened the message",
  accepted: "Accepted the offer",
  not_now: "Chose Not now",
  stop_offers: "Stopped offers",
  approved: "Approved by staff",
  rejected: "Declined by staff",
};

function technicalSummary(e: StreamEvent): string {
  const d = e.data;
  switch (e.type) {
    case "decision_created":
      return `${d.customer_ref}: ${d.outcome} (${(d.reasons as string[] | undefined)?.join(", ") ?? ""})${d.mode === "dry_run" ? " · dry run" : ""}`;
    case "message_delivered":
      return `${d.customer_ref}: ${d.product_id} via ${d.channel}`;
    case "outcome_recorded":
      return `${d.customer_ref}: ${d.action ?? d.review}`;
    case "consent_changed":
      return `${d.customer_ref}: offers ${d.personalised_offers ? "on" : "off"} (${d.source})`;
    case "policy_changed":
      return `${d.policy_id} is ${d.status}`;
    case "points_awarded":
      return `${d.customer_ref}: +${d.points} (${d.event}) balance ${d.balance}`;
    case "tier_changed":
      return `${d.customer_ref}: ${d.from_tier} -> ${d.to_tier}`;
    case "points_redeemed":
      return `${d.customer_ref}: ${d.reward_id} -${d.points} balance ${d.balance}`;
  }
}

function plainSummary(e: StreamEvent, productName: (id: string) => string): string {
  const d = e.data;
  const who = String(d.customer_ref ?? "");
  switch (e.type) {
    case "decision_created": {
      const reason = (d.reasons as ReasonCode[] | undefined)?.find((r) => r !== "OK");
      const test = d.mode === "dry_run" ? " (test run)" : "";
      return `${who} · ${OUTCOME_LABEL[d.outcome as Outcome] ?? d.outcome}${reason ? `: ${REASON_LABEL[reason]}` : ""}${test}`;
    }
    case "message_delivered":
      return `${who} · ${productName(String(d.product_id))} · ${CHANNEL_LABEL[d.channel as Channel] ?? d.channel}`;
    case "outcome_recorded":
      return `${who} · ${ACTION_LABEL[String(d.action ?? d.review)] ?? d.action ?? d.review}`;
    case "consent_changed":
      return `${who} · Personalised offers ${d.personalised_offers ? "on" : "off"}`;
    case "policy_changed":
      return `${d.policy_id} ${d.status === "active" ? "is now active" : "saved as draft"}`;
    case "points_awarded":
      return `${who} · +${d.points} points${EARN_LABEL[String(d.event)] ? ` for ${EARN_LABEL[String(d.event)]}` : ""}`;
    case "tier_changed":
      return `${who} · Moved to ${d.to_tier}`;
    case "points_redeemed":
      return `${who} · Redeemed ${d.points} points`;
  }
}

export function EventFeed({ events, emptyHint }: { events: StreamEvent[]; emptyHint?: string }) {
  const { technical } = useTechnical();
  const productName = useProductNames();
  if (!events.length) return <Empty title="No events yet">{emptyHint}</Empty>;
  return (
    <div>
      {events.map((e, i) => (
        <div key={`${e.at}-${i}`} className="event">
          <span className="event-time">{fmtTime(e.at)}</span>
          <div className="stack-sm" style={{ gap: 4 }}>
            <span><Badge tone={TONE[e.type]}>{technical ? e.type : EVENT_LABEL[e.type]}</Badge></span>
            <span className="muted">{technical ? technicalSummary(e) : plainSummary(e, productName)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
