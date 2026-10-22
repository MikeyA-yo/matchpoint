"""Step 8 helper: render a cluster template with the customer's evidence.

Templates live in pipeline/templates/cluster_<id>.j2 (plus fallback.j2 for the
HDBSCAN noise label -1). Each template emits three sections separated by
`---`: title, body, why. The renderer parses them back into a Message and runs
`guardrail.check_copy` on the full concatenated text; if any check fails, it
returns a `GuardedMessage(message=None, blocked=...)` so the pipeline's step 9
can turn it into GUARDRAIL_BLOCKED.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import TYPE_CHECKING, Any

from matchpoint.models import FeatureVector, Product, Txn
from matchpoint.pipeline import gain
from matchpoint.pipeline.guardrail import Check, check_copy
from matchpoint.pipeline.policy import DEFAULT_POLICY, Policy
from matchpoint.pipeline.schemas import Message

if TYPE_CHECKING:
    from jinja2 import Environment, Template


@dataclass(frozen=True)
class GuardedMessage:
    message: Message | None
    checks: list[Check]
    template_id: str

    @property
    def blocked(self) -> bool:
        return self.message is None


OPT_OUT = "You can stop offers at any time."
_SECTION_DELIM = "---"


def compose(
    template_id: str,
    evidence: dict[str, Any],
    gain_kobo: int,
    policy: Policy = DEFAULT_POLICY,
) -> GuardedMessage:
    """Render `template_id` with `evidence` and `gain_kobo`, run text guards,
    and return the guarded message. On render failure or guard failure, the
    returned `message` is None and `checks` carries the detail."""
    env = _env()
    template = _try_template(env, template_id)
    if template is None:
        template = _try_template(env, "fallback")
    if template is None:
        return GuardedMessage(
            None,
            [Check("TEMPLATE_MISSING", False, f"No template for {template_id}")],
            template_id,
        )

    gain_naira = gain_kobo // 100 if gain_kobo else 0
    ctx = {**evidence, "gain_naira": gain_naira, "gain_kobo": gain_kobo, "opt_out": OPT_OUT}
    rendered = template.render(**ctx)
    title, body, why = _split_sections(rendered)
    if OPT_OUT.lower() not in body.lower():
        body = f"{body} {OPT_OUT}".strip()

    text = f"{title} {body} {why}"
    checks = check_copy(text, policy)
    if not all(check.passed for check in checks):
        return GuardedMessage(None, checks, template_id)
    return GuardedMessage(Message(title=title, body=body, why=why), checks, template_id)


def explain(
    product: Product,
    features: FeatureVector,
    transactions: list[Txn],
    template_id: str,
    evidence: dict[str, Any] | None = None,
    policy: Policy = DEFAULT_POLICY,
) -> tuple[GuardedMessage, int]:
    """Convenience wrapper used by step 8: compute the gain, render, return
    both so the trace can carry the kobo value."""
    gain_kobo = gain.estimate_gain(product, features, transactions)
    env = dict(evidence or {})
    env.setdefault("product_name", product.name)
    env.setdefault("product_id", product.id)
    env.setdefault("rate_pct", _rate_pct(product))
    env.setdefault("tenor_months", product.gain.months if product.gain else 12)
    guarded = compose(template_id, env, gain_kobo, policy)
    return guarded, gain_kobo


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _rate_pct(product: Product) -> str:
    if product.gain and product.gain.example_rate is not None:
        return f"{product.gain.example_rate * 100:.0f}%"
    return ""


def _naira(value: int) -> str:
    return f"{int(value):,}"


@lru_cache(maxsize=1)
def _env() -> "Environment":
    from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

    templates_dir = Path(
        str(resources.files("matchpoint.pipeline").joinpath("templates"))
    )
    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(enabled_extensions=("j2",), default_for_string=False),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["naira"] = _naira
    env.filters["number"] = _naira
    return env


def _try_template(env: "Environment", template_id: str) -> "Template | None":
    name = template_id if template_id.endswith(".j2") else f"{template_id}.j2"
    try:
        return env.get_template(name)
    except Exception:
        return None


def _split_sections(rendered: str) -> tuple[str, str, str]:
    parts = [part.strip() for part in rendered.split(_SECTION_DELIM)]
    while len(parts) < 3:
        parts.append("")
    title = _first_line(parts[0])
    body = parts[1]
    why = parts[2]
    return title, body, why


def _first_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""
