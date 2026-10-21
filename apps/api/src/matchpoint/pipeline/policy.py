"""Policy defaults for the demo, matching docs/api_design.md section 4 (pol_v3).

These are starting values. Zenith sets the real ones and compliance approves changes, so
every rule reads them from here rather than carrying its own literals. A versioned policy
store replaces this module later; the rules do not change.

Quiet windows wrap midnight when start > end.
"""

from dataclasses import dataclass, field
from datetime import time

from matchpoint.models import Channel


@dataclass(frozen=True)
class QuietWindow:
    start: time
    end: time

    def contains(self, at: time) -> bool:
        if self.start <= self.end:
            return self.start <= at < self.end
        return at >= self.start or at < self.end


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


@dataclass(frozen=True)
class Policy:
    id: str = "pol_v3"
    max_messages_per_30d: int = 2
    same_product_gap_days: int = 60
    cooldown_after_ignored_days: int = 14
    quiet_hours: dict[Channel, QuietWindow] = field(
        default_factory=lambda: {
            "sms": QuietWindow(_hhmm("20:00"), _hhmm("08:00")),
            "whatsapp": QuietWindow(_hhmm("21:00"), _hhmm("07:00")),
            "app": QuietWindow(_hhmm("22:00"), _hhmm("07:00")),
        }
    )
    min_uplift: float = 0.02
    credit_requires_review: bool = True
    blocked_trigger_categories: tuple[str, ...] = ("health", "religion", "politics", "betting")

    def quiet_until(self, at: time, channel: Channel) -> QuietWindow | None:
        window = self.quiet_hours.get(channel)
        return window if window and window.contains(at) else None


DEFAULT_POLICY = Policy()
