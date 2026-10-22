"""Illustrative naira gains for the message copy.

These are deliberately simple: a share of salary or business inflows for savings, a
share of bill spend for fee savings, and an example rate from the product. Nothing here
is a promise. The gain is only used to make the message concrete; the decision is made
by the rules, not by the size of the number.

The cohort pipeline passes a FeatureVector (plus the transactions window) so the
estimate reads out of a stable per-customer summary rather than ad-hoc signal names.
"""

from __future__ import annotations

from collections import defaultdict

from matchpoint.models import FeatureVector, Product, Txn

SMALL_PAYMENT_KOBO = 50_000_00
SAVING_SHARE = 10
ROUND_UP_SHARE = 20


def estimate_gain(
    product: Product, features: FeatureVector, transactions: list[Txn]
) -> int:
    """Return an illustrative kobo gain for this product and customer. Zero
    when no useful base is available (never None, so the trace stays total)."""
    spec = product.gain
    if spec is None or spec.example_rate is None or spec.kind == "cost":
        return 0

    counts = features.narration_counts or {}
    salary_regular = counts.get("salary", 0) >= 3
    business_inflow = counts.get("business_inflow", 0) + counts.get("pos", 0) >= 6
    small_spend = counts.get("pos", 0) + counts.get("atm", 0) + counts.get("airtime", 0) >= 12
    recurring_bill = counts.get("utility", 0) >= 3

    if spec.kind == "interest":
        base = _saving_base(
            salary_regular, business_inflow, small_spend, recurring_bill, features, transactions
        )
    else:
        base = _fee_base(business_inflow, recurring_bill, features, transactions)
    if base <= 0:
        return 0
    return int(base * spec.example_rate * spec.months / 12)


def _saving_base(
    salary_regular: bool,
    business_inflow: bool,
    small_spend: bool,
    recurring_bill: bool,
    features: FeatureVector,
    transactions: list[Txn],
) -> int:
    if salary_regular:
        monthly = _monthly_average(transactions, "salary", "credit")
        if monthly == 0 and features.amt_median_credit:
            monthly = features.amt_median_credit
        return monthly // SAVING_SHARE
    if business_inflow:
        return _monthly_average(transactions, ("pos", "nip_in"), "credit") // ROUND_UP_SHARE
    if small_spend:
        return _small_spend_average(transactions) // ROUND_UP_SHARE
    if recurring_bill:
        return _monthly_average(transactions, "bill", "debit") // ROUND_UP_SHARE
    if features.amt_surplus > 0:
        return features.amt_surplus // SAVING_SHARE
    return 0


def _fee_base(
    business_inflow: bool,
    recurring_bill: bool,
    features: FeatureVector,
    transactions: list[Txn],
) -> int:
    if business_inflow:
        return _monthly_average(transactions, ("pos", "nip_in"), "credit")
    if recurring_bill:
        return _monthly_average(transactions, "bill", "debit")
    base = _monthly_average(transactions, ("charge", "stamp_duty"), "debit")
    if base == 0 and features.bal_turnover:
        base = features.bal_turnover // 100  # 1% of turnover as a tiny fallback
    return base


def _monthly_average(
    transactions: list[Txn],
    kinds: str | tuple[str, ...],
    direction: str,
) -> int:
    totals: dict[tuple[int, int], int] = defaultdict(int)
    wanted = (kinds,) if isinstance(kinds, str) else kinds
    for txn in transactions:
        if txn.direction == direction and txn.kind in wanted:
            totals[(txn.at.year, txn.at.month)] += txn.amount_kobo or 0
    if not totals:
        return 0
    return sum(totals.values()) // len(totals)


def _small_spend_average(transactions: list[Txn]) -> int:
    totals: dict[tuple[int, int], int] = defaultdict(int)
    for txn in transactions:
        if (
            txn.direction == "debit"
            and txn.kind in ("pos", "atm", "airtime", "bill")
            and (txn.amount_kobo or 0) <= SMALL_PAYMENT_KOBO
        ):
            totals[(txn.at.year, txn.at.month)] += txn.amount_kobo or 0
    if not totals:
        return 0
    return sum(totals.values()) // len(totals)
