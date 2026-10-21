"""Adapter interfaces (docs/api_design.md section 1).

Services never import a simulator directly. They receive these by dependency injection,
so a pilot swaps the implementation, not the code.

Every method takes a keyword-only `purpose`. Implementations may use it to fetch less
from the source, and the PurposeFiltered wrapper (adapters/purpose.py) enforces it on the
way out whatever the implementation does.
"""

from datetime import datetime
from typing import Protocol

from matchpoint.adapters.purpose import Purpose
from matchpoint.models import (
    Consent,
    DeliveryReceipt,
    FulfilmentReceipt,
    OutboundMessage,
    Product,
    Profile,
    Redemption,
    Txn,
)


class TransactionFeed(Protocol):
    def window(
        self, customer_ref: str, start: datetime, end: datetime, *, purpose: Purpose
    ) -> list[Txn]: ...


class ProductCatalogue(Protocol):
    def active(self, as_of: datetime, *, purpose: Purpose) -> list[Product]: ...


class CustomerProfile(Protocol):
    def get(self, customer_ref: str, *, purpose: Purpose) -> Profile: ...  # age band, segment, products held


class ConsentStore(Protocol):
    def get(self, customer_ref: str, *, purpose: Purpose) -> Consent: ...
    def set(self, customer_ref: str, consent: Consent, *, purpose: Purpose) -> Consent: ...


class ChannelGateway(Protocol):
    def send(self, msg: OutboundMessage, *, purpose: Purpose) -> DeliveryReceipt: ...


class RewardsFulfilment(Protocol):
    def fulfil(self, redemption: Redemption, *, purpose: Purpose) -> FulfilmentReceipt: ...  # airtime, voucher, fee waiver
