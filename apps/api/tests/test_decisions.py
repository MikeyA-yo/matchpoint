import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.main import app

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
