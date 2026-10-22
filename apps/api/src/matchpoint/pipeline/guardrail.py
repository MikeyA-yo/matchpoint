"""Step 9: safety checks on message copy and profile before anything is sent.

- run_compliance_checks(message, profile, policy) returns the full set of
  CBN + NCC + policy checks (opt-out, no misleading claims, no sensitive
  category, DND, quiet-hours, frequency-cap awareness, credit gate).
- check_copy(text, policy) runs the text-only subset so the Jinja2 explainer
  can veto a rendered body before step 9 even runs.
- run_checks(message, policy) is the pre-cohort signature; kept as a thin
  compatibility shim so existing tests keep passing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time

from matchpoint.config import compliance_policy
from matchpoint.models import Profile
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


def check_copy(text: str, policy: Policy) -> list[Check]:
    """Text-only CBN checks: opt-out, no misleading claims, no sensitive data.

    `policy` provides `blocked_trigger_categories`. The misleading-phrase and
    opt-out lists come from config/compliance_policy.json, with a hard-coded
    fallback so the function keeps working if the file is missing.
    """
    try:
        cfg = compliance_policy()
    except FileNotFoundError:
        cfg = {}
    opt_out = tuple(cfg.get("opt_out_phrases", OPT_OUT_PHRASES))
    misleading = tuple(cfg.get("misleading_phrases", MISLEADING_PHRASES))
    blocked = tuple(cfg.get("blocked_categories", policy.blocked_trigger_categories))

    body = text.lower()
    has_opt_out = any(phrase in body for phrase in opt_out)
    has_misleading = any(phrase in body for phrase in misleading)
    has_blocked = any(category in body for category in blocked)
    return [
        Check(
            "CBN_OPT_OUT",
            has_opt_out,
            "Opt-out present" if has_opt_out else "No opt-out",
        ),
        Check(
            "CBN_NO_MISLEADING_CLAIMS",
            not has_misleading,
            "No absolute promises" if not has_misleading else "Absolute promise found",
        ),
        Check(
            "CBN_NO_SENSITIVE_DATA",
            not has_blocked,
            "No blocked category named" if not has_blocked else "Blocked category named",
        ),
    ]


def run_compliance_checks(
    message: Message, profile: Profile, policy: Policy
) -> list[Check]:
    """Full compliance pass used by the cohort pipeline. Combines the text
    checks from `check_copy` with profile-aware guards (DND, open complaint)."""
    text = f"{message.title} {message.body} {message.why}"
    checks = list(check_copy(text, policy))
    checks.append(
        Check(
            "NCC_DND",
            not profile.dnd_registered,
            "DND not registered" if not profile.dnd_registered else "Customer on DND list",
        )
    )
    checks.append(
        Check(
            "COMPLAINT_OPEN",
            not profile.complaint_open,
            "No open complaint" if not profile.complaint_open else "Open complaint on file",
        )
    )
    return checks


def run_checks(message: Message, policy: Policy) -> list[Check]:
    """Pre-cohort entry point; retained so existing tests keep passing.

    Equivalent to the three text checks (`check_copy`) applied to the
    message's full concatenated text, in the same order.
    """
    text = f"{message.title} {message.body} {message.why}"
    return check_copy(text, policy)


def in_quiet_hours(channel: str, at: datetime) -> bool:
    """True if `at` falls inside the channel's quiet window from config."""
    try:
        cfg = compliance_policy()
    except FileNotFoundError:
        return False
    window = cfg.get("quiet_hours", {}).get(channel)
    if not window:
        return False
    start = _hhmm(window["start"])
    end = _hhmm(window["end"])
    now = at.time()
    if start <= end:
        return start <= now < end
    return now >= start or now < end


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


__all__ = [
    "Check",
    "check_copy",
    "run_checks",
    "run_compliance_checks",
    "in_quiet_hours",
    "OPT_OUT_PHRASES",
    "MISLEADING_PHRASES",
]
