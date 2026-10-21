"""GET /customers/{ref}/consent and PUT /customers/{ref}/consent.

PUT writes a new entry to the consent ledger (append-only: the old entry is not
edited).  Returns 200 with the new consent.

If personalised_offers changes from false to true for the first time, a
consent_granted reward event is logged (wired to rewards when that service is
built).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from matchpoint.customer.message_log import message_store
from matchpoint.wiring import get_runtime

log = logging.getLogger("matchpoint.consent")

router = APIRouter(tags=["customer"])


class ConsentRequest(BaseModel):
    personalised_offers: bool
    channels: dict[str, bool] = Field(default_factory=dict)


class ConsentResponse(BaseModel):
    customer_ref: str
    personalised_offers: bool
    channels: dict[str, bool]
    updated_at: str


@router.get("/customers/{ref}/consent")
def get_consent(ref: str):
    runtime = get_runtime()
    consent = runtime.adapters.consent.get(ref, purpose="marketing")
    return {
        "customer_ref": consent.customer_ref,
        "personalised_offers": consent.personalised_offers,
        "channels": consent.channels,
        "updated_at": consent.updated_at.isoformat(),
    }


@router.put("/customers/{ref}/consent")
def put_consent(ref: str, request: ConsentRequest):
    runtime = get_runtime()
    current = runtime.adapters.consent.get(ref, purpose="marketing")

    channels: dict[str, bool] = {}
    for c in ("app", "whatsapp", "sms", "ussd"):
        channels[c] = bool(request.channels.get(c, False))

    from matchpoint.models import Consent
    from matchpoint.clock import WAT
    from datetime import datetime

    new_consent = Consent(
        customer_ref=ref,
        personalised_offers=request.personalised_offers,
        channels=channels,
        updated_at=datetime.now(WAT),
        source="api",
    )
    runtime.adapters.consent.set(ref, new_consent, purpose="marketing")

    # Reward event when personalised_offers is granted for the first time
    if (
        request.personalised_offers
        and not current.personalised_offers
    ):
        log.info(
            "consent_granted event for %s: personalised_offers first granted",
            ref,
        )

    return {
        "customer_ref": new_consent.customer_ref,
        "personalised_offers": new_consent.personalised_offers,
        "channels": new_consent.channels,
        "updated_at": new_consent.updated_at.isoformat(),
    }
