"""Core data shapes. Consent and Product follow docs/api_design.md section 4;
the others are starting points to firm up on day 1."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

Channel = Literal["app", "whatsapp", "sms", "email"]


class Txn(BaseModel):
    customer_ref: str
    at: datetime
    amount: float
    category: str
    narration: str = ""


class Profile(BaseModel):
    customer_ref: str
    age_band: str
    segment: str
    holdings: list[str] = []


class Consent(BaseModel):
    customer_ref: str
    personalised_offers: bool
    channels: dict[Channel, bool]
    updated_at: datetime
    source: str


class Product(BaseModel):
    id: str
    name: str
    category: str
    is_credit: bool
    features: list[str] = []
    eligibility: dict[str, Any]
    version: int


class OutboundMessage(BaseModel):
    id: str
    customer_ref: str
    channel: Channel
    title: str
    body: str
    why: str


class DeliveryReceipt(BaseModel):
    message_id: str
    channel: Channel
    accepted: bool
    at: datetime
