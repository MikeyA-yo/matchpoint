"""The ten pipeline steps, in order. Each takes a Context and returns a StepResult.

Steps 1-3 are the gate: consent, opt-out/complaint, then context. Nothing beyond the
consent record is read until the customer has said yes to personalised offers, which is
the point of the demo. Steps 4-6 detect, match and apply hard rules. Steps 7-10 pick one,
write the message, check it and deliver it.
"""

from __future__ import annotations

from matchpoint.customer.message_log import StoredMessage
from matchpoint.models import OutboundMessage
from matchpoint.pipeline import rules
from matchpoint.pipeline.context import Context, Delivery, ScoredProduct
from matchpoint.pipeline.detector import detect_signals
from matchpoint.pipeline.explainer import explain
from matchpoint.pipeline.guardrail import run_checks
from matchpoint.pipeline.ids import decision_id, message_id
from matchpoint.pipeline.matcher import build_candidates
from matchpoint.pipeline.schemas import Candidate, Trigger
from matchpoint.pipeline.trace import StepResult


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
    """Step 3. Profile, holdings, transactions and the catalogue, through the adapters."""
    if ctx.profile is None:
        ctx.profile = ctx.adapters.profile.get(ctx.customer_ref, purpose="marketing")
    ctx.transactions = ctx.adapters.transactions.window(
        ctx.customer_ref, ctx.window_start(), ctx.as_of, purpose="profiling"
    )
    ctx.products = ctx.adapters.catalogue.active(ctx.as_of, purpose="marketing")
    detail = f"{len(ctx.transactions)} transactions, {len(ctx.products)} active products"
    return StepResult(3, "load_context", "OK", detail)


def detect(ctx: Context) -> StepResult:
    """Step 4. Turn transactions into signals and screen blocked categories."""
    signals = detect_signals(
        ctx.transactions, ctx.as_of, ctx.policy.blocked_trigger_categories
    )
    for signal in signals:
        ctx.trace.triggers.append(
            Trigger(
                type=signal.type,
                evidence=signal.evidence,
                category=signal.category,
                blocked=signal.blocked,
            )
        )
    if not signals:
        return StepResult(
            4,
            "detect",
            "NO_MATCH",
            "No signals found in the transaction window.",
            outcome="silent",
        )
    usable = [signal for signal in signals if not signal.blocked]
    blocked = len(signals) - len(usable)
    if not usable:
        ctx.trace.check(
            "SENSITIVE_TRIGGER",
            False,
            f"Only blocked-category signals were found ({blocked}).",
        )
        return StepResult(
            4,
            "detect",
            "SENSITIVE_TRIGGER",
            "Only blocked-category triggers were found.",
            outcome="hold",
        )
    if blocked:
        ctx.trace.check(
            "SENSITIVE_TRIGGER",
            True,
            f"Screened out {blocked} blocked-category trigger(s); "
            f"{len(usable)} usable remain.",
        )
    ctx.signals = usable
    detail = f"{len(usable)} usable signals"
    if blocked:
        detail += f", {blocked} blocked"
    return StepResult(4, "detect", "OK", detail)


def match_products(ctx: Context) -> StepResult:
    """Step 5. Score eligible, not-held products against the signals."""
    ctx.candidates = build_candidates(ctx.products, ctx.profile, ctx.signals)
    ctx.trace.candidates = [_row(candidate) for candidate in ctx.candidates]
    viable = [
        candidate for candidate in ctx.candidates if candidate.eligible and candidate.score > 0
    ]
    if not viable:
        return StepResult(
            5,
            "match_products",
            "NO_MATCH",
            "No eligible product fits the detected signals.",
            outcome="silent",
        )
    return StepResult(
        5,
        "match_products",
        "OK",
        f"{len(viable)} of {len(ctx.products)} products fit the signals",
    )


def apply_rules(ctx: Context) -> StepResult:
    """Step 6. Consent, caps, gaps, cooldowns, quiet hours, DND and credit review."""
    cap = rules.contact_cap(ctx)
    ctx.trace.check(cap.rule, cap.passed, cap.detail)
    if not cap.passed:
        return StepResult(
            6,
            "apply_rules",
            cap.dropped or "CAP_30D",
            cap.detail,
            outcome=cap.outcome or "hold",
        )
    if ctx.profile and ctx.profile.dnd_registered:
        dnd = rules.dnd_sms(ctx)
        ctx.trace.check(dnd.rule, dnd.passed, dnd.detail)

    live = [
        candidate for candidate in ctx.candidates if candidate.eligible and candidate.score > 0
    ]
    for candidate in live:
        for check in rules.CANDIDATE_RULES:
            result = check(ctx, candidate)
            ctx.trace.check(result.rule, result.passed, result.detail)
            if result.dropped:
                candidate.dropped = result.dropped
                candidate.drop_outcome = result.outcome
                break
            candidate.reasons.extend(result.reasons)
            if result.scheduled_for is not None:
                candidate.scheduled_for = result.scheduled_for

    ctx.trace.candidates = [_row(candidate) for candidate in ctx.candidates]
    viable = [candidate for candidate in live if candidate.dropped is None]
    if viable:
        return StepResult(
            6,
            "apply_rules",
            "OK",
            f"{len(viable)} candidate(s) passed every rule",
        )
    review = [candidate for candidate in live if candidate.dropped == "CREDIT_REVIEW"]
    if review:
        ctx.product = review[0].product
        return StepResult(
            6,
            "apply_rules",
            "CREDIT_REVIEW",
            f"{len(review)} credit candidate(s) need a person; nothing else passed.",
            outcome="review",
        )
    best = live[0] if live else None
    if best is None:
        return StepResult(
            6, "apply_rules", "NO_MATCH", "No candidate reached the rules.", outcome="silent"
        )
    return StepResult(
        6,
        "apply_rules",
        best.dropped or "NO_MATCH",
        f"Every candidate was dropped; best was {best.product.id}: {best.dropped}.",
        outcome=best.drop_outcome or "hold",
    )


