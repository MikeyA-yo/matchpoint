"""Earn event handler: validates, applies caps, writes the ledger entry."""

from __future__ import annotations

import uuid
from datetime import datetime

from matchpoint.events.bus import EventBus
from matchpoint.events.schemas import stream_event
from matchpoint.models import Consent
from matchpoint.rewards.ledger import LedgerEntry, RewardsLedger
from matchpoint.rewards.rules import (
    CONSENT_REQUIRED_EVENTS,
    EARN,
    MAX_POINTS_PER_30D,
    REWARD_CAP_REACHED,
    REWARD_DUPLICATE,
    REWARD_INELIGIBLE,
    REWARD_NO_CONSENT,
    TIERS,
)


class EarnResult:
    def __init__(
        self,
        ok: bool,
        code: str | None = None,
        points: int = 0,
        entry=None,
        tier_changed: bool = False,
        tier: str | None = None,
    ):
        self.ok = ok
        self.code = code
        self.points = points
        self.entry = entry
        self.tier_changed = tier_changed
        self.tier = tier


def _idempotency_key(
    customer_ref: str, event: str, purpose: str | None = None, product: str | None = None
) -> str:
    parts = [customer_ref, event]
    if purpose is not None:
        parts.append(f"purpose:{purpose}")
    if product is not None:
        parts.append(f"product:{product}")
    return "|".join(parts)


def _tier_name(points: int) -> str:
    name = TIERS[0][0]
    for t_name, t_threshold in TIERS:
        if points >= t_threshold:
            name = t_name
    return name


def earn(
    *,
    customer_ref: str,
    event: str,
    ledger: RewardsLedger,
    clock,
    purpose: str | None = None,
    product: str | None = None,
    as_of: datetime | None = None,
    events: EventBus | None = None,
    consent: Consent | None = None,
) -> EarnResult:
    now = as_of or clock.now()

    # 1. Check the event is in the rules.
    rule = EARN.get(event)
    if rule is None:
        return EarnResult(ok=False, code=REWARD_INELIGIBLE)

    # 2. Idempotency key: customer + event + purpose or product.
    key = _idempotency_key(customer_ref, event, purpose=purpose, product=product)
    existing = ledger.by_key(key)
    if existing is not None:
        return EarnResult(ok=False, code=REWARD_DUPLICATE, points=existing.points)

    # 3. For data-use events, check consent is on file.
    if event in CONSENT_REQUIRED_EVENTS:
        if consent is None or not consent.personalised_offers:
            return EarnResult(ok=False, code=REWARD_NO_CONSENT)

    points = rule["points"]

    # 4. Apply the 30-day points cap.
    earned_30d = ledger.earned_since(customer_ref, now, 30)
    if earned_30d + points > MAX_POINTS_PER_30D:
        return EarnResult(ok=False, code=REWARD_CAP_REACHED)

    # Per-event caps: max_per_year, max_per_30d.
    if rule.get("max_per_year") is not None:
        last = ledger.last_earn_at(customer_ref, event)
        if last is not None and (now - last).days < 365:
            return EarnResult(ok=False, code=REWARD_CAP_REACHED)

    if rule.get("max_per_30d") is not None:
        count = ledger.earn_count_since(customer_ref, event, now, 30)
        if count >= rule["max_per_30d"]:
            return EarnResult(ok=False, code=REWARD_CAP_REACHED)

    # product_use_milestone requires 60 days since last earn for same product.
    if rule.get("requires_days") is not None and product is not None:
        last = ledger.last_earn_at(customer_ref, event)
        if last is not None and (now - last).days < rule["requires_days"]:
            return EarnResult(ok=False, code=REWARD_CAP_REACHED)

    # 5. Write the entry.
    entry = LedgerEntry(
        id=str(uuid.uuid4()),
        customer_ref=customer_ref,
        type="earn",
        points=points,
        event=event,
        idempotency_key=key,
        as_of=now,
        balance_after=ledger.balance(customer_ref) + points,
    )
    ledger.append(entry)

    # Recompute tier.
    new_balance = ledger.balance(customer_ref)
    new_tier = _tier_name(new_balance)

    # Publish events.
    tier_changed = False
    if events is not None:
        events.publish(
            stream_event(
                "points_awarded",
                customer_ref=customer_ref,
                event=event,
                points=points,
                balance=new_balance,
                tier=new_tier,
                at=now.isoformat(),
            )
        )
        # Detect tier change by comparing with balance before this earn.
        old_balance = new_balance - points
        old_tier = _tier_name(old_balance)
        if old_tier != new_tier:
            tier_changed = True
            events.publish(
                stream_event(
                    "tier_changed",
                    customer_ref=customer_ref,
                    from_tier=old_tier,
                    to_tier=new_tier,
                    at=now.isoformat(),
                )
            )

    return EarnResult(
        ok=True,
        points=points,
        entry=entry,
        tier_changed=tier_changed,
        tier=new_tier,
    )
