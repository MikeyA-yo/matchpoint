"""Step 9: safety checks on message copy before anything is sent.

1. Every marketing message offers a way out (CBN consumer protection).
2. No absolute promises or pressure language.
3. No reference to a blocked category, so private spending never leaks into copy.
"""

from __future__ import annotations

from dataclasses import dataclass

from matchpoint.pipeline.policy import Policy
from matchpoint.pipeline.schemas import Message

OPT_OUT_PHRASES = ("stop offers", "reply stop")
MISLEADING_PHRASES = (
    "guaranteed",
    "risk-free",
    "risk free",
    "no risk",
    "instant approval",
    "free money",
    "double your money",
)


@dataclass(frozen=True)
class Check:
    rule: str
    passed: bool
    detail: str


def run_checks(message: Message, policy: Policy) -> list[Check]:
    text = f"{message.title} {message.body} {message.why}".lower()
    return [
        Check(
            "CBN_OPT_OUT",
            any(phrase in text for phrase in OPT_OUT_PHRASES),
            "Opt-out present" if any(p in text for p in OPT_OUT_PHRASES) else "No opt-out",
        ),
        Check(
            "CBN_NO_MISLEADING_CLAIMS",
            not any(phrase in text for phrase in MISLEADING_PHRASES),
            "No absolute promises"
            if not any(p in text for p in MISLEADING_PHRASES)
            else "Absolute promise found",
        ),
        Check(
            "CBN_NO_SENSITIVE_DATA",
            not any(category in text for category in policy.blocked_trigger_categories),
            "No blocked category named"
            if not any(c in text for c in policy.blocked_trigger_categories)
            else "Blocked category named",
        ),
    ]
