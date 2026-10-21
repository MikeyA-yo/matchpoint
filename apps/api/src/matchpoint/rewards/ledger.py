"""Append-only rewards ledger, keyed by customer_ref.

Entries are never edited or deleted. A repeated idempotency key returns the record
already written, so retries cannot double-award or double-spend.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

EntryType = Literal["earn", "spend", "reversal"]


class LedgerEntry:
    def __init__(
        self,
        id: str,
        customer_ref: str,
        type: EntryType,
        points: int,
        event: str | None = None,
        reward_id: str | None = None,
        idempotency_key: str | None = None,
        as_of: datetime | None = None,
        balance_after: int | None = None,
    ):
        self.id = id
        self.customer_ref = customer_ref
        self.type = type
        self.points = points
        self.event = event
        self.reward_id = reward_id
        self.idempotency_key = idempotency_key
        self.as_of = as_of
        self.balance_after = balance_after


class RewardsLedger:
    def __init__(self) -> None:
        self._by_id: dict[str, LedgerEntry] = {}
        self._by_key: dict[str, LedgerEntry] = {}
        self._order: list[str] = []

    def append(self, entry: LedgerEntry) -> LedgerEntry:
        if entry.idempotency_key is not None:
            existing = self._by_key.get(entry.idempotency_key)
            if existing is not None:
                return existing
        self._by_id[entry.id] = entry
        if entry.idempotency_key is not None:
            self._by_key[entry.idempotency_key] = entry
        self._order.append(entry.id)
        return entry

    def get(self, entry_id: str) -> LedgerEntry | None:
        return self._by_id.get(entry_id)

    def by_key(self, idempotency_key: str) -> LedgerEntry | None:
        return self._by_key.get(idempotency_key)

    def entries(self) -> list[LedgerEntry]:
        return [self._by_id[eid] for eid in reversed(self._order)]

    def for_customer(self, customer_ref: str) -> list[LedgerEntry]:
        return [e for e in self.entries() if e.customer_ref == customer_ref]

    def balance(self, customer_ref: str) -> int:
        total = 0
        for e in self.for_customer(customer_ref):
            if e.type == "earn":
                total += e.points
            elif e.type in ("spend", "reversal"):
                total -= e.points
        return total

    def earned_since(
        self, customer_ref: str, as_of: datetime, days: int
    ) -> int:
        cutoff = as_of - timedelta(days=days)
        total = 0
        for e in self.for_customer(customer_ref):
            if e.type == "earn" and e.as_of is not None and e.as_of > cutoff:
                total += e.points
        return total

    def earn_count_since(
        self, customer_ref: str, event: str, as_of: datetime, days: int
    ) -> int:
        cutoff = as_of - timedelta(days=days)
        return sum(
            1
            for e in self.for_customer(customer_ref)
            if e.type == "earn"
            and e.event == event
            and e.as_of is not None
            and e.as_of > cutoff
        )

    def last_earn_at(
        self, customer_ref: str, event: str
    ) -> datetime | None:
        for e in self.for_customer(customer_ref):
            if e.type == "earn" and e.event == event:
                return e.as_of
        return None

    def clear(self) -> None:
        self._by_id.clear()
        self._by_key.clear()
        self._order.clear()
