"""Policy defaults for the demo, matching docs/api_design.md section 4 (pol_v3).

These are starting values. Zenith sets the real ones and compliance approves changes, so
every rule reads them from here rather than carrying its own literals. A versioned policy
store replaces this module later; the rules do not change.

Quiet windows wrap midnight when start > end.

`filter_eligible` applies the per-product hard filter defined by
config/eligibility_rules.json. It is the cohort pipeline's eligibility step and
replaces the inline logic that used to live in pipeline/matcher.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time
from typing import Any

from matchpoint.config import eligibility_rules
from matchpoint.models import Channel, FeatureVector, Product, Profile


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


# ---------------------------------------------------------------------------
# filter_eligible
# ---------------------------------------------------------------------------


def filter_eligible(
    products: list[Product], profile: Profile, features: FeatureVector | None = None
) -> list[Product]:
    """Return the subset of products this customer passes the hard filter for.

    Rules are read from config/eligibility_rules.json. Each entry may set:
      age_min / age_max         - integer age-band edges
      segment_in                - list of accepted segments
      holdings_forbidden        - any match drops the product
      holdings_required         - all must be present
      signal_required           - narration label whose count must be > 0
      parent_signal_required    - same, for child products
      credit_gate               - true keeps credit products but requires a
                                  "salaried" segment and (if features given) a
                                  salary signal
    Products with no entry pass through so new products default to available.
    """
    rules = eligibility_rules()
    kept: list[Product] = []
    age = _age_from_band(profile.age_band)
    holdings = {h.lower() for h in profile.holdings}
    narration_counts = features.narration_counts if features is not None else {}
    for product in products:
        rule = rules.get(product.id)
        if rule is None:
            kept.append(product)
            continue
        if not _passes(rule, age, profile, holdings, narration_counts):
            continue
        kept.append(product)
    return kept


def _passes(
    rule: dict[str, Any],
    age: int | None,
    profile: Profile,
    holdings: set[str],
    narration_counts: dict[str, int],
) -> bool:
    if "age_min" in rule and (age is None or age < int(rule["age_min"])):
        return False
    if "age_max" in rule and age is not None and age > int(rule["age_max"]):
        return False
    if "segment_in" in rule:
        if profile.segment is None or profile.segment not in rule["segment_in"]:
            return False
    for forbidden in rule.get("holdings_forbidden", []):
        if forbidden.lower() in holdings:
            return False
    for required in rule.get("holdings_required", []):
        if required.lower() not in holdings:
            return False
    sig = rule.get("signal_required") or rule.get("parent_signal_required")
    if sig and narration_counts.get(sig, 0) <= 0:
        return False
    if rule.get("credit_gate"):
        if profile.segment != "salaried":
            return False
        if narration_counts and narration_counts.get("salary", 0) <= 0:
            return False
    return True


def _age_from_band(band: str | None) -> int | None:
    if not band:
        return None
    head = band.split("-")[0].rstrip("+")
    try:
        return int(head)
    except ValueError:
        return None
