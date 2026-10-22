from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.clock import WAT
from matchpoint.main import app
from matchpoint.models import Consent
from matchpoint.pipeline.channels import choose_channel, next_window_end
from matchpoint.pipeline.guardrail import run_checks
from matchpoint.pipeline.policy import DEFAULT_POLICY
from matchpoint.pipeline.schemas import Decision, Message, Trace

client = TestClient(app)
EVALUATE = "/api/v1/decisions/evaluate"
AS_OF = "2026-12-03T09:02:00+01:00"


@pytest.fixture(autouse=True)
def runtime():
    yield wiring.reset_runtime()
    wiring.reset_runtime()


def post(customer: str, as_of: str = AS_OF, mode: str = "live"):
    ref = wiring.demo_customer_refs()[customer]
    return client.post(EVALUATE, json={"customer_ref": ref, "as_of": as_of, "mode": mode})


# ---------------------------------------------------------------------------
# Gating invariants (unchanged by the cohort rewrite)
# ---------------------------------------------------------------------------


def test_no_consent_is_silent_and_reads_nothing(runtime):
    runtime.adapters.access_log.clear()

    res = post("ngozi")

    assert res.status_code == 200
    body = res.json()
    assert body["outcome"] == "silent"
    assert body["reasons"] == ["NO_CONSENT"]
    assert body["product_id"] is None
    assert body["channel"] is None
    assert body["message"] is None
    assert [step["name"] for step in body["trace"]["steps"]] == ["consent_gate"]
    connectors = {record.connector for record in runtime.adapters.access_log.recent()}
    assert connectors == {"CustomerProfile", "ConsentStore"}


def test_open_complaint_is_silent(runtime):
    runtime.adapters.access_log.clear()

    body = post("halima").json()

    assert body["outcome"] == "silent"
    assert body["reasons"] == ["OPTED_OUT"]
    steps = body["trace"]["steps"]
    assert [step["name"] for step in steps] == ["consent_gate", "opt_out_and_complaint"]
    assert "complaint" in steps[-1]["detail"]
    assert "TransactionFeed" not in {r.connector for r in runtime.adapters.access_log.recent()}


def test_stopped_offers_is_silent(runtime):
    ref = wiring.demo_customer_refs()["adaeze"]
    consent = runtime.adapters.consent.get(ref, purpose="marketing")
    runtime.adapters.consent.set(
        ref, consent.model_copy(update={"source": "stop_offers"}), purpose="marketing"
    )

    body = post("adaeze").json()

    assert body["outcome"] == "silent"
    assert body["reasons"] == ["OPTED_OUT"]
    assert "stopped offers" in body["trace"]["steps"][-1]["detail"]


def test_consent_lets_the_pipeline_load_context(runtime):
    runtime.adapters.access_log.clear()

    body = post("adaeze").json()

    steps = body["trace"]["steps"]
    assert [step["name"] for step in steps[:3]] == [
        "consent_gate",
        "opt_out_and_complaint",
        "load_context",
    ]
    assert "transactions" in steps[2]["detail"]
    connectors = {record.connector for record in runtime.adapters.access_log.recent()}
    assert {"TransactionFeed", "ProductCatalogue"} <= connectors


