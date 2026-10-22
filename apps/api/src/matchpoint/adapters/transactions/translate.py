"""FLEXCUBE row -> MATCHPOINT Txn, and narration classification.

classify_narration(narration) returns one of the labels defined in
config/narration_anchors.json. If sentence-transformers (MiniLM) is importable
and can load the model, labels are picked by cosine similarity between the
narration's embedding and the pre-computed anchor-phrase embeddings; otherwise
the function falls back to case-insensitive substring matching against each
label's anchor phrases.

Both paths are cached: the model and the anchor embeddings load once per
process on first call.
"""

from __future__ import annotations

from datetime import date, datetime
from functools import lru_cache
from typing import Any

from matchpoint.adapters.errors import ConnectorDataError
from matchpoint.adapters.transactions.vendor import FlexcubeTxnRow
from matchpoint.config import narration_anchors
from matchpoint.models import Txn, TxnDirection, TxnKind, amount_band

# TRN_CODE -> domain kind. Unknown codes become "other".
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

# Labels dropped by the feature builder before computing counts.
DROP_LABELS: frozenset[str] = frozenset({"reversal", "internal_transfer", "fee", "stamp_duty"})


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


# ---------------------------------------------------------------------------
# Narration classifier
# ---------------------------------------------------------------------------

_UNKNOWN = "other"


def classify_narration(narration: str, trn_code: str | None = None) -> str:
    """Return the best-matching anchor label, or "other" below threshold.

    `trn_code` short-circuits the embedding path when a known FLEXCUBE code
    deterministically names the label (fast path).
    """
    if not narration:
        return _UNKNOWN
    anchors = narration_anchors()
    if trn_code:
        label = _label_from_trn_code(anchors, trn_code)
        if label is not None:
            return label

    text = narration.lower()
    embedder = _load_embedder()
    if embedder is not None:
        label, score = _cosine_label(embedder, text, anchors)
        if score >= float(anchors.get("threshold", 0.35)):
            return label

    # Fallback: substring match against each label's anchor phrases.
    for label, spec in anchors["anchors"].items():
        for phrase in spec.get("phrases", []):
            if phrase.lower() in text:
                return label
    return _UNKNOWN


def _label_from_trn_code(anchors: dict[str, Any], trn_code: str) -> str | None:
    code = trn_code.upper()
    for label, spec in anchors["anchors"].items():
        if code in [c.upper() for c in spec.get("trn_codes", [])]:
            return label
    return None


@lru_cache(maxsize=1)
def _load_embedder() -> Any | None:
    """Load MiniLM once per process. None if sentence-transformers is not
    available or the model cannot be fetched (keeps the API runnable offline)."""
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
    except ImportError:
        return None
    try:
        return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    except Exception:
        return None


@lru_cache(maxsize=1)
def _anchor_embeddings() -> dict[str, Any]:
    """Encode each label's anchor phrases once per process. Each entry maps
    label -> average unit-normalised phrase embedding."""
    import numpy as np

    embedder = _load_embedder()
    if embedder is None:
        return {}
    out: dict[str, Any] = {}
    for label, spec in narration_anchors()["anchors"].items():
        phrases = spec.get("phrases", [])
        if not phrases:
            continue
        vecs = embedder.encode(phrases, normalize_embeddings=True)
        avg = np.mean(np.asarray(vecs), axis=0)
        norm = np.linalg.norm(avg)
        out[label] = (avg / norm) if norm else avg
    return out


def _cosine_label(embedder: Any, text: str, anchors: dict[str, Any]) -> tuple[str, float]:
    import numpy as np

    anchor_vecs = _anchor_embeddings()
    if not anchor_vecs:
        return _UNKNOWN, 0.0
    query = embedder.encode([text], normalize_embeddings=True)[0]
    query = np.asarray(query)
    best_label = _UNKNOWN
    best_score = -1.0
    for label, vec in anchor_vecs.items():
        score = float(np.dot(query, vec))
        if score > best_score:
            best_score = score
            best_label = label
    return best_label, best_score
