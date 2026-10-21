from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.clock import WAT
from matchpoint.ledger.decision_log import DecisionLog
from matchpoint.main import app
from matchpoint.models import Consent, Txn
from matchpoint.pipeline.channels import choose_channel, next_window_end
from matchpoint.pipeline.context import Context
from matchpoint.pipeline.policy import DEFAULT_POLICY
from matchpoint.pipeline.schemas import Decision, Trace
from matchpoint.pipeline.steps import detect

client = TestClient(app)
EVALUATE = "/api/v1/decisions/evaluate"
AS_OF = "2026-12-03T09:02:00+01:00"


@pytest.fixture(autouse=True)
def runtime():
    wiring.get_runtime.cache_clear()
    yield wiring.get_runtime()
    wiring.get_runtime.cache_clear()


def post(customer: str, as_of: str = AS_OF, mode: str = "live"):
    ref = wiring.demo_customer_refs()[customer]
    return client.post(EVALUATE, json={"customer_ref": ref, "as_of": as_of, "mode": mode})


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


def candidates(body):
    return {row["product_id"]: row for row in body["trace"]["candidates"]}


def test_adaeze_matches_target_savings(runtime):
    body = post("adaeze").json()
    rows = candidates(body)

    assert rows["prd_target_savings"]["eligible"] is True
    assert rows["prd_target_savings"]["dropped"] is None
    assert rows["prd_savings_round_up"]["dropped"] is None
    assert rows["prd_target_savings"]["uplift"] > rows["prd_savings_round_up"]["uplift"]
    assert rows["prd_salary_advance"]["dropped"] == "CREDIT_REVIEW"
    assert body["trace"]["steps"][-1]["name"] == "pick_one"
    assert body["trace"]["steps"][-1]["reason"] == "PIPELINE_INCOMPLETE"


def test_musa_matches_round_up_not_business_collections(runtime):
    rows = candidates(post("musa").json())

    assert rows["prd_savings_round_up"]["dropped"] is None
    assert rows["prd_business_collections"]["dropped"] == "NOT_ELIGIBLE"
    assert rows["prd_salary_advance"]["dropped"] == "NOT_ELIGIBLE"


def test_chiamaka_matches_business_collections(runtime):
    rows = candidates(post("chiamaka").json())
    viable = [row for row in rows.values() if row["eligible"] and row["dropped"] is None]

    assert max(viable, key=lambda row: row["uplift"])["product_id"] == (
        "prd_business_collections"
    )
    assert rows["prd_business_collections"]["dropped"] is None


def test_tunde_gets_round_up_with_credit_candidates_in_review(runtime):
    body = post("tunde").json()
    rows = candidates(body)

    assert rows["prd_target_savings"]["dropped"] == "ALREADY_HOLDS"
    assert rows["prd_savings_round_up"]["dropped"] is None
    assert rows["prd_salary_advance"]["dropped"] == "CREDIT_REVIEW"
    assert rows["prd_personal_loan"]["dropped"] == "CREDIT_REVIEW"
    assert body["trace"]["steps"][-2]["name"] == "apply_rules"
    assert body["trace"]["steps"][-2]["status"] == "ok"


def test_tunde_fee_season_evidence_names_the_months(runtime):
    triggers = {t["type"]: t for t in post("tunde").json()["trace"]["triggers"]}

    assert "January" in triggers["fee_season"]["evidence"]
    assert "September" in triggers["fee_season"]["evidence"]


def test_emeka_is_referred_to_credit_review(runtime):
    body = post("emeka").json()
    rows = candidates(body)

    assert body["outcome"] == "review"
    assert body["reasons"] == ["CREDIT_REVIEW"]
    assert body["product_id"] == "prd_salary_advance"
    assert rows["prd_salary_advance"]["dropped"] == "CREDIT_REVIEW"
    for product_id in (
        "prd_target_savings",
        "prd_savings_round_up",
        "prd_personal_loan",
        "prd_fx_card",
        "prd_bills_autopay",
    ):
        assert rows[product_id]["dropped"] == "ALREADY_HOLDS"
    assert body["trace"]["steps"][-1]["name"] == "apply_rules"
    assert body["trace"]["steps"][-1]["reason"] == "CREDIT_REVIEW"


def test_cap_30d_holds_before_matching(runtime):
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
    assert body["trace"]["steps"][-1]["name"] == "apply_rules"
    assert body["trace"]["steps"][-1]["reason"] == "CAP_30D"
    cap = [rule for rule in body["trace"]["rules"] if rule["rule"] == "CAP_30D"]
    assert cap and cap[0]["passed"] is False


def test_quiet_hours_reschedule_instead_of_dropping():
    at = datetime(2026, 12, 3, 21, 30, tzinfo=WAT)
    later = datetime(2026, 12, 3, 23, 0, tzinfo=WAT)
    window = DEFAULT_POLICY.quiet_hours["sms"]

    assert next_window_end(at, window) == datetime(2026, 12, 4, 8, 0, tzinfo=WAT)
    assert next_window_end(later, window) == datetime(2026, 12, 4, 8, 0, tzinfo=WAT)


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


def _txn(at, kind, direction, narration=None, amount=1_000):
    return Txn(
        id=f"t_{at.isoformat()}",
        customer_ref="cus_000000000000",
        at=at,
        direction=direction,
        kind=kind,
        amount_band="under_5k",
        amount_kobo=amount,
        narration=narration,
    )


def test_blocked_signal_is_screened_and_holds_when_alone():
    ref = wiring.demo_customer_refs()["adaeze"]
    as_of = datetime(2026, 12, 3, 9, 0, tzinfo=WAT)
    salaries = [
        _txn(datetime(2026, month, 25, 9, 15, tzinfo=WAT), "salary", "credit", "SALARY")
        for month in (8, 9, 10, 11)
    ]
    betting = _txn(
        datetime(2026, 11, 20, 18, 0, tzinfo=WAT), "pos", "debit", "BET9JA SHOP"
    )

    ctx = Context(
        customer_ref=ref,
        as_of=as_of,
        mode="dry_run",
        adapters=None,
        clock=None,
        policy=DEFAULT_POLICY,
        log=DecisionLog(),
    )
    ctx.transactions = [*salaries, betting]
    result = detect(ctx)

    assert result.proceed
    assert "salary_regular" in [signal.type for signal in ctx.signals]
    assert "betting_spend" not in [signal.type for signal in ctx.signals]
    assert any(
        trigger.blocked and trigger.type == "betting_spend"
        for trigger in ctx.trace.triggers
    )

    only_blocked = Context(
        customer_ref=ref,
        as_of=as_of,
        mode="dry_run",
        adapters=None,
        clock=None,
        policy=DEFAULT_POLICY,
        log=DecisionLog(),
    )
    only_blocked.transactions = [betting]
    result = detect(only_blocked)

    assert result.outcome == "hold"
    assert result.reason == "SENSITIVE_TRIGGER"
