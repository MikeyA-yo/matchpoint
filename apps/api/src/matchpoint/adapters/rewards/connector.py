"""RewardsFulfilment: airtime, voucher, fee waiver. All return `fulfilled` for the demo."""

from matchpoint.adapters.purpose import Purpose
from matchpoint.clock import Clock
from matchpoint.models import FulfilmentReceipt, Redemption


class SimRewardsFulfilment:
    def __init__(self, clock: Clock):
        self._clock = clock

    def fulfil(self, redemption: Redemption, *, purpose: Purpose) -> FulfilmentReceipt:
        return FulfilmentReceipt(
            redemption_id=redemption.id,
            status="fulfilled",
            at=self._clock.now(),
            provider_ref=f"{redemption.kind}:{redemption.id}",
        )
