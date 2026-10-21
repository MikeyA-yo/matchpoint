"""Demo control for the simulator: start, inject a pattern, read state.

`n_customers` is what the console asked for (5,000 by default). The generator behind it
is still the seven hand-made customers, so the state also reports
`simulated_customers`; the difference is on the wire, not hidden.

Injection plants FLEXCUBE-shaped rows for one customer and bumps that customer's epoch
so the next evaluation runs again instead of returning the decision from before the
pattern. Rows live in the transport, so the pipeline sees them through the same adapter
as every other transaction.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.clock import WAT
from matchpoint.simulator.clock import SimClock
from matchpoint.simulator.nigeria import POS_MERCHANTS, SCHOOL_FEE_NARRATIONS
from matchpoint.simulator.population import DEMO_CUSTOMERS
from matchpoint.simulator.transports.flexcube import SimFlexcubeTransport

Pattern = Literal["salary_pattern", "fee_season", "sme_growth"]
PATTERNS: tuple[Pattern, ...] = ("salary_pattern", "fee_season", "sme_growth")

DEFAULT_SEED = 42
DEFAULT_POPULATION = 5_000
DEFAULT_DAYS = 120
DEFAULT_SCENARIO = "baseline"

# The share of the population an un-targeted injection claims to touch.
POPULATION_SHARE = 0.05
INJECTED_EVENTS_KEPT = 10

# From docs/api_design.md section 2: the simulator's fixed start.
SIM_START = datetime(2026, 12, 3, 9, 0, tzinfo=WAT)

_SALARY_KOBO = 450_000_00
_FEE_JAN_KOBO = 450_000_00
_FEE_SEP_KOBO = 480_000_00


@dataclass(frozen=True)
class SimConfig:
    seed: int = DEFAULT_SEED
    n_customers: int = DEFAULT_POPULATION
    days: int = DEFAULT_DAYS
    scenario: str = DEFAULT_SCENARIO


@dataclass(frozen=True)
class InjectedEvent:
    pattern: Pattern
    customer_ref: str | None
    affected: int
    at: datetime


@dataclass(frozen=True)
class InjectResult:
    pattern: Pattern
    customer_ref: str | None
    affected: int


@dataclass(frozen=True)
class SimState:
    config: SimConfig
    running: bool
    clock: datetime | None
    simulated_customers: int
    injected: tuple[InjectedEvent, ...]

    @property
    def seed(self) -> int:
        return self.config.seed

    @property
    def n_customers(self) -> int:
        return self.config.n_customers

    @property
    def days(self) -> int:
        return self.config.days

    @property
    def scenario(self) -> str:
        return self.config.scenario

    @property
    def simulated(self) -> bool:
        return True


class SimWorld:
    """The control state around one transport: config, running flag, epochs, plantings."""

    def __init__(self, clock: SimClock, flexcube: SimFlexcubeTransport) -> None:
        self.clock = clock
        self.flexcube = flexcube
        self.config = SimConfig()
        self.running = False
        self._epochs: dict[str, int] = {}
        self._patterns: dict[str, set[Pattern]] = {}
        self._injected: list[InjectedEvent] = []

    def state(self) -> SimState:
        return SimState(
            config=self.config,
            running=self.running,
            clock=self.clock.now() if self.running else None,
            simulated_customers=len(DEMO_CUSTOMERS),
            injected=tuple(self._injected),
        )

    def start(self, config: SimConfig) -> SimState:
        """Begin a run at the fixed start. Epochs are kept, so a restart never un-caches."""
        self.config = config
        self.running = True
        self.clock.set(SIM_START)
        self._patterns.clear()
        self._injected.clear()
        self.flexcube.clear_planted()
        return self.state()

    def epoch_for(self, customer_ref: str) -> int:
        return self._epochs.get(customer_ref, 0)

    def invalidate(self, customer_ref: str) -> int:
        """Bump the customer's epoch. Called when their world changes under a decision."""
        epoch = self._epochs.get(customer_ref, 0) + 1
        self._epochs[customer_ref] = epoch
        return epoch

    def inject(self, pattern: Pattern, customer_ref: str | None) -> InjectResult:
        """Plant one pattern for one customer, or report the share for the population."""
        affected = 1 if customer_ref else round(self.config.n_customers * POPULATION_SHARE)
        if customer_ref is not None:
            self._plant(pattern, customer_ref)
            self.invalidate(customer_ref)
        self._injected.append(
            InjectedEvent(
                pattern=pattern,
                customer_ref=customer_ref,
                affected=affected,
                at=self.clock.now(),
            )
        )
        del self._injected[:-INJECTED_EVENTS_KEPT]
        return InjectResult(pattern=pattern, customer_ref=customer_ref, affected=affected)

    def _plant(self, pattern: Pattern, customer_ref: str) -> None:
        seen = self._patterns.setdefault(customer_ref, set())
        if pattern in seen:
            return
        seen.add(pattern)
        now = self.clock.now()
        rows = {
            "salary_pattern": _salary_rows,
            "fee_season": _fee_rows,
            "sme_growth": _sme_rows,
        }[pattern](now)
        self.flexcube.plant(customer_ref, rows)


