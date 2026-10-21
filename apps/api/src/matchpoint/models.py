"""Core data shapes. Consent and Product follow docs/api_design.md section 4.

Any field that a purpose filter can withhold (adapters/purpose.py) is Optional, so a
filtered record is still a valid model. Money is integer kobo, never float.
"""

from datetime import date, datetime
from typing import Any, Literal, get_args

from pydantic import BaseModel, Field, field_validator

Channel = Literal["app", "whatsapp", "sms", "email", "ussd"]
CHANNELS: tuple[Channel, ...] = get_args(Channel)

TxnDirection = Literal["credit", "debit"]
TxnKind = Literal[
    "salary",
    "nip_in",
    "nip_out",
    "pos",
    "atm",
    "bill",
    "airtime",
    "charge",
    "stamp_duty",
    "reversal",
    "other",
]

# Coarse bands for purposes that may see the size of a payment but not the amount.
# Edges follow the CBN 2026 transfer-fee bands (₦5k, ₦50k) plus one upper band.
AMOUNT_BANDS: tuple[tuple[int, str], ...] = (
    (5_000_00, "under_5k"),
    (50_000_00, "5k_to_50k"),
    (500_000_00, "50k_to_500k"),
)
TOP_BAND = "500k_plus"


def amount_band(amount_kobo: int) -> str:
    for upper, name in AMOUNT_BANDS:
        if amount_kobo < upper:
            return name
    return TOP_BAND


class Txn(BaseModel):
    id: str
    customer_ref: str
    at: datetime
    direction: TxnDirection
    kind: TxnKind
    amount_band: str
    amount_kobo: int | None = Field(default=None, ge=0)
    currency: str = "NGN"
    value_date: date | None = None
    narration: str | None = None
    reversal_of: str | None = None
    simulated: bool = False


class Profile(BaseModel):
    customer_ref: str
    age_band: str | None = None
    segment: str | None = None
    state: str | None = None
    holdings: list[str] = []
    # An open complaint pauses marketing even when consent is on.
    complaint_open: bool = False
    simulated: bool = False


class RefExists(BaseModel):
    """Answer to "does this customer exist?" without returning any profile data."""

    customer_ref: str
    exists: bool


class Consent(BaseModel):
    customer_ref: str
    # Silence is not consent: anything missing reads as False.
    personalised_offers: bool = False
    channels: dict[Channel, bool] = Field(default_factory=dict)
    updated_at: datetime
    source: str

    @field_validator("channels")
    @classmethod
    def _missing_channels_are_false(cls, v: dict[Channel, bool]) -> dict[Channel, bool]:
        return {c: bool(v.get(c, False)) for c in CHANNELS}


class GainSpec(BaseModel):
    """How the demo works out a naira gain. Rates are examples, never promises."""

    kind: Literal["interest", "fee_saving", "cost"]
    example_rate: float | None = None
    months: int = 12


class Product(BaseModel):
    id: str
    name: str
    category: str
    is_credit: bool
    features: list[str] = []
    eligibility: dict[str, Any]
    version: int
    # Pitch extras: short facts, where the uplift comes from, and the "compared to what" group.
    key_facts: list[str] = []
    gain_model: str | None = None
    compare_group: str | None = None
    # The holding a customer already has that makes this product redundant ("savings_account").
    holding_id: str | None = None
    # How suitable the product is for each detected signal. Empty means "no fit, don't offer".
    fit: dict[str, int] = {}
    gain: GainSpec | None = None


MessagePurpose = Literal["marketing", "service"]


class OutboundMessage(BaseModel):
    id: str
    customer_ref: str
    channel: Channel
    title: str
    body: str
    why: str
    # Promotional SMS is subject to NCC DND; service messages are not.
    kind: MessagePurpose = "marketing"
    product_id: str | None = None


DeliveryStatus = Literal["accepted", "queued", "rejected", "failed"]
DeliveryReason = Literal[
    "DND",
    "OUTSIDE_WINDOW",
    "TEMPLATE_REJECTED",
    "NO_WA_ACCOUNT",
    "SESSION_ONLY",
    "PROVIDER_ERROR",
]


class DeliveryReceipt(BaseModel):
    message_id: str
    channel: Channel
    accepted: bool
    at: datetime
    status: DeliveryStatus = "accepted"
    reason: DeliveryReason | None = None
    provider_ref: str | None = None


RewardKind = Literal["airtime", "voucher", "fee_waiver"]


class Redemption(BaseModel):
    id: str
    customer_ref: str
    reward_id: str
    kind: RewardKind
    points: int = Field(ge=0)
    value_kobo: int = Field(ge=0)
    idempotency_key: str
    as_of: datetime


class FulfilmentReceipt(BaseModel):
    redemption_id: str
    status: Literal["fulfilled", "pending", "failed"]
    at: datetime
    provider_ref: str | None = None
    reason: str | None = None
