"""Redeem handler: checks balance, writes spend entry, calls fulfilment."""

from __future__ import annotations

import uuid
from datetime import datetime

from matchpoint.adapters.errors import ConnectorUnavailable
from matchpoint.adapters.rewards.connector import SimRewardsFulfilment
from matchpoint.adapters.purpose import Purpose
from matchpoint.events.bus import EventBus
from matchpoint.events.schemas import stream_event
from matchpoint.models import FulfilmentReceipt, Redemption
from matchpoint.rewards.ledger import LedgerEntry, RewardsLedger
from matchpoint.rewards.rules import CATALOGUE, INSUFFICIENT_POINTS


class RedeemResult:
    def __init__(
        self,
        ok: bool,
        code: str | None = None,
        balance: int = 0,
        receipt: FulfilmentReceipt | None = None,
    ):
        self.ok = ok
        self.code = code
        self.balance = balance
        self.receipt = receipt


def _catalogue_item(reward_id: str):
    for item in CATALOGUE:
        if item["id"] == reward_id:
            return item
    return None


def _kind_to_reward_kind(kind: str):
    from matchpoint.models import RewardKind

    return RewardKind(kind)  # type: ignore[arg-type]


def redeem(
    *,
    customer_ref: str,
    reward_id: str,
    idempotency_key: str,
    ledger: RewardsLedger,
    clock,
    fulfilment: SimRewardsFulfilment,
    events: EventBus | None = None,
    as_of: datetime | None = None,
) -> RedeemResult:
    now = as_of or clock.now()

    # 1. Check the item exists.
    item = _catalogue_item(reward_id)
    if item is None:
        return RedeemResult(ok=False, code="REWARD_NOT_FOUND")

    # 2. Check the balance.
    balance = ledger.balance(customer_ref)
    if balance < item["points"]:
        return RedeemResult(ok=False, code=INSUFFICIENT_POINTS)

    # 3. Write a spend entry to the ledger.
    redemption = Redemption(
        id=str(uuid.uuid4()),
        customer_ref=customer_ref,
        reward_id=reward_id,
        kind=_kind_to_reward_kind(item["kind"]),
        points=item["points"],
        value_kobo=item["points"] * 100,
        idempotency_key=idempotency_key,
        as_of=now,
    )
    spend_entry = LedgerEntry(
        id=str(uuid.uuid4()),
        customer_ref=customer_ref,
        type="spend",
        points=item["points"],
        reward_id=reward_id,
        idempotency_key=idempotency_key,
        as_of=now,
        balance_after=balance - item["points"],
    )
    ledger.append(spend_entry)

    # 4. Call fulfilment. If it fails, write a reversal and return 503.
    try:
        receipt = fulfilment.fulfil(redemption, purpose="marketing")
    except Exception:
        reversal = LedgerEntry(
            id=str(uuid.uuid4()),
            customer_ref=customer_ref,
            type="reversal",
            points=item["points"],
            reward_id=reward_id,
            idempotency_key=f"{idempotency_key}:reversal",
            as_of=now,
            balance_after=ledger.balance(customer_ref),
        )
        ledger.append(reversal)
        return RedeemResult(ok=False, code="FULFILMENT_FAILED", balance=balance)

    # 5. Recompute tier. Publish points_redeemed.
    new_balance = ledger.balance(customer_ref)
    if events is not None:
        events.publish(
            stream_event(
                "points_redeemed",
                customer_ref=customer_ref,
                reward_id=reward_id,
                points=item["points"],
                balance=new_balance,
                at=now.isoformat(),
            )
        )

    return RedeemResult(ok=True, balance=new_balance, receipt=receipt)
