"""Field-by-field mapping from a vendor payload to the MATCHPOINT domain model.

A vendor field counts as verified only when `source` points to vendor documentation that
names it. Everything else is UNVERIFIED and goes on the list of questions for the Zenith
mentor. scripts/export_contracts.py renders these tables into docs/connectors/.
"""

from dataclasses import dataclass
from typing import Any

from pydantic import Field

UNVERIFIED = "UNVERIFIED"


@dataclass(frozen=True)
class FieldMap:
    vendor_field: str
    domain_field: str | None  # None: read but deliberately dropped (e.g. a BVN column)
    transform: str
    verified: bool
    source: str | None = None
    question: str = ""  # what to ask the mentor when unverified

    def __post_init__(self) -> None:
        if self.verified and not self.source:
            raise ValueError(f"{self.vendor_field}: a verified field needs a source")
        if not self.verified and not self.question:
            raise ValueError(f"{self.vendor_field}: an unverified field needs a question")

    @property
    def status(self) -> str:
        return "verified" if self.verified else UNVERIFIED


@dataclass(frozen=True)
class ConnectorMapping:
    connector: str
    vendor_system: str
    fields: tuple[FieldMap, ...]

    def unverified(self) -> list[FieldMap]:
        return [f for f in self.fields if not f.verified]

    def to_markdown(self) -> str:
        lines = [
            f"| {self.vendor_system} field | MATCHPOINT field | Transform | Status | Source |",
            "|---|---|---|---|---|",
        ]
        for f in self.fields:
            target = f"`{f.domain_field}`" if f.domain_field else "dropped"
            source = f"[doc]({f.source})" if f.source else ""
            lines.append(
                f"| `{f.vendor_field}` | {target} | {f.transform} | {f.status} | {source} |"
            )
        return "\n".join(lines)


def vendor_field(*, verified: bool, source: str | None = None, default: Any = ...) -> Any:
    """A Pydantic Field on a vendor model that carries its verification status into the
    exported JSON Schema as `x-verified` / `x-source`."""
    extra: dict[str, Any] = {"x-verified": verified}
    if source:
        extra["x-source"] = source
    return Field(default=default, json_schema_extra=extra)
