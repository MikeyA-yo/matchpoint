"""The ten pipeline steps, in order. Each takes a Context and returns a StepResult.

Steps 1-3 are the gate: consent, opt-out/complaint, then context. Nothing beyond the
consent record is read until the customer has said yes to personalised offers, which is
the point of the demo. Steps 4-7 are the cohort flow: features, cluster, product pick,
individual gain. Steps 8-10 render the message, check it and deliver it.

`build_feature_vector` is re-exported from pipeline.features so the pasted spec path
`pipeline/steps.build_feature_vector` resolves.
"""

from __future__ import annotations

from datetime import timedelta

from matchpoint.customer.message_log import StoredMessage
from matchpoint.models import OutboundMessage
from matchpoint.pipeline import rules
from matchpoint.pipeline.context import Context, Delivery
from matchpoint.pipeline.explainer import explain
from matchpoint.pipeline.features import balances_from_transactions, build_feature_vector
from matchpoint.pipeline.guardrail import run_compliance_checks
from matchpoint.pipeline.ids import decision_id, message_id
from matchpoint.pipeline.policy import filter_eligible
from matchpoint.pipeline.schemas import Candidate, Trigger
from matchpoint.pipeline.trace import StepResult
from matchpoint.ranker import infer as ranker_infer

__all__ = [
    "build_feature_vector",
    "consent_gate",
    "opt_out_and_complaint",
    "load_context",
    "build_features",
    "assign_cluster",
    "pick_product",
    "estimate_individual_gain",
    "build_message",
    "guardrail",
    "deliver",
]


def consent_gate(ctx: Context) -> StepResult:
    """Step 1. Read consent, and nothing else, until it says yes."""
    consent = ctx.adapters.consent.get(ctx.customer_ref, purpose="marketing")
    ctx.consent = consent
    if not consent.personalised_offers:
        ctx.trace.check(
            "NO_CONSENT",
            False,
            "No personalised-offers consent on file. Nothing else was read.",
        )
        return StepResult(
            1,
            "consent_gate",
            "NO_CONSENT",
            "No personalised-offers consent on file.",
            outcome="silent",
        )
    ctx.trace.check(
        "NO_CONSENT",
        True,
        f"Consent from {consent.source}, updated {consent.updated_at.date().isoformat()}",
    )
    return StepResult(1, "consent_gate", "OK", f"Consent from {consent.source}")


def opt_out_and_complaint(ctx: Context) -> StepResult:
    """Step 2. A stop request or an open complaint pauses marketing, even with consent."""
    consent = ctx.consent
    if consent is None:
        return StepResult(
            2, "opt_out_and_complaint", "NO_CONSENT", "Consent was not loaded.", outcome="silent"
        )
    if consent.source == "stop_offers":
        ctx.trace.check("OPTED_OUT", False, "Customer stopped offers.")
        return StepResult(
            2, "opt_out_and_complaint", "OPTED_OUT", "Customer stopped offers.", outcome="silent"
        )
    profile = ctx.adapters.profile.get(ctx.customer_ref, purpose="marketing")
    ctx.profile = profile
    if profile.complaint_open:
        ctx.trace.check("OPTED_OUT", False, "Open complaint on file; marketing is paused.")
        return StepResult(
            2,
            "opt_out_and_complaint",
            "OPTED_OUT",
            "Open complaint on file; marketing is paused.",
            outcome="silent",
        )
    ctx.trace.check("OPTED_OUT", True, "No stop request and no open complaint.")
    return StepResult(2, "opt_out_and_complaint", "OK", "No stop request or open complaint.")


def load_context(ctx: Context) -> StepResult:
    """Step 3. Profile (with cluster_id), holdings, transactions and the catalogue."""
    # Re-read profile under profiling purpose so cluster_id is not withheld.
    ctx.profile = ctx.adapters.profile.get(ctx.customer_ref, purpose="profiling")
    ctx.transactions = ctx.adapters.transactions.window(
        ctx.customer_ref, ctx.window_start(), ctx.as_of, purpose="profiling"
    )
    ctx.products = ctx.adapters.catalogue.active(ctx.as_of, purpose="marketing")
    detail = f"{len(ctx.transactions)} transactions, {len(ctx.products)} active products"
    return StepResult(3, "load_context", "OK", detail)


def build_features(ctx: Context) -> StepResult:
    """Step 4. Narration-classified counts, frequency, amount, timing, balance stats."""
    if ctx.profile is None:
        return StepResult(
            4, "build_features", "NO_MATCH", "Profile missing.", outcome="silent"
        )
    balances = balances_from_transactions(ctx.transactions)
    features = build_feature_vector(
        ctx.transactions, balances, list(ctx.profile.holdings), ctx.profile
    )
    ctx.features = features
    for label, count in features.narration_counts.items():
        ctx.trace.triggers.append(
            Trigger(
                type=f"narration_{label}",
                evidence=f"{count} {label} rows",
                category=None,
                blocked=False,
            )
        )
    if not features.narration_counts:
        return StepResult(
            4,
            "build_features",
            "NO_MATCH",
            "No usable transactions in the window.",
            outcome="silent",
        )
    return StepResult(
        4,
        "build_features",
        "OK",
        f"features: {len(features.narration_counts)} narration labels, "
        f"{features.freq_txns_per_month} txn/mo",
    )


