"""The clock services depend on. Decisions take `as_of` from a Clock, never from now().

The simulated implementation lives in matchpoint.simulator.clock. A pilot supplies its own.
"""

from datetime import datetime, timedelta, timezone
from typing import Protocol

WAT = timezone(timedelta(hours=1), "WAT")


class Clock(Protocol):
    def now(self) -> datetime: ...
