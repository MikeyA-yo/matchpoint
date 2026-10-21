"""Compute balance, tier and next tier for a customer's rewards account."""

from __future__ import annotations

from matchpoint.rewards.ledger import RewardsLedger
from matchpoint.rewards.rules import TIERS


def tier_for(points: int) -> tuple[str, int]:
    """Return (tier_name, threshold) for a point balance."""
    name = TIERS[0][0]
    threshold = TIERS[0][1]
    for t_name, t_threshold in TIERS:
        if points >= t_threshold:
            name = t_name
            threshold = t_threshold
    return name, threshold


def next_tier(points: int) -> dict | None:
    """Return the next tier and points needed, or None if at the top tier."""
    for t_name, t_threshold in TIERS:
        if points < t_threshold:
            return {"name": t_name, "points_needed": t_threshold - points}
    return None


def account(customer_ref: str, ledger: RewardsLedger) -> dict:
    balance = ledger.balance(customer_ref)
    tier, _ = tier_for(balance)
    return {
        "customer_ref": customer_ref,
        "balance": balance,
        "lifetime_earned": balance,
        "tier": tier,
        "next_tier": next_tier(balance),
    }
