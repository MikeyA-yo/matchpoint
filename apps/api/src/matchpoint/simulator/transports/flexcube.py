"""SimFlexcubeTransport: emits FLEXCUBE rows for the demo customers only.

Resolves customer_ref → account_no via the shared RefHasher, then runs the
transaction generator.
"""

from datetime import datetime

from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.adapters.refs import RefHasher
from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.simulator.population import DEMO_CUSTOMERS, account_numbers
from matchpoint.simulator.transactions import generate_rows


class SimFlexcubeTransport:
    def __init__(self, seed: int, hasher: RefHasher):
        self._seed = seed
        accounts = account_numbers(seed)
        self._by_ref = {
            hasher.ref(c.source_id): (c, accounts[c.source_id]) for c in DEMO_CUSTOMERS
        }

    def history_for(
        self, customer_ref: str, start: datetime, end: datetime
    ) -> list[FlexcubeTxnRow]:
        pair = self._by_ref.get(customer_ref)
        if pair is None:
            raise CustomerNotFound("SimFlexcubeTransport", f"unknown {customer_ref}")
        customer, account_no = pair
        return generate_rows(customer, account_no, start.date(), end.date(), self._seed)
