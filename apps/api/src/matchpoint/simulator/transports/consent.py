"""Hand-set consent for the demo customers plus a dict-backed read/write."""

from matchpoint.adapters.refs import RefHasher
from matchpoint.clock import Clock
from matchpoint.models import Consent
from matchpoint.simulator.population import DEMO_CUSTOMERS


class SimConsentTransport:
    def __init__(self, hasher: RefHasher, clock: Clock):
        self._clock = clock
        self._store: dict[str, Consent] = {}
        now = clock.now()
        for c in DEMO_CUSTOMERS:
            ref = hasher.ref(c.source_id)
            self._store[ref] = Consent(
                customer_ref=ref,
                personalised_offers=c.personalised_offers,
                channels=c.channels,
                updated_at=now,
                source="demo_seed",
            )

    def read(self, customer_ref: str) -> Consent | None:
        return self._store.get(customer_ref)

    def write(self, customer_ref: str, consent: Consent) -> None:
        self._store[customer_ref] = consent
