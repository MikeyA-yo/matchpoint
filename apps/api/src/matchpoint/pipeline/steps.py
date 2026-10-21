"""The ten pipeline steps, in order. Each takes a Context and returns a StepResult.

Steps 1-3 are the gate: consent, opt-out/complaint, then context. Nothing beyond the
consent record is read until the customer has said yes to personalised offers, which is
the point of the demo. Steps 4-10 stop with PIPELINE_INCOMPLETE until they land.
"""

from __future__ import annotations

from matchpoint.pipeline.context import Context
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
    return _pending(4, "detect")


def match_products(ctx: Context) -> StepResult:
    """Step 5. Score eligible, not-held products against the signals."""
    return _pending(5, "match_products")


def apply_rules(ctx: Context) -> StepResult:
    """Step 6. Consent, caps, gaps, cooldowns, quiet hours, DND and credit review."""
    return _pending(6, "apply_rules")


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
        detail="Not built yet: the pipeline stops after loading context.",
        outcome="silent",
    )
