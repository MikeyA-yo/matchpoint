"""Illustrative naira gains for the message copy.

These are deliberately simple: a share of salary or business inflows for savings, a
share of bill spend for fee savings, and an example rate from the product. Nothing here
is a promise. The gain is only used to make the message concrete; the decision is made
by the rules, not by the size of the number.
"""

from __future__ import annotations

from collections import defaultdict

from matchpoint.models import Product, Txn
from matchpoint.pipeline.detector import Signal

SMALL_PAYMENT_KOBO = 50_000_00
SAVING_SHARE = 10
ROUND_UP_SHARE = 20


def estimate_gain(
    product: Product, signals: list[Signal], transactions: list[Txn]
) -> int | None:
    spec = product.gain
    if spec is None or spec.example_rate is None or spec.kind == "cost":
        return None

    kinds = {signal.type for signal in signals}
    if spec.kind == "interest":
        base = _saving_base(kinds, transactions)
    else:
        base = _fee_base(kinds, transactions)
    if base <= 0:
        return None
    return int(base * spec.example_rate * spec.months / 12)


def _saving_base(kinds: set[str], transactions: list[Txn]) -> int:
    if "salary_regular" in kinds:
        return _monthly_average(transactions, "salary", "credit") // SAVING_SHARE
    if "business_inflows" in kinds:
        return _monthly_average(transactions, ("pos", "nip_in"), "credit") // ROUND_UP_SHARE
    if "small_frequent_spend" in kinds:
        return _small_spend_average(transactions) // ROUND_UP_SHARE
    if "recurring_bill_pattern" in kinds:
        return _monthly_average(transactions, "bill", "debit") // ROUND_UP_SHARE
    return 0


def _fee_base(kinds: set[str], transactions: list[Txn]) -> int:
    if "business_inflows" in kinds:
        return _monthly_average(transactions, ("pos", "nip_in"), "credit")
    if "recurring_bill_pattern" in kinds:
        return _monthly_average(transactions, "bill", "debit")
    return _monthly_average(transactions, ("charge", "stamp_duty"), "debit")


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
