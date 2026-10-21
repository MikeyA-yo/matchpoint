"""SimFlexcubeTransport: emits FLEXCUBE rows for the demo customers only.

The transport doesn't know about customer_refs. The connector resolves the
customer_ref to a source account number through the RefIndex and asks for the
history by account.
"""

from datetime import datetime

from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.simulator.population import DEMO_CUSTOMERS, account_numbers
from matchpoint.simulator.transactions import generate_rows


class SimFlexcubeTransport:
    def __init__(self, seed: int):
        self._seed = seed
        self._accounts = account_numbers(seed)
        self._by_account = {acct: c for c, acct in zip(DEMO_CUSTOMERS,
                                                       self._accounts.values(), strict=True)}

    def account_history(
        self, account_no: str, start: datetime, end: datetime
    ) -> list[FlexcubeTxnRow]:
        customer = self._by_account.get(account_no)
        if customer is None:
            raise CustomerNotFound("SimFlexcubeTransport", f"unknown account {account_no}")
        return generate_rows(customer, account_no, start.date(), end.date(), self._seed)

    def accounts(self) -> dict[str, str]:
        """source_id → account_no, for wiring."""
        return dict(self._accounts)
