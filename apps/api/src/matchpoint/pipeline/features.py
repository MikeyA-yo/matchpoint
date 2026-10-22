"""Feature building for the cohort pipeline.

`build_feature_vector(transactions, balances, holdings, profile)` returns the
five-group FeatureVector defined in models.py. Narration labels come from
adapters/transactions/translate.classify_narration; rows whose label is in
translate.DROP_LABELS are excluded before frequency, amount and timing stats
are computed.

The function is pure: no clock, no RNG, no I/O beyond classify_narration
(which caches the embedder itself).
"""

from __future__ import annotations

import statistics
from collections import Counter
from datetime import datetime

from matchpoint.adapters.transactions.translate import DROP_LABELS, classify_narration
from matchpoint.models import Balances, FeatureVector, Profile, Txn


def build_feature_vector(
    transactions: list[Txn],
    balances: Balances,
    holdings: list[str],
    profile: Profile,
) -> FeatureVector:
    """Compute the FeatureVector from a 180-day transaction window.

    `holdings` and `profile` are threaded through for the caller's convenience
    (eligibility reads them off the profile directly) but are not folded into
    the vector itself per the plan ("No holdings group").
    """
    labelled = _label_rows(transactions)
    kept = [row for row in labelled if row[1] not in DROP_LABELS]

    narration_counts: dict[str, int] = dict(Counter(label for _, label in kept))
    freq_txns_per_month, freq_active_days, freq_cadence_std = _frequency(kept)
    amt_median_credit, amt_surplus, amt_cv = _amount(kept)
    time_payday, time_season_flag = _timing(kept, narration_counts)

    return FeatureVector(
        customer_ref=profile.customer_ref,
        narration_counts=narration_counts,
        freq_txns_per_month=freq_txns_per_month,
        freq_active_days=freq_active_days,
        freq_cadence_std=freq_cadence_std,
        amt_median_credit=amt_median_credit,
        amt_surplus=amt_surplus,
        amt_cv=amt_cv,
        time_payday=time_payday,
        time_days_to_rent=None,
        time_season_flag=time_season_flag,
        bal_avg=balances.avg,
        bal_min=balances.min,
        bal_buffer_months=balances.buffer_months,
        bal_turnover=balances.turnover,
    )


def balances_from_transactions(transactions: list[Txn]) -> Balances:
    """Rough balance roll-ups from the transaction stream. The real pilot
    reads these from Flexcube; the sim does not expose a balance history, so
    we approximate from flow: avg monthly net flow, min monthly net, buffer
    months as avg_spend / monthly_spend, turnover as sum of credits."""
    if not transactions:
        return Balances()

    by_month_credit: dict[tuple[int, int], int] = {}
    by_month_debit: dict[tuple[int, int], int] = {}
    for txn in transactions:
        key = (txn.at.year, txn.at.month)
        amount = txn.amount_kobo or 0
        if txn.direction == "credit":
            by_month_credit[key] = by_month_credit.get(key, 0) + amount
        else:
            by_month_debit[key] = by_month_debit.get(key, 0) + amount

    months = sorted(set(by_month_credit) | set(by_month_debit))
    nets = [by_month_credit.get(m, 0) - by_month_debit.get(m, 0) for m in months]
    turnover = sum(by_month_credit.values())
    avg_net = sum(nets) // max(len(nets), 1)
    min_net = min(nets) if nets else 0
    debit_avg = sum(by_month_debit.values()) // max(len(months), 1) if months else 0
    buffer_months = (max(avg_net, 0) / debit_avg) if debit_avg > 0 else 0.0

    return Balances(
        avg=max(avg_net, 0),
        min=min_net,
        buffer_months=round(buffer_months, 2),
        turnover=turnover,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _label_rows(transactions: list[Txn]) -> list[tuple[Txn, str]]:
    out: list[tuple[Txn, str]] = []
    for txn in transactions:
        trn_code = _derive_code(txn)
        label = classify_narration(txn.narration or "", trn_code)
        out.append((txn, label))
    return out


def _derive_code(txn: Txn) -> str | None:
    """Reverse-lookup from the domain kind to a FLEXCUBE-style code so the
    classifier can take the fast path on sim data (narration may be empty)."""
    return {
        "salary": "SAL",
        "nip_in": "NIPIN",
        "nip_out": "NIPOUT",
        "pos": "POS",
        "atm": "ATM",
        "bill": "BIL",
        "airtime": "AIR",
        "charge": "CHG",
        "stamp_duty": "SD",
        "reversal": "REV",
    }.get(txn.kind)


def _frequency(rows: list[tuple[Txn, str]]) -> tuple[float, int, float]:
    if not rows:
        return 0.0, 0, 0.0
    dates = sorted({r[0].at.date() for r in rows})
    months = {(r[0].at.year, r[0].at.month) for r in rows}
    per_month = len(rows) / max(len(months), 1)
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    cadence_std = statistics.pstdev(gaps) if len(gaps) >= 2 else 0.0
    return round(per_month, 2), len(dates), round(cadence_std, 2)


def _amount(rows: list[tuple[Txn, str]]) -> tuple[int, int, float]:
    credits = [t.amount_kobo or 0 for t, _ in rows if t.direction == "credit"]
    debits = [t.amount_kobo or 0 for t, _ in rows if t.direction == "debit"]
    median_credit = int(statistics.median(credits)) if credits else 0
    surplus = sum(credits) - sum(debits)
    cv = 0.0
    if credits and len(credits) >= 2:
        mean = statistics.mean(credits)
        if mean > 0:
            cv = round(statistics.pstdev(credits) / mean, 3)
    return median_credit, max(surplus, 0), cv


def _timing(
    rows: list[tuple[Txn, str]], narration_counts: dict[str, int]
) -> tuple[int | None, bool]:
    salaries = [t.at for t, label in rows if label == "salary"]
    payday = _modal_day(salaries)
    school_months = {t.at.month for t, label in rows if label == "school_fee"}
    season = {1, 9} <= school_months
    return payday, season


def _modal_day(moments: list[datetime]) -> int | None:
    if not moments:
        return None
    days = Counter(m.day for m in moments)
    return min(days, key=lambda d: (-days[d], d))