def _row(candidate: ScoredProduct) -> Candidate:
    return Candidate(
        product_id=candidate.product.id,
        eligible=candidate.eligible,
        uplift=candidate.uplift,
        dropped=candidate.dropped,
    )


def pick_one(ctx: Context) -> StepResult:
    """Step 7. Take the top-scoring candidate that passed every rule."""
    viable = [
        candidate
        for candidate in ctx.candidates
        if candidate.eligible and candidate.score > 0 and candidate.dropped is None
    ]
    if not viable:
        return StepResult(
            7, "pick_one", "NO_MATCH", "No candidate passed every rule.", outcome="silent"
        )
    threshold = ctx.policy.min_uplift
    above = [candidate for candidate in viable if candidate.uplift >= threshold]
    if not above:
        best = viable[0]
        ctx.trace.check(
            "LOW_UPLIFT",
            False,
            f"{best.product.id}: uplift {best.uplift:.3f} is below {threshold}",
        )
        return StepResult(
            7,
            "pick_one",
            "LOW_UPLIFT",
            "The best candidate is below the uplift threshold.",
            outcome="hold",
        )

    remaining = ctx.policy.max_messages_per_30d - ctx.log.contacts_since(
        ctx.customer_ref, ctx.as_of
    )
    ctx.trace.check(
        "ATTENTION_BUDGET",
        remaining > 0,
        f"{remaining} of {ctx.policy.max_messages_per_30d} left",
    )
    if remaining <= 0:
        return StepResult(
            7,
            "pick_one",
            "ATTENTION_BUDGET",
            "The customer's attention budget is spent.",
            outcome="hold",
        )

    winner = above[0]
    ctx.product = winner.product
    ctx.channel = winner.channel
    ctx.scheduled_for = winner.scheduled_for
    ctx.reasons.extend(reason for reason in winner.reasons if reason not in ctx.reasons)
    ctx.trace.check(
        "LOW_UPLIFT",
        True,
        f"{winner.product.id}: uplift {winner.uplift:.3f} is above {threshold}",
    )
    return StepResult(
        7,
        "pick_one",
        "OK",
        f"{winner.product.id} won the slot at {winner.uplift:.3f} uplift",
    )


def build_message(ctx: Context) -> StepResult:
    """Step 8. Fill the approved template with evidence, the gain and key facts."""
    if ctx.product is None:
        return StepResult(
            8,
            "build_message",
            "TEMPLATE_MISSING",
            "No product was picked, so there is no message.",
            outcome="silent",
        )
    ctx.message, ctx.gain_kobo = explain(ctx.product, ctx.signals, ctx.transactions)
    return StepResult(
        8, "build_message", "OK", f"Message prepared for {ctx.product.id}"
    )


def guardrail(ctx: Context) -> StepResult:
    """Step 9. Three CBN checks on the message before it can go out."""
    if ctx.message is None:
        return StepResult(
            9,
            "guardrail",
            "GUARDRAIL_BLOCKED",
            "No message was available to check.",
            outcome="hold",
        )
    checks = run_checks(ctx.message, ctx.policy)
    for check in checks:
        ctx.trace.check(check.rule, check.passed, check.detail)
    if not all(check.passed for check in checks):
        ctx.message = None
        return StepResult(
            9,
            "guardrail",
            "GUARDRAIL_BLOCKED",
            "The message failed a safety check.",
            outcome="hold",
        )
    return StepResult(9, "guardrail", "OK", "All three safety checks passed")


def deliver(ctx: Context) -> StepResult:
    """Step 10. Choose the channel, call the gateway in live mode, write the log."""
    if ctx.product is None or ctx.message is None:
        return StepResult(
            10,
            "deliver",
            "TEMPLATE_MISSING",
            "Nothing was ready to deliver.",
            outcome="hold",
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
            10,
            "deliver",
            "NO_CHANNEL_CONSENT",
            "No consented channel is left.",
            outcome="hold",
        )
    if ctx.scheduled_for is not None and ctx.scheduled_for > ctx.as_of:
        return StepResult(
            10,
            "deliver",
            "OK",
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
        ctx.delivered = Delivery(
            message_id=msg.id, at=receipt.at, status=receipt.status
        )
        return StepResult(
            10, "deliver", "OK", f"{ctx.channel}: {receipt.status}"
        )
    ctx.message = None
    return StepResult(
        10,
        "deliver",
        "NO_CHANNEL_CONSENT",
        f"{ctx.channel} rejected the message: {receipt.reason}",
        outcome="hold",
    )
