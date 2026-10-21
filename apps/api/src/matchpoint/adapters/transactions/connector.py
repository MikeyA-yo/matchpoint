"""FlexcubeTransactionFeed: TransactionFeed over any FLEXCUBE-shaped transport.

The connector only knows customer_refs. The transport knows how to turn one into
an account number (sim does it from the demo list; a pilot would look it up by
BVN or NUBAN in FLEXCUBE).
"""

from datetime import datetime
from typing import Protocol

from matchpoint.adapters.purpose import Purpose
from matchpoint.adapters.transactions.translate import vendor_to_txn
from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.models import Txn


class FlexcubeTransport(Protocol):
    def history_for(
        self, customer_ref: str, start: datetime, end: datetime
    ) -> list[FlexcubeTxnRow]: ...


class FlexcubeTransactionFeed:
    def __init__(self, transport: FlexcubeTransport):
        self._transport = transport

    def window(
        self, customer_ref: str, start: datetime, end: datetime, *, purpose: Purpose
    ) -> list[Txn]:
        rows = self._transport.history_for(customer_ref, start, end)
        return [vendor_to_txn(row, customer_ref) for row in rows]
