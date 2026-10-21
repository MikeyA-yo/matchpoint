"""Step 8 helper: turn a chosen product and its evidence into a checked message."""

from __future__ import annotations

from matchpoint.models import Product, Txn
from matchpoint.pipeline import copy, gain
from matchpoint.pipeline.detector import Signal
from matchpoint.pipeline.schemas import Message


def explain(
    product: Product, signals: list[Signal], transactions: list[Txn]
) -> tuple[Message, int | None]:
    gain_kobo = gain.estimate_gain(product, signals, transactions)
    return copy.compose(product, signals, gain_kobo), gain_kobo
