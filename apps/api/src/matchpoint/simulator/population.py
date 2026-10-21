"""Seven hand-made demo customers. Every demo case picks from this list.

Each customer has a short "story" the demo tells, which drives the consent setup,
the transactions that get generated, and the receipts the gateway returns. The
account_no is a NUBAN that fails the check digit on purpose (see nuban.py).
"""

from dataclasses import dataclass, field

from matchpoint.adapters.refs import RefHasher
from matchpoint.models import Channel
from matchpoint.simulator.nuban import ZENITH, synthetic_account
from matchpoint.simulator.rng import derive


@dataclass(frozen=True)
class DemoCustomer:
    key: str                     # stable identifier used for the simulator's RNG
    name: str
    source_id: str               # "ZEN-xxxx", what FLEXCUBE would carry
    age_band: str
    segment: str                 # salaried | trader | sme | student
    state: str
    holdings: tuple[str, ...]
    employer: str | None
    monthly_salary_kobo: int | None
    channels: dict[Channel, bool]
    personalised_offers: bool
    blocks_marketing: bool = False   # open complaint, etc.
    story: str = ""
    extras: dict[str, bool] = field(default_factory=dict)


DEMO_CUSTOMERS: tuple[DemoCustomer, ...] = (
    DemoCustomer(
        key="adaeze",
        name="Adaeze Okafor",
        source_id="ZEN-0010001",
        age_band="25-34",
        segment="salaried",
        state="Lagos",
        holdings=("current_account",),
        employer="FLUTTERWAVE NG",
        monthly_salary_kobo=850_000_00,
        channels={"app": True, "whatsapp": True, "sms": False, "email": True, "ussd": False},
        personalised_offers=True,
        story="Steady salary on the 25th. Prime candidate for a target savings nudge.",
    ),
    DemoCustomer(
        key="musa",
        name="Musa Ibrahim",
        source_id="ZEN-0010002",
        age_band="35-44",
        segment="trader",
        state="Kano",
        holdings=("current_account",),
        employer=None,
        monthly_salary_kobo=None,
        channels={"app": True, "whatsapp": True, "sms": True, "email": False, "ussd": True},
        personalised_offers=True,
        story="High POS inflow, no salary. Candidate for a business account.",
    ),
    DemoCustomer(
        key="tunde",
        name="Tunde Bakare",
        source_id="ZEN-0010003",
        age_band="35-44",
        segment="salaried",
        state="FCT",
        holdings=("current_account", "savings_account"),
        employer="FEDERAL CIVIL SERVICE",
        monthly_salary_kobo=620_000_00,
        channels={"app": True, "whatsapp": True, "sms": True, "email": True, "ussd": False},
        personalised_offers=True,
        story="School fees every January and September. Target savings fits the pattern.",
        extras={"school_fees": True},
    ),
    DemoCustomer(
        key="chiamaka",
        name="Chiamaka Eze",
        source_id="ZEN-0010004",
        age_band="25-34",
        segment="sme",
        state="Rivers",
        holdings=("current_account",),
        employer=None,
        monthly_salary_kobo=None,
        channels={"app": True, "whatsapp": True, "sms": True, "email": True, "ussd": False},
        personalised_offers=True,
        story="SME with growing inflows. Candidate for business collections.",
    ),
    DemoCustomer(
        key="emeka",
        name="Emeka Nwosu",
        source_id="ZEN-0010005",
        age_band="45-54",
        segment="salaried",
        state="Lagos",
        holdings=("current_account", "savings_account", "personal_loan"),
        employer="ZENITH BANK PLC",
        monthly_salary_kobo=1_450_000_00,
        channels={"app": True, "whatsapp": False, "sms": True, "email": True, "ussd": False},
        personalised_offers=True,
        story="Already holds a loan. Credit offers must go to review.",
    ),
    DemoCustomer(
        key="ngozi",
        name="Ngozi Afolabi",
        source_id="ZEN-0010006",
        age_band="18-24",
        segment="student",
        state="Enugu",
        holdings=("savings_account",),
        employer=None,
        monthly_salary_kobo=None,
        channels={"app": True, "whatsapp": False, "sms": False, "email": False, "ussd": False},
        personalised_offers=False,
        story="No personalised offers. Everything should return silent, NO_CONSENT.",
    ),
    DemoCustomer(
        key="halima",
        name="Halima Yusuf",
        source_id="ZEN-0010007",
        age_band="35-44",
        segment="salaried",
        state="Kaduna",
        holdings=("current_account",),
        employer="LAGOS STATE GOVT",
        monthly_salary_kobo=480_000_00,
        channels={"app": True, "whatsapp": True, "sms": True, "email": True, "ussd": False},
        personalised_offers=True,
        blocks_marketing=True,
        story="Open complaint on file. Marketing blocked even with consent on.",
    ),
)


BY_KEY: dict[str, DemoCustomer] = {c.key: c for c in DEMO_CUSTOMERS}


def account_numbers(seed: int) -> dict[str, str]:
    """Stable, seeded NUBANs that all fail the check digit for Zenith."""
    out: dict[str, str] = {}
    for customer in DEMO_CUSTOMERS:
        out[customer.source_id] = synthetic_account(derive(seed, "nuban", customer.key), ZENITH)
    return out


def build_ref_map(hasher: RefHasher) -> dict[str, str]:
    """customer_ref → source_id, so the ConsentStore and TransactionFeed can share refs."""
    return {hasher.ref(c.source_id): c.source_id for c in DEMO_CUSTOMERS}
