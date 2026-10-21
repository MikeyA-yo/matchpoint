"""POST /messages/{id}/respond - handles opened, accepted, not_now, stop_offers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.customer.message_log import message_store
from matchpoint.models import Channel
from matchpoint.wiring import get_runtime

router = APIRouter(tags=["customer"])

WAT = timezone(timedelta(hours=1), "WAT")


class RespondRequest(BaseModel):
    action: Literal["opened", "accepted", "not_now", "stop_offers"] = Field(
        description="opened | accepted | not_now | stop_offers"
    )


@router.post("/messages/{message_id}/respond")
def respond(message_id: str, request: RespondRequest):
    msg = message_store.by_id(message_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="message not found")

    runtime = get_runtime()
    now = runtime.clock.now()

    if request.action == "opened":
        message_store.update(
            message_id,
            {"opened_at": now, "status": "opened", "response": "opened"},
        )
        return {"status": "opened"}

    if request.action == "accepted":
        message_store.update(
            message_id,
            {"accepted_at": now, "status": "accepted", "response": "accepted"},
        )
        if msg.product_id:
            _add_holding(runtime, msg.customer_ref, msg.product_id)
        return {"status": "accepted"}

    if request.action == "not_now":
        message_store.update(
            message_id,
            {"declined_at": now, "status": "not_now", "response": "not_now"},
        )
        if msg.product_id:
            message_store.record_ignored(msg.customer_ref, msg.product_id, now)
        return {"status": "not_now"}

    if request.action == "stop_offers":
        consent = runtime.adapters.consent.get(msg.customer_ref, purpose="marketing")
        all_channels: dict[Channel, bool] = {c: False for c in Channel.__args__ if isinstance(Channel.__args__, tuple)}  # type: ignore[attr-defined]
        channels = {c: False for c in ("app", "whatsapp", "sms", "ussd")}
        new_consent = consent.model_copy(
            update={
                "personalised_offers": False,
                "channels": channels,
                "source": "stop_offers",
            }
        )
        runtime.adapters.consent.set(msg.customer_ref, new_consent, purpose="marketing")
        return new_consent

    raise HTTPException(status_code=422, detail="unknown action")


def _add_holding(runtime, customer_ref: str, product_id: str) -> None:
    """Add a product to the customer's holdings through CustomerProfile."""
    try:
        profile = runtime.adapters.profile.get(customer_ref, purpose="marketing")
    except CustomerNotFound:
        return
    holdings = list(profile.holdings)
    if product_id not in holdings:
        holdings.append(product_id)
        runtime.adapters.profile.update_holdings(customer_ref, holdings)
