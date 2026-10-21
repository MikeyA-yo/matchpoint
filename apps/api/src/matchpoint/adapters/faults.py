# FAULT_EXPECTATIONS (hackathon demo):
#   - ConsentStore error → get() returns no consent, evaluate returns silent.
#     Nothing else is read. This is the one fault the demo shows.
# Other faults (duplicate, out-of-order, delay) are modelled by the FaultInjector
# below. Nothing in the demo wires it in yet.

"""Seeded fault injection for any connector or transport.

Wrap a connector to test how services handle faults. Wrap a transport (which returns raw
vendor dicts) to test how translation handles them, including a missing required field.

Faults:
  delay         adds latency; above plan.timeout_ms the call raises ConnectorTimeout
  error         raises ConnectorUnavailable
  duplicate     repeats list items
  out_of_order  shuffles a list result
  missing_field blanks one field per affected record (dict: key removed; model: set to None,
                only for fields that accept None)

Each call draws from its own stream, derived from (seed, connector, method, arguments,
how many times those arguments were seen before). So the same seed gives the same faults,
however calls to other customers are interleaved.
"""

import functools
import hashlib
import json
import random
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal, TypeVar, cast

from pydantic import BaseModel

from matchpoint.adapters.errors import ConnectorTimeout, ConnectorUnavailable

FaultKind = Literal["delay", "error", "duplicate", "out_of_order", "missing_field"]


@dataclass(frozen=True)
class FaultPlan:
    seed: int
    error_rate: float = 0.0  # per call
    delay_rate: float = 0.0  # per call
    delay_ms: tuple[int, int] = (50, 3_000)
    timeout_ms: int = 2_000
    duplicate_rate: float = 0.0  # per list item
    out_of_order_rate: float = 0.0  # per call with a list result
    missing_field_rate: float = 0.0  # per record
    missing_fields: tuple[str, ...] = ()  # eligible fields; empty means any

    def __post_init__(self) -> None:
        for name in (
            "error_rate",
            "delay_rate",
            "duplicate_rate",
            "out_of_order_rate",
            "missing_field_rate",
        ):
            rate = getattr(self, name)
            if not 0.0 <= rate <= 1.0:
                raise ValueError(f"{name} must be in [0, 1], got {rate}")
        lo, hi = self.delay_ms
        if not 0 <= lo <= hi:
            raise ValueError(f"delay_ms must be (lo, hi) with 0 <= lo <= hi, got {self.delay_ms}")


@dataclass(frozen=True)
class InjectedFault:
    connector: str
    method: str
    kind: FaultKind
    detail: str


@dataclass
class _State:
    seen: Counter[str] = field(default_factory=Counter)
    injected: list[InjectedFault] = field(default_factory=list)


def _no_sleep(_: timedelta) -> None:
    return None


T = TypeVar("T")