def assign_cluster(ctx: Context) -> StepResult:
    """Step 5. Read the persisted cluster_id, or fall back to ranker.infer."""
    cluster_id: int | None = ctx.profile.cluster_id if ctx.profile else None
    source = "persisted"
    if cluster_id is None and ctx.features is not None:
        scored = ranker_infer.score_products(ctx.features)
        if scored:
            top_product_id = scored[0][0]
            cluster_id = _cluster_for_product(top_product_id)
            source = "ranker_fallback"
    if cluster_id is None:
        cluster_id = -1
        source = "noise"
    ctx.cluster_id = cluster_id
    ctx.trace.check(
        "CLUSTER_ASSIGNED",
        True,
        f"cluster_id={cluster_id} via {source}",
    )
    return StepResult(5, "assign_cluster", "OK", f"cluster_id={cluster_id} ({source})")


def pick_product(ctx: Context) -> StepResult:
    """Step 6. Map cluster -> product, run hard eligibility, caps and cooldowns."""
    mapping = ranker_infer.cluster_to_product()
    product_id = mapping.get(str(ctx.cluster_id)) or mapping.get("-1")
    if product_id is None:
        return StepResult(
            6, "pick_product", "NO_MATCH", "Cluster map has no product.", outcome="silent"
        )
    product = next((p for p in ctx.products if p.id == product_id), None)
    if product is None:
        return StepResult(
            6,
            "pick_product",
            "NO_MATCH",
            f"Cluster map pointed at unknown product {product_id}.",
            outcome="silent",
        )

    # Candidate row for the trace.
    def _row(dropped: str | None = None) -> Candidate:
        return Candidate(
            product_id=product.id,
            eligible=dropped != "NOT_ELIGIBLE",
            uplift=1.0,
            dropped=dropped,
        )

    if product.holding_id and product.holding_id in (ctx.profile.holdings if ctx.profile else []):
        ctx.trace.check("ALREADY_HOLDS", False, f"Customer holds {product.holding_id}.")
        ctx.trace.candidates.append(_row("ALREADY_HOLDS"))
        return StepResult(
            6, "pick_product", "ALREADY_HOLDS", "Customer already holds the product.",
            outcome="silent",
        )

    eligible = filter_eligible([product], ctx.profile, ctx.features)
    if not eligible:
        ctx.trace.check("NOT_ELIGIBLE", False, f"{product.id} failed eligibility.")
        ctx.trace.candidates.append(_row("NOT_ELIGIBLE"))
        return StepResult(
            6, "pick_product", "NOT_ELIGIBLE",
            f"{product.id} failed the eligibility filter.", outcome="silent",
        )
    ctx.trace.check("NOT_ELIGIBLE", True, f"{product.id} passed eligibility.")
    ctx.trace.candidates.append(_row())

    cap = rules.contact_cap(ctx)
    ctx.trace.check(cap.rule, cap.passed, cap.detail)
    if not cap.passed:
        return StepResult(
            6, "pick_product", cap.dropped or "CAP_30D", cap.detail,
            outcome=cap.outcome or "hold",
        )

    ctx.product = product
    ctx.template_id = f"cluster_{ctx.cluster_id}"

    from matchpoint.pipeline.context import ScoredProduct

    single = ScoredProduct(product=product, eligible=True, score=1, uplift=1.0)
    for check in rules.CANDIDATE_RULES:
        result = check(ctx, single)
        ctx.trace.check(result.rule, result.passed, result.detail)
        if result.dropped:
            ctx.product = None
            return StepResult(
                6, "pick_product", result.dropped, result.detail,
                outcome=result.outcome or "hold",
            )
        for reason in result.reasons:
            if reason not in ctx.reasons:
                ctx.reasons.append(reason)
        if result.scheduled_for is not None:
            ctx.scheduled_for = result.scheduled_for

    ctx.channel = single.channel
    if ctx.channel is None:
        return StepResult(
            6, "pick_product", "NO_CHANNEL_CONSENT",
            "No consented channel is left for this customer.", outcome="hold",
        )

    return StepResult(6, "pick_product", "OK", f"{product.id} picked for cluster {ctx.cluster_id}")


def estimate_individual_gain(ctx: Context) -> StepResult:
    """Step 7. Compute the individual kobo gain from the FeatureVector."""
    if ctx.product is None or ctx.features is None:
        return StepResult(
            7, "estimate_individual_gain", "NO_MATCH",
            "No product or features available.", outcome="silent",
        )
    from matchpoint.pipeline.gain import estimate_gain

    ctx.gain_kobo = estimate_gain(ctx.product, ctx.features, ctx.transactions)
    return StepResult(
        7,
        "estimate_individual_gain",
        "OK",
        f"gain_kobo={ctx.gain_kobo} for {ctx.product.id}",
    )


