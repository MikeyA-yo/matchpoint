"""FlexcubeTransactionFeed: TransactionFeed over any FLEXCUBE-shaped transport."""

from datetime import datetime
from typing import Protocol

from matchpoint.adapters.purpose import Purpose
from matchpoint.adapters.refs import RefIndex
from matchpoint.adapters.transactions.translate import vendor_to_txn
from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.models import Txn


class FlexcubeTransport(Protocol):
    def account_history(
        self, account_no: str, start: datetime, end: datetime
    ) -> list[FlexcubeTxnRow]: ...


class FlexcubeTransactionFeed:
    def __init__(self, transport: FlexcubeTransport, ref_index: RefIndex):
        self._transport = transport
        self._ref_index = ref_index

    def window(
        self, customer_ref: str, start: datetime, end: datetime, *, purpose: Purpose
    ) -> list[Txn]:
        account_no = self._ref_index.resolve(customer_ref)
        rows = self._transport.account_history(account_no, start, end)
        return [vendor_to_txn(row, customer_ref) for row in rows]
