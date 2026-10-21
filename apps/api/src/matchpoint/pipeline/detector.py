"""Step 4 helper: turn transactions into signals, then screen blocked categories.

The detector is a feature store in miniature. Each signal says what it saw and carries
evidence a reviewer can check. It never sees products, consent or contact history.

Blocked categories are screened, not silently dropped: the caller keeps the evidence in
the trace and only lets usable signals through to the matcher.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from matchpoint.models import Txn

RECENT_DAYS = 90
SMALL_PAYMENT_KOBO = 50_000_00
BUSINESS_INFLOW_MIN = 6
SMALL_PAYMENT_MIN = 12
SALARY_MONTHS_MIN = 3

_BETTING_MARKERS = ("BET9JA", "SPORTYBET", "1XBET", "BETTING")


@dataclass(frozen=True)
class Signal:
    type: str
    evidence: str
    category: str | None = None
    blocked: bool = False


def detect_signals(
    transactions: list[Txn],
    as_of: datetime,
    blocked_categories: tuple[str, ...] = (),
) -> list[Signal]:
    """Every signal found in the window, in a fixed order, with blocked ones marked."""
    recent = [t for t in transactions if t.at >= as_of - timedelta(days=RECENT_DAYS)]
    found = (
        _salary_regular(transactions),
        _fee_season(transactions),
        _business_inflows(recent),
        _small_frequent_spend(recent),
        _surplus(recent),
        _fees(transactions),
        _recurring_bill(recent),
        _betting(transactions),
    )
    return [
        replace(signal, blocked=signal.category in blocked_categories)
        for signal in found
        if signal is not None
    ]


def _salary_regular(transactions: list[Txn]) -> Signal | None:
    salaries = [t for t in transactions if t.kind == "salary" and t.direction == "credit"]
    months = {(t.at.year, t.at.month) for t in salaries}
    if len(months) < SALARY_MONTHS_MIN:
        return None
    days = Counter(t.at.day for t in salaries)
    day = min(days, key=lambda d: (-days[d], d))
    return Signal("salary_regular", f"salary on the {_ordinal(day)}, {len(months)} months")


def _fee_season(transactions: list[Txn]) -> Signal | None:
    months = {
        t.at.month
        for t in transactions
        if t.direction == "debit" and "SCHOOL FEE" in (t.narration or "").upper()
    }
    if {1, 9} <= months:
        return Signal("fee_season", "fees paid each January and September")
    return None


def _business_inflows(recent: list[Txn]) -> Signal | None:
    inflows = [
        t for t in recent if t.direction == "credit" and t.kind in ("pos", "nip_in")
    ]
    if len(inflows) < BUSINESS_INFLOW_MIN:
        return None
    return Signal(
        "business_inflows", f"{len(inflows)} business inflows in the last 90 days"
    )


def _small_frequent_spend(recent: list[Txn]) -> Signal | None:
    small = [
        t
        for t in recent
        if t.direction == "debit"
        and t.kind in ("pos", "atm", "airtime", "bill")
        and (t.amount_kobo or 0) <= SMALL_PAYMENT_KOBO
    ]
    if len(small) < SMALL_PAYMENT_MIN:
        return None
    return Signal(
        "small_frequent_spend",
        f"{len(small)} payments under ₦50,000 in the last 90 days",
    )


def _surplus(recent: list[Txn]) -> Signal | None:
    credits: dict[tuple[int, int], int] = defaultdict(int)
    debits: dict[tuple[int, int], int] = defaultdict(int)
    for txn in recent:
        month = (txn.at.year, txn.at.month)
        amount = txn.amount_kobo or 0
        if txn.direction == "credit":
            credits[month] += amount
        else:
            debits[month] += amount
    months = sorted(set(credits) | set(debits))[-3:]
    positive = sum(1 for month in months if credits[month] > debits[month])
    if positive < 2:
        return None
    return Signal(
        "surplus", f"income above spending in {positive} of the last {len(months)} months"
    )


def _fees(transactions: list[Txn]) -> Signal | None:
    months = {
        (t.at.year, t.at.month)
        for t in transactions
        if t.direction == "debit" and t.kind in ("charge", "stamp_duty")
    }
    if len(months) < SALARY_MONTHS_MIN:
        return None
    return Signal("fees", f"bank charges in {len(months)} months")


def _recurring_bill(recent: list[Txn]) -> Signal | None:
    months = {
        (txn.at.year, txn.at.month)
        for txn in recent
        if txn.direction == "debit" and txn.kind == "bill"
    }
    if len(months) < 3:
        return None
    return Signal("recurring_bill_pattern", f"bills paid in {len(months)} months")


def _betting(transactions: list[Txn]) -> Signal | None:
    hits = [
        t
        for t in transactions
        if t.direction == "debit"
        and any(marker in (t.narration or "").upper() for marker in _BETTING_MARKERS)
    ]
    if not hits:
        return None
    return Signal(
        "betting_spend",
        f"{len(hits)} betting payments in the last 12 months",
        category="betting",
    )


def _ordinal(day: int) -> str:
    if 11 <= day % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"
