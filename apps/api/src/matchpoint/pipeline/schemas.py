"""Wire shapes for POST /decisions/evaluate, following docs/api_design.md section 4.

The web app's contract is apps/web/src/lib/types.ts. Anything added here must stay
backwards compatible with it: a new key is ignored by TypeScript, a renamed key breaks
the console. Decision IDs are derived from customer, product and as_of, so re-running a
decision returns the same record.
"""

from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator

from matchpoint.adapters.refs import is_customer_ref
from matchpoint.models import Channel

Outcome = Literal["send", "hold", "silent", "review", "shown"]
EvalMode = Literal["live", "dry_run", "shown"]

ReasonCode = Literal[
    "OK",
    "NO_CONSENT",
    "OPTED_OUT",
    "NO_CHANNEL_CONSENT",
    "SENSITIVE_TRIGGER",
    "NOT_ELIGIBLE",
    "ALREADY_HOLDS",
    "NO_MATCH",
    "CAP_30D",
    "SAME_PRODUCT_60D",
    "COOLDOWN_IGNORED",
    "QUIET_HOURS",
    "LOW_UPLIFT",
    "ATTENTION_BUDGET",
    "GOVERNOR_LOST",
    "CREDIT_REVIEW",
    "GUARDRAIL_BLOCKED",
]

REASON_CODES: frozenset[str] = frozenset(get_args(ReasonCode))


class EvaluateRequest(BaseModel):
    customer_ref: str
    as_of: datetime | None = None
    mode: EvalMode = "live"

    @field_validator("customer_ref")
    @classmethod
    def _known_ref_shape(cls, v: str) -> str:
        if not is_customer_ref(v):
            raise ValueError("customer_ref must be cus_ followed by 12 hex characters")
        return v

    @field_validator("as_of")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and (v.tzinfo is None or v.utcoffset() is None):
            raise ValueError("as_of needs a UTC offset, e.g. 2026-12-03T09:02:00+01:00")
        return v


class Trigger(BaseModel):
    type: str
    evidence: str
    category: str | None = None
    blocked: bool = False


class Candidate(BaseModel):
    product_id: str
    eligible: bool
    uplift: float
    dropped: ReasonCode | None = None


class RuleCheck(BaseModel):
    rule: str
    passed: bool
    detail: str


class StepTrace(BaseModel):
    step: int
    name: str
    status: Literal["ok", "stop"]
    reason: str
    detail: str = ""


class Trace(BaseModel):
    triggers: list[Trigger] = Field(default_factory=list)
    candidates: list[Candidate] = Field(default_factory=list)
    rules: list[RuleCheck] = Field(default_factory=list)
    steps: list[StepTrace] = Field(default_factory=list)
    policy_version: str
    model_version: str


class Message(BaseModel):
    title: str
    body: str
    why: str


class Decision(BaseModel):
    id: str
    customer_ref: str
    as_of: datetime
    mode: EvalMode
    outcome: Outcome
    product_id: str | None = None
    channel: Channel | None = None
    reasons: list[ReasonCode]
    scheduled_for: datetime | None = None
    trace: Trace
    message: Message | None = None
    simulated: bool = True
