"""Simulated clock. It only moves when told to, so a seed replays exactly."""

from datetime import datetime, timedelta


class SimClock:
    def __init__(self, start: datetime):
        self._now = _aware(start)

    def now(self) -> datetime:
        return self._now

    def set(self, at: datetime) -> None:
        """Jump to any instant. Used by /sim/start and /sim/reset."""
        self._now = _aware(at)

    def advance(self, delta: timedelta) -> None:
        if delta < timedelta(0):
            raise ValueError("SimClock only moves forward; use set() to rewind")
        self._now += delta


def _aware(at: datetime) -> datetime:
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("SimClock needs a timezone-aware datetime")
    return at
