"""One evaluate call: run the steps in order and turn the first stop into a Decision.

Hard rules and earlier gates win because the run stops at the first step that does not
proceed. The Decision is written to the append-only log exactly once per derived ID.
"""

from __future__ import annotations

from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.pipeline.context import Context
from matchpoint.pipeline.ids import decision_id
from matchpoint.pipeline.schemas import REASON_CODES, Decision
from matchpoint.pipeline.steps import (
    apply_rules,
    build_message,
    consent_gate,
    deliver,
    detect,
    guardrail,
    load_context,
    match_products,
    opt_out_and_complaint,
    pick_one,
)
from matchpoint.pipeline.trace import StepResult

STEPS = (
    consent_gate,
    opt_out_and_complaint,
    load_context,
    detect,
    match_products,
    apply_rules,
    pick_one,
    build_message,
    guardrail,
    deliver,
)


def evaluate(ctx: Context) -> Decision:
    ensure_customer(ctx)
    result = StepResult(0, "start")
    for step in STEPS:
        result = step(ctx)
        ctx.trace.add(result)
        if not result.proceed:
            break
    return _finish(ctx, result)


def ensure_customer(ctx: Context) -> None:
    """404 before the gate, without reading a profile.

    Existence is not profiling: the adapter answers yes or no and returns no fields, so
    an unknown ref can get the documented error without weakening "nothing else is read".
    """
    answer = ctx.adapters.profile.exists(ctx.customer_ref, purpose="service")
    if not answer.exists:
        raise CustomerNotFound("CustomerProfile", f"unknown {ctx.customer_ref}")


def _finish(ctx: Context, result: StepResult) -> Decision:
    outcome = result.outcome or "silent"
    reason = result.reason if result.reason in REASON_CODES else "NO_MATCH"
    reasons = [reason, *(extra for extra in ctx.reasons if extra != reason)]
    product_id = ctx.product.id if ctx.product else None
    decision = Decision(
        id=decision_id(ctx.customer_ref, product_id, ctx.as_of, ctx.mode),
        customer_ref=ctx.customer_ref,
        as_of=ctx.as_of,
        mode=ctx.mode,
        outcome=outcome,
        product_id=product_id,
        channel=ctx.channel,
        reasons=reasons,
        scheduled_for=ctx.scheduled_for,
        trace=ctx.trace.model(ctx.policy.id),
        message=ctx.message,
    )
    return ctx.log.append(decision)
