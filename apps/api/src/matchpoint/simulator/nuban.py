"""NUBAN check digits, and synthetic account numbers that fail them on purpose.

Algorithm: CBN NUBAN standard. The bank code is padded to 6 digits ("000" + 3-digit
DMB code, or "9" + 5-digit OFI code under the revised standard), followed by the
9-digit serial. Digits are weighted 3,7,3 repeating; the check digit is
(10 - sum % 10) % 10.

A 10-digit number is only "valid" relative to a bank code, and with enough bank codes
every number is valid for some bank. So a synthetic number is guaranteed to fail for the
bank it is assigned to and for Zenith (057), and account numbers never appear in free text
(narrations mask them).
"""

import random
import re

ZENITH = "057"

# 3-digit CBN codes of deposit money banks. Used for counterparty names and the privacy
# scan. Compiled from public sort-code lists; verify against CBN before relying on it.
BANK_CODES: dict[str, str] = {
    "011": "First Bank",
    "023": "Citibank",
    "030": "Heritage Bank",
    "032": "Union Bank",
    "033": "UBA",
    "035": "Wema Bank",
    "044": "Access Bank",
    "050": "Ecobank",
    "057": "Zenith Bank",
    "058": "GTBank",
    "068": "Standard Chartered",
    "070": "Fidelity Bank",
    "076": "Polaris Bank",
    "082": "Keystone Bank",
    "100": "SunTrust Bank",
    "101": "Providus Bank",
    "102": "Titan Trust Bank",
    "103": "Globus Bank",
    "104": "Parallex Bank",
    "105": "PremiumTrust Bank",
    "106": "Signature Bank",
    "107": "Optimus Bank",
    "214": "FCMB",
    "215": "Unity Bank",
    "221": "Stanbic IBTC",
    "232": "Sterling Bank",
    "301": "Jaiz Bank",
    "302": "TAJBank",
    "303": "Lotus Bank",
}

_WEIGHTS = (3, 7, 3) * 5
_DIGITS = re.compile(r"^\d+$")


def _institution(bank_code: str) -> str:
    if not _DIGITS.match(bank_code):
        raise ValueError(f"bank code must be digits: {bank_code!r}")
    if len(bank_code) == 3:
        return "000" + bank_code
    if len(bank_code) == 5:
        return "9" + bank_code
    if len(bank_code) == 6:
        return bank_code
    raise ValueError(f"bank code must have 3, 5 or 6 digits: {bank_code!r}")


def check_digit(bank_code: str, serial: str) -> int:
    if len(serial) != 9 or not _DIGITS.match(serial):
        raise ValueError(f"serial must be 9 digits: {serial!r}")
    digits = _institution(bank_code) + serial
    total = sum(int(d) * w for d, w in zip(digits, _WEIGHTS, strict=True))
    return (10 - total % 10) % 10


def is_valid(bank_code: str, account_no: str) -> bool:
    if len(account_no) != 10 or not _DIGITS.match(account_no):
        return False
    return check_digit(bank_code, account_no[:9]) == int(account_no[9])


def synthetic_account(rng: random.Random, bank_code: str = ZENITH) -> str:
    """A 10-digit number that is NOT a valid NUBAN at `bank_code` or at Zenith."""
    serial = f"{rng.randrange(10**9):09d}"
    taken = {check_digit(bank_code, serial), check_digit(ZENITH, serial)}
    free = [d for d in range(10) if d not in taken]
    return serial + str(rng.choice(free))
