"""Approved message templates, filled from evidence only.

Every marketing message carries an opt-out, names no sensitive category and makes no
absolute promise. The gain sentence is illustrative and says so.
"""

from __future__ import annotations

from matchpoint.models import Product
from matchpoint.pipeline.detector import Signal
from matchpoint.pipeline.schemas import Message

OPT_OUT = "You can stop offers at any time."


def compose(product: Product, signals: list[Signal], gain_kobo: int | None) -> Message:
    builders = {
        "prd_target_savings": _target_savings,
        "prd_savings_round_up": _round_up,
        "prd_business_collections": _business_collections,
        "prd_bills_autopay": _bills_autopay,
    }
    builder = builders.get(product.id, _generic)
    title, body, why = builder(product, signals)
    gain = _gain_sentence(product, gain_kobo)
    if gain:
        body = f"{body} {gain}"
    return Message(title=title, body=f"{body} {OPT_OUT}", why=why)


def naira(kobo: int) -> str:
    return f"₦{kobo // 100:,}"


def _target_savings(product: Product, signals: list[Signal]) -> tuple[str, str, str]:
    if _has(signals, "fee_season"):
        title = "School fees are coming up"
        body = (
            "You have paid school fees each January and September, and your salary "
            "arrives on the 25th. A target savings account can help you set money "
            "aside each month."
        )
        why = "Based on your salary and school fee payments. You allowed personalised offers."
    else:
        title = "Put your salary to work"
        body = (
            "Your salary arrives on the 25th each month. A target savings account can "
            "help you set money aside for what matters."
        )
        why = "Based on your salary pattern. You allowed personalised offers."
    return title, body, why


def _round_up(product: Product, signals: list[Signal]) -> tuple[str, str, str]:
    title = "Spare change adds up"
    body = (
        "You make a lot of small payments each month. Round-up savings puts the spare "
        "change aside, and you can withdraw any time."
    )
    why = "Based on your everyday spending. You allowed personalised offers."
    return title, body, why


def _business_collections(product: Product, signals: list[Signal]) -> tuple[str, str, str]:
    title = "Keep your business takings moving"
    body = (
        "Your business receives regular POS and transfer payments. A business "
        "collections account settles them faster and works on USSD."
    )
    why = "Based on your business inflows. You allowed personalised offers."
    return title, body, why


def _bills_autopay(product: Product, signals: list[Signal]) -> tuple[str, str, str]:
    title = "Put your bills on autopilot"
    body = (
        "You pay bills every month. Bills autopay can schedule them for you and remind "
        "you before each one."
    )
    why = "Based on your recurring bill payments. You allowed personalised offers."
    return title, body, why


def _generic(product: Product, signals: list[Signal]) -> tuple[str, str, str]:
    facts = ", ".join(product.key_facts[:2]).lower()
    body = f"{product.name} may suit you."
    if facts:
        body = f"{body} It offers {facts}."
    why = "Based on your activity. You allowed personalised offers."
    return product.name, body, why


def _has(signals: list[Signal], kind: str) -> bool:
    return any(signal.type == kind for signal in signals)


def _gain_sentence(product: Product, gain_kobo: int | None) -> str:
    if not gain_kobo or gain_kobo <= 0 or product.gain is None:
        return ""
    amount = naira(gain_kobo)
    if product.gain.kind == "interest" and product.gain.example_rate is not None:
        rate = f"{product.gain.example_rate * 100:.0f}%"
        return f"At an illustrative {rate} a year, that could earn about {amount} in interest."
    return f"That could save about {amount} in fees over a year."
