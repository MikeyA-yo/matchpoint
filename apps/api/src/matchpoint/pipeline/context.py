"""Everything one evaluate call needs, built once and handed to each step.

The pipeline is pure apart from the adapters and the decision log: a step reads the
Context, may fetch through a connector, and returns a StepResult. Nothing reaches for a
global, a wall clock or a random source.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from matchpoint.clock import Clock
from matchpoint.events.bus import EventBus
from matchpoint.ledger.decision_log import DecisionLog
from matchpoint.models import Channel, Consent, FeatureVector, Product, Profile, Txn
from matchpoint.pipeline.detector import Signal
from matchpoint.pipeline.policy import Policy
from matchpoint.pipeline.schemas import EvalMode, Message, Outcome
from matchpoint.pipeline.trace import TraceBuilder

if TYPE_CHECKING:
    from matchpoint.wiring import Adapters

LOOKBACK_DAYS = 365


@dataclass
class ScoredProduct:
    """A product, whether it is eligible, and its rule outcome so far."""

    product: Product
    eligible: bool
    score: int
    uplift: float
    dropped: str | None = None
    drop_outcome: Outcome | None = None
    reasons: list[str] = field(default_factory=list)
    channel: Channel | None = None
    scheduled_for: datetime | None = None


@dataclass(frozen=True)
class Delivery:
    """What step 10 handed to the gateway, kept until the decision is recorded."""

    message_id: str
    at: datetime
    status: str


@dataclass
class Context:
    customer_ref: str
    as_of: datetime
    mode: EvalMode
    adapters: Adapters
    clock: Clock
    policy: Policy
    log: DecisionLog
    trace: TraceBuilder = field(default_factory=TraceBuilder)
    # Bumped per customer when a demo pattern is planted, so a re-run is not the cached
    # decision. Zero for an ordinary evaluation.
    epoch: int = 0
    # Where step 10 and the log append publish their events. None in tests and in code
    # that only exercises the pipeline.
    events: EventBus | None = None
    # Set by step 10 so the decision is emitted before the message it produced.
    delivered: Delivery | None = None

    consent: Consent | None = None
    profile: Profile | None = None
    transactions: list[Txn] = field(default_factory=list)
    products: list[Product] = field(default_factory=list)
    signals: list[Signal] = field(default_factory=list)
    candidates: list[ScoredProduct] = field(default_factory=list)

    product: Product | None = None
    channel: Channel | None = None
    message: Message | None = None
    gain_kobo: int | None = None
    scheduled_for: datetime | None = None
    reasons: list[str] = field(default_factory=list)

    # Cohort pipeline additions.
    features: FeatureVector | None = None
    cluster_id: int | None = None
    template_id: str | None = None

    @property
    def holdings(self) -> tuple[str, ...]:
        return tuple(self.profile.holdings) if self.profile else ()

    @property
    def contacts_30d(self) -> int:
        return self.log.contacts_since(self.customer_ref, self.as_of, days=30)

    def days_since(self, product_id: str) -> float | None:
        """Days since the last send for this product, or None if it was never sent."""
        last = self.log.last_sent_at(self.customer_ref, product_id)
        return None if last is None else (self.as_of - last).total_seconds() / 86_400

    def days_since_ignored(self, product_id: str) -> float | None:
        """Days since the customer ignored or declined this product.

        Read from the message store: not_now sets a cooldown timestamp that this reads
        back.
        """
        last = self.adapters.message_store.ignored_at(self.customer_ref, product_id)
        return (
            None
            if last is None
            else (self.as_of - last).total_seconds() / 86_400
        )

    def window_start(self, days: int = LOOKBACK_DAYS) -> datetime:
        return self.as_of - timedelta(days=days)
