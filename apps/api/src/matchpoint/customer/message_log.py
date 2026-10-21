"""In-memory message log for the demo.

A dict keyed by message_id, plus an index by customer_ref.  The store is a connector:
it can be swapped for a real implementation with no change outside wiring.

It also records cooldowns set when a customer declines an offer (not_now), so the
pipeline's cooldown_ignored rule can read them back.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel, Field

Channel = Literal["app", "whatsapp", "sms", "email", "ussd"]
CHANNELS: tuple[Channel, ...] = get_args(Channel)

MessageStatus = Literal["sent", "opened", "accepted", "not_now"]


class StoredMessage(BaseModel):
    id: str
    customer_ref: str
    channel: Channel
    title: str
    body: str
    why: str
    product_id: str | None = None
    sent_at: datetime
    status: MessageStatus = "sent"
    response: Literal["opened", "accepted", "not_now", "stop_offers"] | None = None
    opened_at: datetime | None = None
    accepted_at: datetime | None = None
    declined_at: datetime | None = None


class MessageStore:
    def __init__(self) -> None:
        self._by_id: dict[str, StoredMessage] = {}
        self._by_customer: dict[str, list[str]] = {}
        # (customer_ref, product_id) -> datetime when the customer last declined
        self._ignored_at: dict[tuple[str, str], datetime] = {}

    def append(self, message: StoredMessage) -> None:
        self._by_id[message.id] = message
        self._by_customer.setdefault(message.customer_ref, []).append(message.id)

    def by_customer(self, ref: str) -> list[StoredMessage]:
        ids = self._by_customer.get(ref, [])
        return [self._by_id[i] for i in reversed(ids)]

    def by_id(self, message_id: str) -> StoredMessage | None:
        return self._by_id.get(message_id)

    def update(self, message_id: str, patch: dict) -> StoredMessage | None:
        msg = self._by_id.get(message_id)
        if msg is None:
            return None
        updated = msg.model_copy(update=patch)
        self._by_id[message_id] = updated
        return updated

    def record_ignored(self, customer_ref: str, product_id: str, at: datetime) -> None:
        self._ignored_at[(customer_ref, product_id)] = at

    def ignored_at(self, customer_ref: str, product_id: str) -> datetime | None:
        return self._ignored_at.get((customer_ref, product_id))


message_store = MessageStore()
