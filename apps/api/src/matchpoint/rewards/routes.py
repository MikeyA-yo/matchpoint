"""Four FastAPI routes for the rewards service."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Header

from matchpoint.errors import ApiError
from matchpoint.rewards.account import account
from matchpoint.rewards.earn import earn
from matchpoint.rewards.redeem import redeem
from matchpoint.rewards.rules import (
    CATALOGUE,
    INSUFFICIENT_POINTS,
)
from matchpoint.wiring import get_runtime

router = APIRouter(tags=["rewards"])


def _parse_as_of(value: str | None):
    if value is None:
        return None
    return datetime.fromisoformat(value)


@router.get("/customers/{ref}/rewards")
def get_rewards(ref: str):
    runtime = get_runtime()
    return account(ref, runtime.rewards)


@router.post("/customers/{ref}/rewards/redeem")
def post_redeem(
    ref: str,
    reward_id: str,
    idempotency_key: str = Header(...),
):
    runtime = get_runtime()
    result = redeem(
        customer_ref=ref,
        reward_id=reward_id,
        idempotency_key=idempotency_key,
        ledger=runtime.rewards,
        clock=runtime.clock,
        fulfilment=runtime.adapters.rewards,
        events=runtime.events,
    )
    if not result.ok:
        if result.code == INSUFFICIENT_POINTS:
            raise ApiError(402, "INSUFFICIENT_POINTS", "not enough points")
        if result.code == "REWARD_NOT_FOUND":
            raise ApiError(404, "REWARD_NOT_FOUND", "reward not found")
        raise ApiError(503, "FULFILMENT_FAILED", "fulfilment failed")
    return {
        "customer_ref": ref,
        "balance": result.balance,
        "receipt": result.receipt,
    }


@router.post("/rewards/events")
def post_rewards_event(
    customer_ref: str,
    event: str,
    purpose: str | None = None,
    product: str | None = None,
    as_of: str | None = None,
    x_role: str | None = Header(default=None, alias="X-Role"),
):
    if x_role != "system":
        raise ApiError(403, "ROLE_REQUIRED", "system role required")

    runtime = get_runtime()
    parsed_as_of = _parse_as_of(as_of)

    consent = None
    if event in {"offer_feedback", "preferences_reviewed"}:
        consent = runtime.adapters.consent.get(customer_ref, purpose="marketing")

    result = earn(
        customer_ref=customer_ref,
        event=event,
        ledger=runtime.rewards,
        clock=runtime.clock,
        purpose=purpose,
        product=product,
        as_of=parsed_as_of,
        events=runtime.events,
        consent=consent,
    )

    if not result.ok:
        raise ApiError(400, result.code, result.code)

    return {
        "customer_ref": customer_ref,
        "event": event,
        "points": result.points,
        "tier_changed": result.tier_changed,
        "tier": result.tier,
    }


@router.get("/rewards/catalogue")
def get_catalogue():
    return {"catalogue": CATALOGUE, "simulated": True}
