"""CustomerProfile: reads from the demo customer list.

A pilot swaps the transport for a Dataverse `contact` query. The connector maps
whichever shape the transport returns into the domain Profile.
"""

from typing import Protocol

from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.adapters.purpose import Purpose
from matchpoint.models import Profile, RefExists


class ProfileTransport(Protocol):
    def read(self, customer_ref: str) -> Profile | None: ...
    def write(self, customer_ref: str, profile: Profile) -> None: ...


class CustomerProfileImpl:
    def __init__(self, transport: ProfileTransport):
        self._transport = transport

    def get(self, customer_ref: str, *, purpose: Purpose) -> Profile:
        found = self._transport.read(customer_ref)
        if found is None:
            raise CustomerNotFound("CustomerProfile", f"unknown {customer_ref}")
        return found

    def exists(self, customer_ref: str, *, purpose: Purpose) -> RefExists:
        try:
            found = self._transport.read(customer_ref)
        except CustomerNotFound:
            found = None
        return RefExists(customer_ref=customer_ref, exists=found is not None)

    def update_holdings(
        self, customer_ref: str, holdings: list[str], *, purpose: Purpose
    ) -> Profile:
        found = self._transport.read(customer_ref)
        if found is None:
            raise CustomerNotFound("CustomerProfile", f"unknown {customer_ref}")
        updated = found.model_copy(update={"holdings": holdings})
        self._transport.write(customer_ref, updated)
        return updated
