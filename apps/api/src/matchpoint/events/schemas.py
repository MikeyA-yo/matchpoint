"""Server-sent event shapes for GET /stream (docs/api_design.md section 5.6).

Every payload carries `at`, and `customer_ref` when it concerns one customer. The
console renders exactly these fields (apps/web/src/components/EventFeed.tsx) and listens
for these types (apps/web/src/lib/types.ts STREAM_EVENTS).

The cohort pipeline adds `decision_trace`: a per-decision envelope naming the
cluster, product, individual gain, compliance results, template id, guardrail
result and model version.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, get_args

from pydantic import BaseModel, Field

StreamEventType = Literal[
    "decision_created",
    "message_delivered",
    "outcome_recorded",
    "consent_changed",
    "policy_changed",
    "points_awarded",
    "points_redeemed",
    "tier_changed",
    "decision_trace",
]

STREAM_EVENT_TYPES: tuple[StreamEventType, ...] = get_args(StreamEventType)


@dataclass(frozen=True)
class StreamEvent:
    type: StreamEventType
    data: dict[str, Any] = field(default_factory=dict)


def stream_event(type: StreamEventType, **data: Any) -> StreamEvent:
    return StreamEvent(type=type, data=data)


class ComplianceCheck(BaseModel):
    rule: str
    passed: bool
    detail: str


class DecisionTrace(BaseModel):
    """One record per decided evaluation. Published on the event bus and kept
    out of the per-request `Trace` wire shape so the console contract stays
    stable."""

    model_config = {"protected_namespaces": ()}

    customer_ref: str
    cluster_id: int | None = None
    product_id: str | None = None
    feature_vector: dict[str, Any] = Field(default_factory=dict)
    eligibility_pass: bool = False
    compliance_checks: list[ComplianceCheck] = Field(default_factory=list)
    individual_gain_kobo: int | None = None
    template_id: str | None = None
    guardrail_pass: bool = False
    model_version: str
    decided_at: datetime
