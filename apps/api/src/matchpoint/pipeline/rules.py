"""Step 6 helpers: the hard rules, in the order the pipeline applies them.

Hard rules always win: a candidate that fails one is dropped, and the reason is kept.
Quiet hours are the exception on purpose. They move the send to the end of the window
instead of dropping the offer. Credit products are referred to a person rather than held,
because an automated credit offer has real consequences.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from matchpoint.pipeline.channels import choose_channel, next_window_end
from matchpoint.pipeline.context import Context, ScoredProduct
from matchpoint.pipeline.schemas import Outcome


@dataclass(frozen=True)
class RuleResult:
    rule: str
    passed: bool
    detail: str
    dropped: str | None = None
    outcome: Outcome | None = None
    scheduled_for: datetime | None = None
    reasons: tuple[str, ...] = ()


def contact_cap(ctx: Context, _: ScoredProduct | None = None) -> RuleResult:
    used = ctx.contacts_30d
    limit = ctx.policy.max_messages_per_30d
    passed = used < limit
    return RuleResult(
        "CAP_30D",
        passed,
        f"{used} of {limit} used in the last 30 days",
        dropped=None if passed else "CAP_30D",
        outcome=None if passed else "hold",
    )


def dnd_sms(ctx: Context, _: ScoredProduct | None = None) -> RuleResult:
    if ctx.profile and ctx.profile.dnd_registered:
        return RuleResult("DND_SMS", True, "SMS skipped: number is on the NCC DND registry")
    return RuleResult("DND_SMS", True, "SMS is not blocked for this customer")


def channel_consent(ctx: Context, candidate: ScoredProduct) -> RuleResult:
    if ctx.consent is None:
        return RuleResult(
            "NO_CHANNEL_CONSENT",
            False,
            f"{candidate.product.id}: consent was not loaded",
            dropped="NO_CHANNEL_CONSENT",
            outcome="hold",
        )
    sms_allowed = not (ctx.profile and ctx.profile.dnd_registered)
    channel = choose_channel(ctx.consent, candidate.product, sms_allowed=sms_allowed)
    if channel is None:
        return RuleResult(
            "NO_CHANNEL_CONSENT",
            False,
            f"{candidate.product.id}: no consented channel",
            dropped="NO_CHANNEL_CONSENT",
            outcome="hold",
        )
    candidate.channel = channel
    return RuleResult(
        "NO_CHANNEL_CONSENT", True, f"{candidate.product.id}: using {channel}"
    )


def same_product_gap(ctx: Context, candidate: ScoredProduct) -> RuleResult:
    days = ctx.days_since(candidate.product.id)
    gap = ctx.policy.same_product_gap_days
    if days is None:
        return RuleResult(
            "SAME_PRODUCT_60D",
            True,
            f"{candidate.product.id}: never sent before",
        )
    if days < gap:
        return RuleResult(
            "SAME_PRODUCT_60D",
            False,
            f"{candidate.product.id}: last sent {days:.0f} days ago, gap is {gap}",
            dropped="SAME_PRODUCT_60D",
            outcome="hold",
        )
    return RuleResult(
        "SAME_PRODUCT_60D",
        True,
        f"{candidate.product.id}: last sent {days:.0f} days ago",
    )


def cooldown_ignored(ctx: Context, candidate: ScoredProduct) -> RuleResult:
    days = ctx.days_since_ignored(candidate.product.id)
    cooldown = ctx.policy.cooldown_after_ignored_days
    if days is not None and days < cooldown:
        return RuleResult(
            "COOLDOWN_IGNORED",
            False,
            f"{candidate.product.id}: ignored {days:.0f} days ago",
            dropped="COOLDOWN_IGNORED",
            outcome="hold",
        )
    return RuleResult(
        "COOLDOWN_IGNORED", True, f"{candidate.product.id}: no recent decline"
    )


def quiet_hours(ctx: Context, candidate: ScoredProduct) -> RuleResult:
    channel = candidate.channel
    window = ctx.policy.quiet_until(ctx.as_of.time(), channel) if channel else None
    if channel is None or window is None:
        return RuleResult(
            "QUIET_HOURS", True, f"{candidate.product.id}: outside quiet hours"
        )
    scheduled_for = next_window_end(ctx.as_of, window)
    candidate.scheduled_for = scheduled_for
    return RuleResult(
        "QUIET_HOURS",
        True,
        f"{candidate.product.id}: {channel} quiet until {scheduled_for.isoformat()}",
        scheduled_for=scheduled_for,
        reasons=("QUIET_HOURS",),
    )


def credit_review(ctx: Context, candidate: ScoredProduct) -> RuleResult:
    if candidate.product.is_credit and ctx.policy.credit_requires_review:
        return RuleResult(
            "CREDIT_REVIEW",
            False,
            f"{candidate.product.id}: credit offer needs a person",
            dropped="CREDIT_REVIEW",
            outcome="review",
        )
    return RuleResult(
        "CREDIT_REVIEW", True, f"{candidate.product.id}: not a credit product"
    )


CANDIDATE_RULES: tuple[Callable[[Context, ScoredProduct], RuleResult], ...] = (
    channel_consent,
    same_product_gap,
    cooldown_ignored,
    quiet_hours,
    credit_review,
)

RULES: dict[str, Callable[..., RuleResult]] = {
    "CAP_30D": contact_cap,
    "DND_SMS": dnd_sms,
    "NO_CHANNEL_CONSENT": channel_consent,
    "SAME_PRODUCT_60D": same_product_gap,
    "COOLDOWN_IGNORED": cooldown_ignored,
    "QUIET_HOURS": quiet_hours,
    "CREDIT_REVIEW": credit_review,
}
