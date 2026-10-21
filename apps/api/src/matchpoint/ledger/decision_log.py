"""Append-only decision log, kept in memory for the demo.

It is the only source of contact history: the 30-day cap, the 60-day product gap and the
"recently ignored" cooldown all read it. Entries are never edited or deleted. A repeated
decision ID returns the record already written, so retries cannot double-count a contact.

A pilot swaps this for the append-only store behind the same methods.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from matchpoint.pipeline.schemas import Decision


class DecisionLog:
    def __init__(self) -> None:
        self._by_id: dict[str, Decision] = {}
        self._order: list[str] = []

    def append(self, decision: Decision) -> Decision:
        existing = self._by_id.get(decision.id)
        if existing is not None:
            return existing
        self._by_id[decision.id] = decision
        self._order.append(decision.id)
        return decision

    def get(self, decision_id: str) -> Decision | None:
        return self._by_id.get(decision_id)

    def entries(self) -> list[Decision]:
        """Newest first."""
        return [self._by_id[decision_id] for decision_id in reversed(self._order)]

    def for_customer(self, customer_ref: str) -> list[Decision]:
        return [d for d in self.entries() if d.customer_ref == customer_ref]

    def contacts_since(self, customer_ref: str, as_of: datetime, days: int = 30) -> int:
        """Messages that actually reached the customer: sends in live mode."""
        cutoff = as_of - timedelta(days=days)
        return sum(
            1
            for d in self.for_customer(customer_ref)
            if d.outcome == "send" and d.mode == "live" and d.as_of > cutoff
        )

    def last_sent_at(self, customer_ref: str, product_id: str) -> datetime | None:
        for decision in self.for_customer(customer_ref):
            if decision.outcome == "send" and decision.product_id == product_id:
                return decision.as_of
        return None

    def clear(self) -> None:
        self._by_id.clear()
        self._order.clear()
