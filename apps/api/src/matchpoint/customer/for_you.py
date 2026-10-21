"""GET /customers/{ref}/for-you.

Runs the decision pipeline in "shown" mode: it runs for all catalogue products,
skips contact rules (caps, cooldowns, quiet hours, DND), leaves out credit
products, adds one static item ("Talk to us about loans"), and returns at most 3.
Logs a decision with outcome "shown" (does not count toward the 30-day cap).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter
from pydantic import BaseModel

from matchpoint.customer.message_log import message_store
from matchpoint.pipeline.context import Context
from matchpoint.pipeline.detector import detect_signals
from matchpoint.pipeline.ids import decision_id
from matchpoint.pipeline.matcher import build_candidates
from matchpoint.pipeline.pipeline import evaluate
from matchpoint.pipeline.policy import DEFAULT_POLICY
from matchpoint.pipeline.schemas import Decision, EvalMode, Outcome, Trace
from matchpoint.pipeline.trace import TraceBuilder, MODEL_VERSION
from matchpoint.wiring import get_runtime

router = APIRouter(tags=["customer"])


class ForYouItem(BaseModel):
    rank: int
    product_id: str
    name: str
    why: str
    gain: dict | None = None
    key_facts: list[str] = []
    compare: list[dict] = []


class ForYouResponse(BaseModel):
    personalised: bool
    items: list[ForYouItem]
    note: str | None = None
    simulated: bool = True


LOANS_ITEM = ForYouItem(
    rank=0,
    product_id="prd_talk_loans",
    name="Talk to us about loans",
    why="A credit product needs a person to review it with you.",
    gain=None,
    key_facts=["No obligation.", "Speak to a banker about your needs."],
    compare=[],
)


@router.get("/customers/{ref}/for-you", response_model=ForYouResponse)
def for_you(ref: str):
    runtime = get_runtime()
    as_of = runtime.clock.now()

    consent = runtime.adapters.consent.get(ref, purpose="marketing")

    if not consent.personalised_offers:
        products = runtime.adapters.catalogue.active(as_of, purpose="marketing")
        items = [
            ForYouItem(
                rank=i + 1,
                product_id=p.id,
                name=p.name,
                why="General catalogue product.",
                gain=None,
                key_facts=p.key_facts,
                compare=[],
            )
            for i, p in enumerate([p for p in products if not p.is_credit][:3])
        ]
        _log_shown(runtime, ref, as_of, None)
        return ForYouResponse(
            personalised=False,
            items=items,
            note=None if items else "No products fit you now.",
            simulated=True,
        )

    profile = runtime.adapters.profile.get(ref, purpose="marketing")
    transactions = runtime.adapters.transactions.window(
        ref, runtime.clock.now() - timedelta(days=365), as_of, purpose="profiling"
    )
    products = runtime.adapters.catalogue.active(as_of, purpose="marketing")

    signals = detect_signals(
        transactions, as_of, runtime.policy.blocked_trigger_categories
    )
    candidates = build_candidates(products, profile, signals)

    viable = [
        c
        for c in candidates
        if c.eligible and c.score > 0 and c.dropped is None and not c.product.is_credit
    ]
    viable.sort(key=lambda c: -c.score)
    top = viable[:3]

    items: list[ForYouItem] = []
    for i, c in enumerate(top):
        product = c.product
        gain = _build_gain(product, signals, transactions)
        items.append(
            ForYouItem(
                rank=i + 1,
                product_id=product.id,
                name=product.name,
                why=_build_why(product, signals),
                gain=gain,
                key_facts=list(product.key_facts),
                compare=[
                    {
                        "product_id": cp.id,
                        "when_it_fits": "When you have a large amount.",
                    }
                    for cp in products
                    if cp.compare_group == product.compare_group and cp.id != product.id
                ][:1],
            )
        )

    if len(items) < 3:
        loans = ForYouItem(
            rank=len(items) + 1,
            product_id=LOANS_ITEM.product_id,
            name=LOANS_ITEM.name,
            why=LOANS_ITEM.why,
            gain=None,
            key_facts=LOANS_ITEM.key_facts,
            compare=LOANS_ITEM.compare,
        )
        items.append(loans)

    note = None
    matched_count = len(top)
    if matched_count == 0:
        note = "No products fit you now."
    elif matched_count < 3:
        note = f"Only {matched_count} products fit you now."

    _log_shown(runtime, ref, as_of, top[0].product.id if top else None)

    return ForYouResponse(
        personalised=True,
        items=items,
        note=note,
        simulated=True,
    )


def _build_gain(product, signals, transactions) -> dict | None:
    from matchpoint.pipeline.gain import estimate_gain

    gain_kobo = estimate_gain(product, signals, transactions)
    if gain_kobo is None or gain_kobo <= 0 or product.gain is None:
        return None
    amount_ngn = gain_kobo // 100
    return {
        "amount_ngn": amount_ngn,
        "period_months": product.gain.months,
        "basis": f"An illustrative {product.gain.example_rate * 100:.0f}% a year.",
        "example_rate": True,
    }


def _build_why(product, signals) -> str:
    signal_types = ", ".join(s.type for s in signals[:3]) if signals else "your activity"
    return f"Based on {signal_types}. You allowed personalised offers."


def _log_shown(runtime, customer_ref: str, as_of: datetime, product_id: str | None) -> None:
    trace = TraceBuilder()
    trace.add(
        type("StepResult", (), {
            "step": 10,
            "name": "for_you",
            "proceed": True,
            "reason": "OK",
            "detail": "Products shown to customer.",
        })()
    )
    decision = Decision(
        id=decision_id(customer_ref, product_id, as_of, "shown"),
        customer_ref=customer_ref,
        as_of=as_of,
        mode="shown",
        outcome="shown",
        product_id=product_id,
        channel=None,
        reasons=["OK"],
        scheduled_for=None,
        trace=trace.model("pol_v3"),
        message=None,
        simulated=True,
    )
    runtime.log.append(decision)
