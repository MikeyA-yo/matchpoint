"""ProductCatalogue: hand-written for the demo.

Generic product names, per docs/api_design.md section 4, until Abdulhaqeem has
checked them against Zenith's real catalogue.
"""

from datetime import datetime
from typing import Protocol

from matchpoint.adapters.purpose import Purpose
from matchpoint.models import Product


class CatalogueTransport(Protocol):
    def active(self, as_of: datetime) -> list[Product]: ...


class ProductCatalogueImpl:
    def __init__(self, transport: CatalogueTransport):
        self._transport = transport

    def active(self, as_of: datetime, *, purpose: Purpose) -> list[Product]:
        return self._transport.active(as_of)