def build_message(ctx: Context) -> StepResult:
    """Step 8. Render the cluster template with the customer's evidence."""
    if ctx.product is None or ctx.features is None or ctx.template_id is None:
        return StepResult(
            8,
            "build_message",
            "TEMPLATE_MISSING",
            "No product/features/template were picked, so there is no message.",
            outcome="silent",
        )
    evidence = _evidence_from(ctx)
    guarded, gain_kobo = explain(
        ctx.product, ctx.features, ctx.transactions, ctx.template_id, evidence, ctx.policy
    )
    ctx.gain_kobo = gain_kobo
    if guarded.blocked:
        for check in guarded.checks:
            ctx.trace.check(check.rule, check.passed, check.detail)
        return StepResult(
            8,
            "build_message",
            "GUARDRAIL_BLOCKED",
            "Template render failed a copy check.",
            outcome="hold",
        )
    ctx.message = guarded.message
    return StepResult(
        8, "build_message", "OK",
        f"Message prepared for {ctx.product.id} from {ctx.template_id}",
    )


def guardrail(ctx: Context) -> StepResult:
    """Step 9. Compliance checks on the message before it can go out."""
    if ctx.message is None or ctx.profile is None:
        return StepResult(
            9, "guardrail", "GUARDRAIL_BLOCKED",
            "No message or profile available to check.", outcome="hold",
        )
    checks = run_compliance_checks(ctx.message, ctx.profile, ctx.policy)
    for check in checks:
        ctx.trace.check(check.rule, check.passed, check.detail)
    if not all(check.passed for check in checks):
        ctx.message = None
        return StepResult(
            9, "guardrail", "GUARDRAIL_BLOCKED",
            "The message failed a safety check.", outcome="hold",
        )
    return StepResult(9, "guardrail", "OK", f"All {len(checks)} safety checks passed")


def deliver(ctx: Context) -> StepResult:
    """Step 10. Choose the channel, call the gateway in live mode, write the log."""
    if ctx.product is None or ctx.message is None:
        return StepResult(
            10, "deliver", "TEMPLATE_MISSING", "Nothing was ready to deliver.", outcome="hold",
        )
    existing = ctx.log.get(
        decision_id(ctx.customer_ref, ctx.product.id, ctx.as_of, ctx.mode, ctx.epoch)
    )
    if existing is not None:
        return StepResult(
            10, "deliver", "OK", "Decision already recorded; not sent again."
        )
    if ctx.mode == "dry_run":
        return StepResult(10, "deliver", "OK", "Dry run: the gateway was not called")
    if ctx.channel is None:
        return StepResult(
            10, "deliver", "NO_CHANNEL_CONSENT", "No consented channel is left.", outcome="hold",
        )
    if ctx.scheduled_for is not None and ctx.scheduled_for > ctx.as_of:
        return StepResult(
            10, "deliver", "OK",
            f"Scheduled for {ctx.scheduled_for.isoformat()}; gateway not called now",
        )

    msg = OutboundMessage(
        id=message_id(ctx.customer_ref, ctx.product.id, ctx.as_of, ctx.mode, ctx.epoch),
        customer_ref=ctx.customer_ref,
        channel=ctx.channel,
        title=ctx.message.title,
        body=ctx.message.body,
        why=ctx.message.why,
        kind="marketing",
        product_id=ctx.product.id,
        cluster_id=ctx.cluster_id,
        template_id=ctx.template_id,
    )
    receipt = ctx.adapters.channels.send(msg, purpose="marketing")
    if receipt.status in ("accepted", "queued"):
        stored = StoredMessage(
            id=msg.id,
            customer_ref=msg.customer_ref,
            channel=msg.channel,
            title=msg.title,
            body=msg.body,
            why=msg.why,
            product_id=msg.product_id,
            sent_at=receipt.at,
        )
        ctx.adapters.message_store.append(stored)
        ctx.delivered = Delivery(message_id=msg.id, at=receipt.at, status=receipt.status)
        return StepResult(10, "deliver", "OK", f"{ctx.channel}: {receipt.status}")
    ctx.message = None
    return StepResult(
        10, "deliver", "NO_CHANNEL_CONSENT",
        f"{ctx.channel} rejected the message: {receipt.reason}", outcome="hold",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cluster_for_product(product_id: str) -> int:
    for cluster_id, mapped in ranker_infer.cluster_to_product().items():
        if mapped == product_id:
            try:
                return int(cluster_id)
            except ValueError:
                continue
    return -1


def _evidence_from(ctx: Context) -> dict:
    features = ctx.features
    if features is None:
        return {}
    salary_day = features.time_payday or ""
    salary_day_text = f"{salary_day}" if salary_day else "25th"
    scheduled_for = ctx.scheduled_for or (ctx.as_of + timedelta(days=1))
    return {
        "time_payday": salary_day_text,
        "freq_txns_per_month": features.freq_txns_per_month,
        "bal_avg": features.bal_avg,
        "balance_naira": features.bal_avg // 100,
        "surplus_naira": features.amt_surplus // 100,
        "scheduled_for": scheduled_for.isoformat(),
        "cluster_description": "fit this product's typical profile",
    }
