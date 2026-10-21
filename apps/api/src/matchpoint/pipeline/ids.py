"""Stable IDs derived from the request, so retries return the same records."""

from __future__ import annotations

import hashlib
from datetime import datetime


def _derive(prefix: str, material: str) -> str:
    return f"{prefix}_{hashlib.sha256(material.encode()).hexdigest()[:6]}"


def decision_id(
    customer_ref: str, product_id: str | None, as_of: datetime, mode: str
) -> str:
    material = f"{customer_ref}|{product_id or 'none'}|{as_of.isoformat()}|{mode}"
    return _derive("dec", material)


def message_id(
    customer_ref: str, product_id: str | None, as_of: datetime, mode: str
) -> str:
    material = f"msg|{customer_ref}|{product_id or 'none'}|{as_of.isoformat()}|{mode}"
    return _derive("msg", material)
