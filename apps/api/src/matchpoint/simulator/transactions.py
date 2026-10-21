"""Transaction generator for the demo customers.

Returns FLEXCUBE-shaped rows (vendor shape). The connector translates them. This
keeps the simulator honest: translation code runs in the demo too.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from random import Random

from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.clock import WAT
from matchpoint.models import TxnKind
from matchpoint.simulator.nigeria import (
    AIRTIME_NARRATIONS,
    ATM_LOCATIONS,
    BILL_NARRATIONS,
    EMPLOYERS,
    NIP_SENDERS,
    POS_MERCHANTS,
    SCHOOL_FEE_NARRATIONS,
    STAMP_DUTY_AMOUNT_KOBO,
    nip_fee_kobo,
    stamp_duty_due,
)
from matchpoint.simulator.population import DemoCustomer
from matchpoint.simulator.rng import derive


@dataclass(frozen=True)
class _Txn:
    at: datetime
    direction: str
    kind: TxnKind
    amount_kobo: int
    narration: str
    related: str | None = None


def generate_rows(
    customer: DemoCustomer, account_no: str, start: date, end: date, seed: int
) -> list[FlexcubeTxnRow]:
    """Return every FLEXCUBE row for `customer` in `[start, end)`.

    The customer's RNG stream is keyed on the customer and the window start, so a
    repeated call for the same window gives the same rows.
    """
    rng = derive(seed, "txns", customer.key, start.isoformat())
    events: list[_Txn] = []
    cursor = start
    while cursor < end:
        _month_events(customer, cursor, rng, events)
        cursor = _next_month(cursor)
    _append_charges(customer, events, rng)

    events.sort(key=lambda t: t.at)
    rows: list[FlexcubeTxnRow] = []
    for i, ev in enumerate(events):
        if not (start <= ev.at.date() < end):
            continue
        rows.append(
            FlexcubeTxnRow(
                TRN_REF_NO=f"{customer.key[:3].upper()}{ev.at.strftime('%Y%m%d')}{i:04d}",
                AC_NO=account_no,
                TRN_DT=ev.at.isoformat(),
                VALUE_DT=ev.at.date().isoformat(),
                DRCR_IND="D" if ev.direction == "debit" else "C",
                LCY_AMOUNT=ev.amount_kobo,
                TRN_CODE=_code_for(ev.kind),
                NARRATION=ev.narration,
                RELATED_REF=ev.related or "",
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Month-by-month event generator.

def _month_events(c: DemoCustomer, in_month: date, rng: Random, out: list[_Txn]) -> None:
    y, m = in_month.year, in_month.month

    # Salary on the 25th (or last working day if the 25th is a weekend).
    if c.segment == "salaried" and c.monthly_salary_kobo:
        salary_day = _salary_day(y, m)
        at = _at(y, m, salary_day, 9, 15)
        employer = c.employer or rng.choice(EMPLOYERS)
        narration = f"SALARY/{employer}/{at.strftime('%b %Y').upper()}"
        out.append(_Txn(at, "credit", "salary", c.monthly_salary_kobo, narration))

    # Trader / SME: lumpy POS and NIP inflows across the month.
    inflow_days = _inflow_days(c, rng)
    for day in inflow_days:
        at = _at(y, m, day, rng.randint(9, 18), rng.randint(0, 59))
        if rng.random() < 0.6:
            amount = _lumpy_amount(c, rng)
            out.append(_Txn(at, "credit", "pos", amount, rng.choice(POS_MERCHANTS)))
        else:
            amount = _lumpy_amount(c, rng)
            sender, template = rng.choice(NIP_SENDERS)
            ref = f"{at.strftime('%d%m%H%M')}{rng.randrange(1000):03d}"
            narration = template.format(ref=ref) + f" FROM {sender}"
            out.append(_Txn(at, "credit", "nip_in", amount, narration))

    # Spending: POS, ATM, bills, airtime, NIP-out transfers.
    spends = _spend_count(c, rng)
    for _ in range(spends):
        day = rng.randint(1, _month_days(y, m))
        at = _at(y, m, day, rng.randint(8, 21), rng.randint(0, 59))
        amount = _spend_amount(c, rng)
        pick = rng.random()
        if pick < 0.45:
            out.append(_Txn(at, "debit", "pos", amount, rng.choice(POS_MERCHANTS)))
        elif pick < 0.65:
            out.append(_Txn(at, "debit", "atm", _round_up(amount, 1_000_00),
                            rng.choice(ATM_LOCATIONS)))
        elif pick < 0.80:
            out.append(_Txn(at, "debit", "bill", amount, rng.choice(BILL_NARRATIONS)))
        elif pick < 0.90:
            out.append(_Txn(at, "debit", "airtime", _airtime_amount(rng),
                            rng.choice(AIRTIME_NARRATIONS)))
        else:
            # Outgoing NIP to another bank.
            _, template = rng.choice(NIP_SENDERS)
            ref = f"{at.strftime('%d%m%H%M')}{rng.randrange(1000):03d}"
            narration = template.format(ref=ref)
            out.append(_Txn(at, "debit", "nip_out", amount, narration))

    # School fees for Tunde: January and September only.
    if c.extras.get("school_fees") and m in (1, 9):
        at = _at(y, m, 7, 10, 0)
        amount = 450_000_00 if m == 1 else 480_000_00
        out.append(_Txn(at, "debit", "nip_out", amount, SCHOOL_FEE_NARRATIONS[0]))

    # Monthly SMS alert bundle, as a token charge.
    at = _at(y, m, _month_days(y, m), 20, 0)
    out.append(_Txn(at, "debit", "charge", 400_00, "SMS ALERT CHARGES"))


def _append_charges(c: DemoCustomer, events: list[_Txn], rng: Random) -> None:
    extras: list[_Txn] = []
    for ev in events:
        if ev.kind != "nip_out":
            continue
        fee = nip_fee_kobo(ev.amount_kobo, ev.at.date())
        if fee:
            at = ev.at + timedelta(seconds=1)
            extras.append(_Txn(at, "debit", "charge", fee, f"CHG/NIP FEE/{_ref_from(ev)}"))
        if stamp_duty_due(ev.kind, ev.amount_kobo, ev.at.date(), own_account=False):
            at = ev.at + timedelta(seconds=2)
            extras.append(_Txn(at, "debit", "stamp_duty", STAMP_DUTY_AMOUNT_KOBO,
                               f"STAMP DUTY/{_ref_from(ev)}"))
    events.extend(extras)


# ---------------------------------------------------------------------------
# Helpers.

_CODES: dict[TxnKind, str] = {
    "salary": "SAL", "nip_in": "NIPI", "nip_out": "NIPO", "pos": "POS",
    "atm": "ATM", "bill": "BIL", "airtime": "VTU", "charge": "CHG",
    "stamp_duty": "STD", "reversal": "REV", "other": "OTH",
}


def _code_for(kind: TxnKind) -> str:
    return _CODES[kind]


def _at(y: int, m: int, d: int, h: int, mi: int) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=WAT)


def _month_days(y: int, m: int) -> int:
    return monthrange(y, m)[1]


def _salary_day(y: int, m: int) -> int:
    d = date(y, m, 25)
    # Shift Saturdays and Sundays back to the preceding Friday.
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.day


def _next_month(d: date) -> date:
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(y, m, 1)


def _inflow_days(c: DemoCustomer, rng: Random) -> list[int]:
    if c.segment == "trader":
        return sorted(rng.sample(range(1, 29), 12))
    if c.segment == "sme":
        return sorted(rng.sample(range(1, 29), 8))
    return []


def _spend_count(c: DemoCustomer, rng: Random) -> int:
    if c.segment in ("trader", "sme"):
        return rng.randint(14, 22)
    if c.segment == "salaried":
        return rng.randint(10, 18)
    return rng.randint(4, 8)


def _lumpy_amount(c: DemoCustomer, rng: Random) -> int:
    base = 150_000_00 if c.segment == "sme" else 50_000_00
    return rng.randint(base // 2, base * 2)


def _spend_amount(c: DemoCustomer, rng: Random) -> int:
    cap = c.monthly_salary_kobo or 400_000_00
    return rng.randint(1_500_00, max(2_000_00, cap // 10))


def _airtime_amount(rng: Random) -> int:
    return rng.choice([200_00, 500_00, 1_000_00, 2_000_00])


def _round_up(amount: int, step: int) -> int:
    return ((amount + step - 1) // step) * step


def _ref_from(ev: _Txn) -> str:
    # Last 10 characters of the narration, uppercase, no spaces.
    return "".join(ev.narration.split())[-10:].upper()
