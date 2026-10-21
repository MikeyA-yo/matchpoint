"""Nigeria-specific colour: narrations and the dated charge schedule.

The ₦50 charge moved from receiver (EMTL) to sender (stamp duty) on 2026-01-01 under
the Nigeria Tax Act 2025. The salary exemption is CITED from one bank's notice (UBA);
until it is pinned to the Act's text it stays an ASSUMPTION. Naira card maintenance
stops from 2026-05-01 under the CBN 2026 guide (draft 21 Apr 2026).
"""

from dataclasses import dataclass
from datetime import date

from matchpoint.models import TxnKind

# Effective dates
STAMP_DUTY_START = date(2026, 1, 1)
CARD_MAINT_END = date(2026, 5, 1)

# Thresholds (kobo)
STAMP_DUTY_THRESHOLD_KOBO = 10_000_00
STAMP_DUTY_AMOUNT_KOBO = 50_00


@dataclass(frozen=True)
class ChargeSchedule:
    stamp_duty_from_sender: bool  # True from 2026-01-01; before that EMTL from receiver
    naira_card_maintenance: bool  # True before 2026-05-01
    nip_fee_bands_kobo: tuple[tuple[int, int], ...] = (
        (5_000_00, 0),      # under ₦5k: free
        (50_000_00, 10_00), # ₦5k–50k: ₦10
        (10**12, 50_00),    # above ₦50k: ₦50 (CBN cap)
    )


def charges_for(as_of: date) -> ChargeSchedule:
    return ChargeSchedule(
        stamp_duty_from_sender=as_of >= STAMP_DUTY_START,
        naira_card_maintenance=as_of < CARD_MAINT_END,
    )


def nip_fee_kobo(amount_kobo: int, as_of: date) -> int:
    for upper, fee in charges_for(as_of).nip_fee_bands_kobo:
        if amount_kobo < upper:
            return fee
    return 50_00


def stamp_duty_due(kind: TxnKind, amount_kobo: int, as_of: date, own_account: bool) -> bool:
    """A ₦50 debit falls on the sender when the transfer is ≥ ₦10k, from 2026-01-01,
    and the payment is not a salary or an own-account transfer."""
    if as_of < STAMP_DUTY_START:
        return False
    if kind in ("salary", "stamp_duty", "charge", "reversal"):
        return False
    if own_account:
        return False
    return kind == "nip_out" and amount_kobo >= STAMP_DUTY_THRESHOLD_KOBO


# ---------------------------------------------------------------------------
# Narrations. Account numbers never appear in free text.

NIP_SENDERS = (
    ("OPAY DIGITAL SERVICES", "NIP/OPAY/{ref}"),
    ("PALMPAY LIMITED", "NIP/PALMPAY/{ref}"),
    ("MONIEPOINT MFB", "NIP/MONIEPOINT/{ref}"),
    ("GTBank", "NIP/GTB/{ref}"),
    ("Access Bank", "NIP/ACCESS/{ref}"),
    ("UBA", "NIP/UBA/{ref}"),
    ("First Bank", "NIP/FBN/{ref}"),
)

POS_MERCHANTS = (
    "SHOPRITE IKEJA",
    "SPAR LEKKI",
    "ADDIDE SUPERMARKET",
    "CHICKEN REPUBLIC VI",
    "DOMINO'S PIZZA ABUJA",
    "FILLING STATION-NNPC",
    "MAMA PUT LAGOS",
    "JUMIA LOGISTICS",
    "BOLT RIDE",
    "UBER TRIP",
)

ATM_LOCATIONS = (
    "ATM/ZENITH/IKEJA MALL",
    "ATM/ZENITH/VICTORIA ISLAND",
    "ATM/GTB/MARYLAND",
    "ATM/ACCESS/WUSE 2",
    "ATM/UBA/PORT HARCOURT",
)

BILL_NARRATIONS = (
    "DSTV SUBSCRIPTION",
    "IKEDC PREPAID TOKEN",
    "EKEDC PREPAID TOKEN",
    "LAGOS WATER CORP",
    "SPECTRANET WIFI",
    "AIRTEL DATA 20GB",
)

AIRTIME_NARRATIONS = (
    "VTU/MTN/080XXXX",
    "VTU/AIRTEL/090XXXX",
    "VTU/GLO/081XXXX",
    "VTU/9MOBILE/091XXXX",
)

SCHOOL_FEE_NARRATIONS = (
    "SCHOOL FEES - FEDERAL GOVT COLLEGE",
    "SCHOOL FEES - GREENSPRING SCHOOL",
    "SCHOOL FEES - UNILAG BURSARY",
)

SALARY_NARRATIONS = (
    "SALARY/{employer}/{month}",
)

EMPLOYERS = (
    "ZENITH BANK PLC",
    "DANGOTE INDUSTRIES",
    "MTN NIGERIA",
    "ACCESS HOLDINGS",
    "LAGOS STATE GOVT",
    "FEDERAL CIVIL SERVICE",
    "FLUTTERWAVE NG",
)
