"""Adapter interfaces (docs/api_design.md section 1).

Services never import a simulator directly. They receive these by dependency
injection, so a pilot swaps the implementation, not the code.
"""

from datetime import datetime
from typing import Protocol

from matchpoint.models import Consent, DeliveryReceipt, OutboundMessage, Product, Profile, Txn


class TransactionFeed(Protocol):
    def window(self, customer_ref: str, start: datetime, end: datetime) -> list[Txn]: ...


class ProductCatalogue(Protocol):
    def active(self, as_of: datetime) -> list[Product]: ...


class CustomerProfile(Protocol):
    def get(self, customer_ref: str) -> Profile: ...  # age band, segment, products held


class ConsentStore(Protocol):
    def get(self, customer_ref: str) -> Consent: ...
    def set(self, customer_ref: str, consent: Consent) -> Consent: ...


class ChannelGateway(Protocol):
    def send(self, msg: OutboundMessage) -> DeliveryReceipt: ...
