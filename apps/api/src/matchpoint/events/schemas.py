"""Server-sent event shapes for GET /stream (docs/api_design.md section 5.6).

Every payload carries `at`, and `customer_ref` when it concerns one customer. The
console renders exactly these fields (apps/web/src/components/EventFeed.tsx) and listens
for exactly these five types (apps/web/src/lib/types.ts STREAM_EVENTS).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, get_args

StreamEventType = Literal[
    "decision_created",
    "message_delivered",
    "outcome_recorded",
    "consent_changed",
    "policy_changed",
    "points_awarded",
    "points_redeemed",
    "tier_changed",
]

STREAM_EVENT_TYPES: tuple[StreamEventType, ...] = get_args(StreamEventType)


@dataclass(frozen=True)
class StreamEvent:
    type: StreamEventType
    data: dict[str, Any] = field(default_factory=dict)


def stream_event(type: StreamEventType, **data: Any) -> StreamEvent:
    return StreamEvent(type=type, data=data)
