"""The ten pipeline steps, in order. Each takes a Context and returns a StepResult.

Steps 1-3 are the gate: consent, opt-out/complaint, then context. Nothing beyond the
consent record is read until the customer has said yes to personalised offers, which is
the point of the demo. Steps 4-6 detect, match and apply hard rules. Steps 7-10 stop with
PIPELINE_INCOMPLETE until they land.
"""

from __future__ import annotations

from matchpoint.pipeline import rules
from matchpoint.pipeline.context import Context, ScoredProduct
from matchpoint.pipeline.detector import detect_signals
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
    return _pending(7, "pick_one")


def build_message(ctx: Context) -> StepResult:
    """Step 8. Fill the approved template with evidence, the gain and key facts."""
    return _pending(8, "build_message")


def guardrail(ctx: Context) -> StepResult:
    """Step 9. Three CBN checks on the message before it can go out."""
    return _pending(9, "guardrail")


def deliver(ctx: Context) -> StepResult:
    """Step 10. Choose the channel, call the gateway in live mode, write the log."""
    return _pending(10, "deliver")


def _pending(step: int, name: str) -> StepResult:
    return StepResult(
        step=step,
        name=name,
        reason="PIPELINE_INCOMPLETE",
        detail="Not built yet: the pipeline stops before this step.",
        outcome="silent",
    )
