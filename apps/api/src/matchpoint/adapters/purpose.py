"""Purpose limitation for adapter calls.

Every adapter call states why it reads data: "profiling", "marketing" or "service". The
PurposeFiltered wrapper returns only the fields FIELD_POLICY allows for that purpose and
logs the purpose, the fields returned and the trace ID. It wraps any implementation, real
or simulated, so a service cannot bypass it by swapping connectors.

Withheld fields are set to None, so every field that some purpose withholds must be
Optional in its model. check_policy() enforces that at import time.
"""

import functools
import json
import logging
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal, cast, get_args

from pydantic import BaseModel

from matchpoint.adapters.errors import ConnectorError
from matchpoint.adapters.refs import is_customer_ref
from matchpoint.clock import Clock
from matchpoint.models import (
    Consent,
    DeliveryReceipt,
    FulfilmentReceipt,
    Product,
    Profile,
    RefExists,
    Txn,
)
from matchpoint.trace import current_trace_id

Purpose = Literal["profiling", "marketing", "service"]
PURPOSES: tuple[Purpose, ...] = get_args(Purpose)


def _all(model: type[BaseModel]) -> frozenset[str]:
    return frozenset(model.model_fields)


_TXN_MARKETING = frozenset(
    {"id", "customer_ref", "at", "direction", "kind", "amount_band", "currency", "simulated"}
)
_PROFILE_MARKETING = frozenset(
    {
        "customer_ref",
        "age_band",
        "segment",
        "holdings",
        "complaint_open",
        "dnd_registered",
        "simulated",
    }
)

# model -> purpose -> fields returned. A model missing here cannot be returned at all.
FIELD_POLICY: dict[type[BaseModel], dict[Purpose, frozenset[str]]] = {
    Txn: {
        "service": _all(Txn),
        # The feature store needs amounts and narrations (salary, school-fee patterns).
        "profiling": _all(Txn),
        # Targeting may know that a salary arrived and its band, never the amount or text.
        "marketing": _TXN_MARKETING,
    },
    Profile: {
        "service": _all(Profile),
        "profiling": _all(Profile),
        "marketing": _PROFILE_MARKETING,
    },
    # The consent gate runs first for every purpose, so consent is always readable.
    Consent: {p: _all(Consent) for p in PURPOSES},
    RefExists: {p: _all(RefExists) for p in PURPOSES},
    Product: {p: _all(Product) for p in PURPOSES},
    DeliveryReceipt: {p: _all(DeliveryReceipt) for p in PURPOSES},
    FulfilmentReceipt: {p: _all(FulfilmentReceipt) for p in PURPOSES},
}


def check_policy() -> None:
    for model, by_purpose in FIELD_POLICY.items():
        fields = model.model_fields
        for purpose in PURPOSES:
            allowed = by_purpose[purpose]
            unknown = allowed - fields.keys()
            if unknown:
                raise ValueError(f"{model.__name__}/{purpose}: unknown fields {sorted(unknown)}")
            for name in fields.keys() - allowed:
                if fields[name].is_required() or fields[name].default is not None:
                    raise ValueError(
                        f"{model.__name__}.{name} is withheld for {purpose} "
                        "but is not Optional with default None"
                    )


check_policy()


def apply_policy(result: Any, purpose: Purpose) -> tuple[Any, tuple[str, ...], int]:
    """Filter a result. Returns (filtered, fields returned, number of records)."""
    if purpose not in PURPOSES:
        raise ValueError(f"Unknown purpose {purpose!r}")
    if result is None:
        return None, (), 0
    if isinstance(result, list):
        filtered = [_filter_one(r, purpose)[0] for r in result]
        fields = _allowed(type(result[0]), purpose) if result else ()
        return filtered, fields, len(filtered)
    one, fields = _filter_one(result, purpose)
    return one, fields, 1


def _allowed(model: type, purpose: Purpose) -> tuple[str, ...]:
    if model not in FIELD_POLICY:
        raise TypeError(f"No purpose policy for {model.__name__}; refusing to return it")
    return tuple(sorted(FIELD_POLICY[model][purpose]))


def _filter_one(record: Any, purpose: Purpose) -> tuple[BaseModel, tuple[str, ...]]:
    model = type(record)
    allowed = _allowed(model, purpose)
    withheld = {name: None for name in model.model_fields if name not in allowed}
    return (record.model_copy(update=withheld) if withheld else record), allowed


@dataclass(frozen=True)
class AccessRecord:
    trace_id: str
    connector: str
    method: str
    purpose: Purpose
    customer_ref: str | None
    fields_returned: tuple[str, ...]
    records: int
    as_of: datetime
    outcome: str = "ok"

    def to_json(self) -> str:
        data = asdict(self)
        data["as_of"] = self.as_of.isoformat()
        return json.dumps(data, sort_keys=True)


class AccessLog:
    """Writes one JSON line per adapter call to the `matchpoint.access` logger and keeps
    the most recent records in memory for tests and the audit view."""

    def __init__(self, logger: logging.Logger | None = None, keep: int = 10_000):
        self._logger = logger or logging.getLogger("matchpoint.access")
        self._recent: deque[AccessRecord] = deque(maxlen=keep)

    def record(self, rec: AccessRecord) -> None:
        self._recent.append(rec)
        self._logger.info(rec.to_json())

    def recent(self) -> list[AccessRecord]:
        return list(self._recent)

    def clear(self) -> None:
        self._recent.clear()


class PurposeFiltered:
    def __init__(self, inner: object, connector: str, log: AccessLog, clock: Clock):
        self._inner = inner
        self._connector = connector
        self._log = log
        self._clock = clock

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)
        if name.startswith("_") or not callable(attr):
            return attr

        @functools.wraps(attr)
        def call(*args: Any, purpose: Purpose, **kwargs: Any) -> Any:
            if purpose not in PURPOSES:
                raise ValueError(f"Unknown purpose {purpose!r}")
            ref = _customer_ref(args, kwargs)
            try:
                result = attr(*args, purpose=purpose, **kwargs)
            except ConnectorError as exc:
                self._write(name, purpose, ref, (), 0, f"error:{exc.code}")
                raise
            filtered, fields, count = apply_policy(result, purpose)
            self._write(name, purpose, ref or _customer_ref((result,), {}), fields, count)
            return filtered

        return call

    def _write(
        self,
        method: str,
        purpose: Purpose,
        ref: str | None,
        fields: tuple[str, ...],
        count: int,
        outcome: str = "ok",
    ) -> None:
        self._log.record(
            AccessRecord(
                trace_id=current_trace_id(),
                connector=self._connector,
                method=method,
                purpose=purpose,
                customer_ref=ref,
                fields_returned=fields,
                records=count,
                as_of=self._clock.now(),
                outcome=outcome,
            )
        )


def purpose_filtered[T](inner: T, connector: str, log: AccessLog, clock: Clock) -> T:
    """Wrap `inner` and keep its static type, so wiring code stays typed."""
    return cast(T, PurposeFiltered(inner, connector, log, clock))


def _customer_ref(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str | None:
    for value in (*args, *kwargs.values()):
        if is_customer_ref(value):
            return value
        ref = getattr(value, "customer_ref", None)
        if is_customer_ref(ref):
            return ref
    return None
