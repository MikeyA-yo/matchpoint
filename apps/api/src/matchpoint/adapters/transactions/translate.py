"""FLEXCUBE row → MATCHPOINT Txn."""

from datetime import date, datetime

from matchpoint.adapters.errors import ConnectorDataError
from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.models import Txn, TxnDirection, TxnKind, amount_band

# TRN_CODE → domain kind. Unknown codes become "other".
TRN_CODE_TO_KIND: dict[str, TxnKind] = {
    "SAL": "salary",
    "NIPI": "nip_in",
    "NIPO": "nip_out",
    "POS": "pos",
    "ATM": "atm",
    "BIL": "bill",
    "VTU": "airtime",
    "CHG": "charge",
    "STD": "stamp_duty",
    "REV": "reversal",
}

DRCR_TO_DIRECTION: dict[str, TxnDirection] = {"D": "debit", "C": "credit"}


def vendor_to_txn(row: FlexcubeTxnRow, customer_ref: str) -> Txn:
    try:
        amount_kobo = int(row["LCY_AMOUNT"])
        direction = DRCR_TO_DIRECTION[row["DRCR_IND"]]
        kind = TRN_CODE_TO_KIND.get(row.get("TRN_CODE", ""), "other")
        return Txn(
            id=row["TRN_REF_NO"],
            customer_ref=customer_ref,
            at=_dt(row["TRN_DT"]),
            direction=direction,
            kind=kind,
            amount_kobo=amount_kobo,
            amount_band=amount_band(amount_kobo),
            value_date=_d(row.get("VALUE_DT")),
            narration=row.get("NARRATION"),
            reversal_of=row.get("RELATED_REF"),
            simulated=True,
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise ConnectorDataError("FlexcubeTransactionFeed", f"bad row: {exc}") from exc


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _d(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None
