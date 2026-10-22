"""One evaluate call: run the steps in order and turn the first stop into a Decision.

Hard rules and earlier gates win because the run stops at the first step that does not
proceed. The Decision is written to the append-only log exactly once per derived ID.

In the cohort pipeline, the four middle steps are build_features / assign_cluster /
pick_product / estimate_individual_gain. After the decision is recorded we emit a
DecisionTrace on the event bus so the console can observe cluster_id, template_id,
individual gain, compliance checks and the model version.
"""

from __future__ import annotations

from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.events.schemas import ComplianceCheck, DecisionTrace, stream_event
from matchpoint.pipeline.context import Context
from matchpoint.pipeline.ids import decision_id
from matchpoint.pipeline.schemas import REASON_CODES, Decision
from matchpoint.pipeline.steps import (
    assign_cluster,
    build_features,
    build_message,
    consent_gate,
    deliver,
    estimate_individual_gain,
    guardrail,
    load_context,
    opt_out_and_complaint,
    pick_product,
)
from matchpoint.pipeline.trace import MODEL_VERSION, StepResult

STEPS = (
    consent_gate,
    opt_out_and_complaint,
    load_context,
    build_features,
    assign_cluster,
    pick_product,
    estimate_individual_gain,
    build_message,
    guardrail,
    deliver,
)


def evaluate(ctx: Context) -> Decision:
    ensure_customer(ctx)
    existing = ctx.log.find(ctx.customer_ref, ctx.as_of, ctx.mode, ctx.epoch)
    if existing is not None:
        return existing
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
    if result.outcome is not None:
        outcome = result.outcome
    else:
        outcome = "send" if ctx.product is not None and ctx.message is not None else "silent"
    reason = result.reason if result.reason in REASON_CODES else "NO_MATCH"
    reasons = [reason, *(extra for extra in ctx.reasons if extra != reason)]
    product_id = ctx.product.id if ctx.product else None
    decision = Decision(
        id=decision_id(ctx.customer_ref, product_id, ctx.as_of, ctx.mode, ctx.epoch),
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
        epoch=ctx.epoch,
    )
    return _record(ctx, decision)


def _record(ctx: Context, decision: Decision) -> Decision:
    """Write the decision once and tell the stream: the decision first, its message next,
    then the DecisionTrace envelope."""
    is_new = ctx.log.get(decision.id) is None
    stored = ctx.log.append(decision)
    if is_new and ctx.events is not None:
        ctx.events.publish(
            stream_event(
                "decision_created",
                at=decision.as_of.isoformat(),
                customer_ref=decision.customer_ref,
                decision_id=decision.id,
                outcome=decision.outcome,
                product_id=decision.product_id,
                channel=decision.channel,
                reasons=list(decision.reasons),
                mode=decision.mode,
            )
        )
        delivered = ctx.delivered
        if delivered is not None:
            ctx.events.publish(
                stream_event(
                    "message_delivered",
                    at=delivered.at.isoformat(),
                    customer_ref=decision.customer_ref,
                    message_id=delivered.message_id,
                    decision_id=decision.id,
                    product_id=decision.product_id,
                    channel=decision.channel,
                    status=delivered.status,
                )
            )
        ctx.events.emit(_decision_trace(ctx, decision))
    return stored


def _decision_trace(ctx: Context, decision: Decision) -> DecisionTrace:
    feature_vector: dict = {}
    if ctx.features is not None:
        feature_vector = ctx.features.model_dump(mode="json")
    compliance = [
        ComplianceCheck(rule=rule.rule, passed=rule.passed, detail=rule.detail)
        for rule in ctx.trace.rules
    ]
    eligibility_pass = all(
        rule.passed
        for rule in ctx.trace.rules
        if rule.rule in {"NOT_ELIGIBLE", "ALREADY_HOLDS"}
    )
    guardrail_pass = all(
        rule.passed
        for rule in ctx.trace.rules
        if rule.rule.startswith("CBN_") or rule.rule in {"NCC_DND", "COMPLAINT_OPEN"}
    )
    return DecisionTrace(
        customer_ref=decision.customer_ref,
        cluster_id=ctx.cluster_id,
        product_id=decision.product_id,
        feature_vector=feature_vector,
        eligibility_pass=eligibility_pass,
        compliance_checks=compliance,
        individual_gain_kobo=ctx.gain_kobo,
        template_id=ctx.template_id,
        guardrail_pass=guardrail_pass,
        model_version=MODEL_VERSION,
        decided_at=decision.as_of,
    )