# ---------------------------------------------------------------------------
# Pattern rows. Each one is what the detector already knows how to read.


def _salary_rows(now: datetime) -> list[FlexcubeTxnRow]:
    """Three salary credits: the detector needs three distinct months."""
    months: list[datetime] = []
    for back in range(0, 6):
        at = _on_day(_month_start(now, back), 25, 9, 15)
        if at <= now:
            months.append(at)
        if len(months) == 3:
            break
    return [
        _row(
            f"INJ-SAL-{at:%Y%m%d}",
            at,
            "C",
            "SAL",
            _SALARY_KOBO,
            f"SALARY/MERCHANT SERVICES/{at:%b %Y}".upper(),
        )
        for at in months
    ]


def _fee_rows(now: datetime) -> list[FlexcubeTxnRow]:
    """January and September school fees: both months must fall inside the 365-day window."""
    rows: list[FlexcubeTxnRow] = []
    for month, amount in ((1, _FEE_JAN_KOBO), (9, _FEE_SEP_KOBO)):
        at = _on_day(datetime(now.year, month, 1, tzinfo=WAT), 7, 10, 0)
        if at > now:
            at = at.replace(year=now.year - 1)
        rows.append(
            _row(
                f"INJ-FEE-{at:%Y%m%d}",
                at,
                "D",
                "NIPO",
                amount,
                SCHOOL_FEE_NARRATIONS[0],
            )
        )
    return rows


def _sme_rows(now: datetime) -> list[FlexcubeTxnRow]:
    """Six business inflows inside the 90-day window the detector reads."""
    rows: list[FlexcubeTxnRow] = []
    for i in range(6):
        at = (now - timedelta(days=i + 1)).replace(
            hour=11, minute=5, second=0, microsecond=0
        )
        rows.append(
            _row(
                f"INJ-POS-{at:%Y%m%d}-{i}",
                at,
                "C",
                "POS",
                220_000_00 + i * 15_000_00,
                POS_MERCHANTS[i % len(POS_MERCHANTS)],
            )
        )
    return rows


def _row(
    ref_no: str,
    at: datetime,
    direction: str,
    code: str,
    amount_kobo: int,
    narration: str,
) -> FlexcubeTxnRow:
    return FlexcubeTxnRow(
        TRN_REF_NO=ref_no,
        AC_NO="",
        TRN_DT=at.isoformat(),
        VALUE_DT=at.date().isoformat(),
        DRCR_IND=direction,
        LCY_AMOUNT=amount_kobo,
        TRN_CODE=code,
        NARRATION=narration,
        RELATED_REF="",
    )


def _month_start(now: datetime, back: int) -> datetime:
    index = now.year * 12 + (now.month - 1) - back
    year, month = divmod(index, 12)
    return datetime(year, month + 1, 1, tzinfo=WAT)


def _on_day(month_start: datetime, day: int, hour: int, minute: int) -> datetime:
    last = monthrange(month_start.year, month_start.month)[1]
    return month_start.replace(day=min(day, last), hour=hour, minute=minute)
