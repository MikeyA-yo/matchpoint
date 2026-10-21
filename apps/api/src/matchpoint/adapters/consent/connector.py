"""ConsentStore: in-memory for the demo; a pilot swaps the transport for Dataverse.

Fail-safe: anything the transport can't answer is treated as no consent. Missing
channels read as False, because silence is not consent (Consent.channels is
normalised in the model).
"""

import logging
from typing import Protocol

from matchpoint.adapters.errors import ConnectorError
from matchpoint.adapters.purpose import Purpose
from matchpoint.clock import Clock
from matchpoint.models import Consent

log = logging.getLogger("matchpoint.consent")


class ConsentTransport(Protocol):
    def read(self, customer_ref: str) -> Consent | None: ...
    def write(self, customer_ref: str, consent: Consent) -> None: ...


class ConsentStoreImpl:
    def __init__(self, transport: ConsentTransport, clock: Clock):
        self._transport = transport
        self._clock = clock

    def get(self, customer_ref: str, *, purpose: Purpose) -> Consent:
        try:
            found = self._transport.read(customer_ref)
        except ConnectorError:
            log.warning("consent fetch failed for %s; failing safe to no consent",
                        customer_ref)
            return self._no_consent(customer_ref, source="fail_safe")
        if found is None:
            return self._no_consent(customer_ref, source="unknown")
        return found

    def set(self, customer_ref: str, consent: Consent, *, purpose: Purpose) -> Consent:
        stamped = consent.model_copy(update={
            "customer_ref": customer_ref,
            "updated_at": self._clock.now(),
        })
        self._transport.write(customer_ref, stamped)
        return stamped

    def _no_consent(self, customer_ref: str, *, source: str) -> Consent:
        return Consent(
            customer_ref=customer_ref,
            personalised_offers=False,
            updated_at=self._clock.now(),
            source=source,
        )
