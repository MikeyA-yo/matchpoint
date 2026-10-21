from matchpoint.adapters.refs import RefHasher
from matchpoint.models import Profile
from matchpoint.simulator.population import DEMO_CUSTOMERS


class SimProfileTransport:
    def __init__(self, hasher: RefHasher):
        self._by_ref: dict[str, Profile] = {}
        for c in DEMO_CUSTOMERS:
            ref = hasher.ref(c.source_id)
            self._by_ref[ref] = Profile(
                customer_ref=ref,
                age_band=c.age_band,
                segment=c.segment,
                state=c.state,
                holdings=list(c.holdings),
                complaint_open=c.blocks_marketing,
                simulated=True,
            )

    def read(self, customer_ref: str) -> Profile | None:
        return self._by_ref.get(customer_ref)

    def write(self, customer_ref: str, profile: Profile) -> None:
        self._by_ref[customer_ref] = profile