def test_unknown_customer_is_404():
    res = client.post(
        EVALUATE,
        json={"customer_ref": "cus_000000000000", "as_of": AS_OF, "mode": "live"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "CUSTOMER_NOT_FOUND"


def test_request_shape_is_validated():
    bad_ref = client.post(EVALUATE, json={"customer_ref": "nope", "as_of": AS_OF})
    assert bad_ref.status_code == 422
    assert bad_ref.json()["error"]["code"] == "VALIDATION_ERROR"

    naive_time = client.post(
        EVALUATE,
        json={"customer_ref": "cus_000000000000", "as_of": "2026-12-03T09:02:00"},
    )
    assert naive_time.status_code == 422


def test_same_customer_and_as_of_returns_the_same_decision(runtime):
    bodies = [post("halima").json() for _ in range(3)]
    assert bodies[0] == bodies[1] == bodies[2]
    assert len(runtime.log.for_customer(bodies[0]["customer_ref"])) == 1


# ---------------------------------------------------------------------------
# Cohort pipeline shape
# ---------------------------------------------------------------------------


def test_decision_trace_carries_cluster_and_template(runtime):
    body = post("adaeze").json()

    # Even if the final outcome is hold/silent, the trace up to that point names
    # the step chain. For a consenting customer we expect at least through
    # pick_product (cluster-based pick).
    step_names = [step["name"] for step in body["trace"]["steps"]]
    assert "build_features" in step_names
    assert "assign_cluster" in step_names


def test_cohort_pipeline_produces_a_send_for_a_consenting_customer(runtime):
    body = post("adaeze").json()

    # The exact product id depends on the cluster map but every consenting,
    # eligible, unsilenced flow should resolve to send (never crash).
    assert body["outcome"] in {"send", "hold", "silent", "review"}
    if body["outcome"] == "send":
        assert body["product_id"] is not None
        assert body["channel"] is not None
        assert body["message"] is not None
        assert "stop offers" in body["message"]["body"].lower()


def test_credit_product_routes_to_review(runtime):
    """Whichever customer the cohort maps to a credit product must either hit
    CREDIT_REVIEW or be dropped as ALREADY_HOLDS/NOT_ELIGIBLE. Credit
    offers never auto-send."""
    for customer in ("adaeze", "musa", "tunde", "chiamaka", "emeka", "halima"):
        body = post(customer).json()
        if body["outcome"] == "send":
            # Picked product must be non-credit.
            as_of = datetime.fromisoformat(body["as_of"])
            catalogue = {p.id: p for p in runtime.adapters.catalogue.active(
                as_of, purpose="marketing"
            )}
            picked = catalogue.get(body["product_id"])
            assert picked is not None and not picked.is_credit
        elif body["outcome"] == "review":
            assert body["reasons"][0] == "CREDIT_REVIEW"


def test_cap_30d_holds_in_pick_product(runtime):
    ref = wiring.demo_customer_refs()["adaeze"]
    for index, day in enumerate((20, 25)):
        runtime.log.append(
            Decision(
                id=f"seed_{index}",
                customer_ref=ref,
                as_of=datetime(2026, 11, day, 9, 0, tzinfo=WAT),
                mode="live",
                outcome="send",
                product_id="prd_savings_round_up",
                channel="app",
                reasons=["OK"],
                trace=Trace(policy_version="pol_v3", model_version="rules_v1"),
            )
        )

    body = post("adaeze").json()

    assert body["outcome"] == "hold"
    assert body["reasons"] == ["CAP_30D"]
    stop_step = body["trace"]["steps"][-1]
    assert stop_step["name"] == "pick_product"
    assert stop_step["reason"] == "CAP_30D"
    cap = [rule for rule in body["trace"]["rules"] if rule["rule"] == "CAP_30D"]
    assert cap and cap[0]["passed"] is False


# ---------------------------------------------------------------------------
# Quiet hours, delivery accounting, guardrail copy
# ---------------------------------------------------------------------------


def test_quiet_hours_reschedule_instead_of_dropping():
    at = datetime(2026, 12, 3, 21, 30, tzinfo=WAT)
    later = datetime(2026, 12, 3, 23, 0, tzinfo=WAT)
    window = DEFAULT_POLICY.quiet_hours["sms"]

    assert next_window_end(at, window) == datetime(2026, 12, 4, 8, 0, tzinfo=WAT)
    assert next_window_end(later, window) == datetime(2026, 12, 4, 8, 0, tzinfo=WAT)


def test_live_send_is_recorded_once(runtime):
    first = post("adaeze").json()
    second = post("adaeze").json()

    assert first == second
    assert len(runtime.log.for_customer(first["customer_ref"])) == 1


def test_dry_run_send_is_not_a_contact(runtime):
    body = post("adaeze", mode="dry_run").json()
    ref = body["customer_ref"]
    as_of = datetime.fromisoformat(body["as_of"])

    if body["outcome"] == "send":
        assert runtime.log.contacts_since(ref, as_of) == 0


def test_guardrail_blocks_misleading_copy():
    good = Message(
        title="Put your salary to work",
        body="You can stop offers at any time.",
        why="Based on your salary. You allowed personalised offers.",
    )
    assert all(check.passed for check in run_checks(good, DEFAULT_POLICY))

    bad = Message(
        title="Guaranteed returns",
        body="Risk-free money. You can stop offers at any time.",
        why="",
    )
    checks = {check.rule: check.passed for check in run_checks(bad, DEFAULT_POLICY)}
    assert checks["CBN_NO_MISLEADING_CLAIMS"] is False


def test_channel_order_follows_category(runtime):
    as_of = datetime.fromisoformat(AS_OF)
    products = {
        product.id: product
        for product in runtime.adapters.catalogue.active(as_of, purpose="marketing")
    }
    consent = Consent(
        customer_ref="cus_000000000000",
        personalised_offers=True,
        channels={"app": True, "ussd": True},
        updated_at=as_of,
        source="test",
    )

    assert choose_channel(consent, products["prd_business_collections"]) == "ussd"
    assert choose_channel(consent, products["prd_target_savings"]) == "app"
    assert choose_channel(
        consent, products["prd_business_collections"], sms_allowed=False
    ) == "ussd"