class FaultInjector:
    def __init__(
        self,
        inner: object,
        plan: FaultPlan,
        connector: str,
        sleep: Callable[[timedelta], None] = _no_sleep,
    ):
        self._inner = inner
        self._plan = plan
        self._connector = connector
        self._sleep = sleep
        self._state = _State()

    @property
    def injected(self) -> list[InjectedFault]:
        return list(self._state.injected)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)
        if name.startswith("_") or not callable(attr):
            return attr

        @functools.wraps(attr)
        def call(*args: Any, **kwargs: Any) -> Any:
            rng = self._stream(name, args, kwargs)
            self._before(name, rng)
            result = attr(*args, **kwargs)
            return self._after(name, rng, result)

        return call

    def _stream(self, method: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> random.Random:
        digest = _digest(args, kwargs)
        key = f"{method}:{digest}"
        ordinal = self._state.seen[key]
        self._state.seen[key] += 1
        material = f"{self._plan.seed}\x1f{self._connector}\x1f{key}\x1f{ordinal}".encode()
        return random.Random(int.from_bytes(hashlib.sha256(material).digest()[:16], "big"))

    def _note(self, method: str, kind: FaultKind, detail: str) -> None:
        self._state.injected.append(InjectedFault(self._connector, method, kind, detail))

    def _before(self, method: str, rng: random.Random) -> None:
        plan = self._plan
        # Draw every value up front so the stream layout never depends on which fault fired.
        error_roll, delay_roll = rng.random(), rng.random()
        delay_ms = rng.randint(*plan.delay_ms)
        if error_roll < plan.error_rate:
            self._note(method, "error", "unavailable")
            raise ConnectorUnavailable(self._connector, f"injected fault in {method}")
        if delay_roll < plan.delay_rate:
            if delay_ms > plan.timeout_ms:
                self._note(method, "delay", f"{delay_ms}ms > timeout {plan.timeout_ms}ms")
                self._sleep(timedelta(milliseconds=plan.timeout_ms))
                raise ConnectorTimeout(self._connector, f"{method} exceeded {plan.timeout_ms}ms")
            self._note(method, "delay", f"{delay_ms}ms")
            self._sleep(timedelta(milliseconds=delay_ms))

    def _after(self, method: str, rng: random.Random, result: Any) -> Any:
        if isinstance(result, list):
            return self._list_faults(method, rng, result)
        if isinstance(result, dict | BaseModel):
            return self._maybe_blank(method, rng, result)
        return result

    def _list_faults(self, method: str, rng: random.Random, items: list[Any]) -> list[Any]:
        plan = self._plan
        out: list[Any] = []
        for item in items:
            item = self._maybe_blank(method, rng, item)
            out.append(item)
            if rng.random() < plan.duplicate_rate:
                self._note(method, "duplicate", _label(item))
                out.append(item)
        if rng.random() < plan.out_of_order_rate and len(out) > 1:
            self._note(method, "out_of_order", f"{len(out)} records shuffled")
            rng.shuffle(out)
        return out

    def _maybe_blank(self, method: str, rng: random.Random, record: Any) -> Any:
        roll = rng.random()
        if roll >= self._plan.missing_field_rate:
            return record
        candidates = _blankable(record, self._plan.missing_fields)
        if not candidates:
            return record
        name = rng.choice(candidates)
        self._note(method, "missing_field", f"{_label(record)}.{name}")
        if isinstance(record, dict):
            return {k: v for k, v in record.items() if k != name}
        return record.model_copy(update={name: None})


def with_faults(
    inner: T,
    plan: FaultPlan,
    connector: str,
    sleep: Callable[[timedelta], None] = _no_sleep,
) -> T:
    """Wrap `inner` and keep its static type."""
    return cast(T, FaultInjector(inner, plan, connector, sleep))


def injected_faults(wrapped: object) -> list[InjectedFault]:
    if not isinstance(wrapped, FaultInjector):
        raise TypeError("not a FaultInjector")
    return wrapped.injected


def _blankable(record: Any, wanted: tuple[str, ...]) -> list[str]:
    if isinstance(record, dict):
        present = [k for k in record if record[k] is not None]
    elif isinstance(record, BaseModel):
        present = [
            name
            for name, info in type(record).model_fields.items()
            if not info.is_required()
            and info.default is None
            and getattr(record, name) is not None
        ]
    else:
        return []
    if wanted:
        present = [k for k in present if k in wanted]
    return sorted(present)


def _label(record: Any) -> str:
    if isinstance(record, dict):
        for key in ("id", "TRN_REF_NO"):
            if key in record:
                return str(record[key])
        return "record"
    return str(getattr(record, "id", type(record).__name__))


def _digest(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    payload = json.dumps(
        {"args": [_plain(a) for a in args], "kwargs": {k: _plain(v) for k, v in kwargs.items()}},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _plain(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_plain(v) for v in value]
    if isinstance(value, str | int | float | bool) or value is None:
        return value
    return repr(value)
