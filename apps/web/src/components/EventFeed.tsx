import { fmtTime } from "../lib/format";
import type { StreamEvent } from "../lib/types";
import { Badge, Empty } from "./ui";

const TONE = {
  decision_created: "grey",
  message_delivered: "green",
  outcome_recorded: "blue",
  consent_changed: "amber",
  policy_changed: "amber",
} as const;

function summary(e: StreamEvent): string {
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
  }
}

export function EventFeed({ events, emptyHint }: { events: StreamEvent[]; emptyHint?: string }) {
  if (!events.length) return <Empty title="Waiting for events">{emptyHint}</Empty>;
  return (
    <div>
      {events.map((e, i) => (
        <div key={`${e.at}-${i}`} className="event">
          <span className="event-time">{fmtTime(e.at)}</span>
          <div className="stack-sm" style={{ gap: 4 }}>
            <span><Badge tone={TONE[e.type]}>{e.type}</Badge></span>
            <span className="muted">{summary(e)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
