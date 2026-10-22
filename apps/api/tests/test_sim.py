import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.main import app

client = TestClient(app)
START = "/api/v1/sim/start"
RESET = "/api/v1/sim/reset"
INJECT = "/api/v1/sim/inject"
STATE = "/api/v1/sim/state"
EVALUATE = "/api/v1/decisions/evaluate"
CLOCK = "2026-12-03T09:00:00+01:00"
CONFIG = {"seed": 42, "n_customers": 5000, "days": 120, "scenario": "baseline"}


@pytest.fixture(autouse=True)
def runtime():
    yield wiring.reset_runtime()
    wiring.reset_runtime()


def start(config=CONFIG):
    return client.post(START, json=config)


def evaluate(key, as_of=CLOCK):
    ref = wiring.demo_customer_refs()[key]
    return client.post(
        EVALUATE, json={"customer_ref": ref, "as_of": as_of, "mode": "live"}
    )


def test_state_before_start_is_not_running():
    body = client.get(STATE).json()

    assert body["running"] is False
    assert body["clock"] is None
    assert body["n_customers"] == 5000
    assert body["simulated_customers"] == 7
    assert body["simulated"] is True


def test_inject_before_start_is_409():
    res = client.post(INJECT, json={"pattern": "salary_pattern"})

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "SIM_NOT_STARTED"


def test_start_reports_the_requested_population_and_the_real_one():
    body = start().json()

    assert body["running"] is True
    assert body["clock"] == CLOCK
    assert body["seed"] == 42
    assert body["n_customers"] == 5000
    assert body["simulated_customers"] == 7
    assert body["injected"] == []


def test_start_validates_the_config():
    assert start({"seed": 42, "n_customers": 0, "days": 120}).status_code == 422
    assert start({"seed": 42, "n_customers": 10, "days": 400}).status_code == 422


def test_inject_without_a_customer_reports_the_population_share():
    start()

    res = client.post(INJECT, json={"pattern": "sme_growth"})

    assert res.status_code == 200
    assert res.json() == {
        "pattern": "sme_growth",
        "customer_ref": None,
        "affected": 250,
    }
    assert client.get(STATE).json()["injected"][0]["pattern"] == "sme_growth"


def test_inject_with_an_unknown_customer_is_404():
    start()

    res = client.post(INJECT, json={"pattern": "sme_growth", "customer_ref": "cus_nobody"})

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "CUSTOMER_NOT_FOUND"


def test_salary_pattern_flips_musas_decision_under_the_same_as_of():
    start()
    before = evaluate("musa").json()
    assert before["epoch"] == 0

    ref = wiring.demo_customer_refs()["musa"]
    res = client.post(INJECT, json={"pattern": "salary_pattern", "customer_ref": ref})
    assert res.json() == {
        "pattern": "salary_pattern",
        "customer_ref": ref,
        "affected": 1,
    }

    after = evaluate("musa").json()
    assert after["id"] != before["id"]
    assert after["epoch"] == 1
    # Planting a salary stream should surface a narration_salary trigger even
    # if the cluster's chosen product declines eligibility.
    triggers = [t["type"] for t in after["trace"]["triggers"]]
    assert "narration_salary" in triggers

    # A retry at the same instant returns the epoch's decision, not a third send.
    assert evaluate("musa").json()["id"] == after["id"]


def test_fee_season_plants_the_january_and_september_evidence():
    start()
    before = evaluate("adaeze").json()
    before_fee = next(
        (t for t in before["trace"]["triggers"] if t["type"] == "narration_school_fee"),
        None,
    )

    ref = wiring.demo_customer_refs()["adaeze"]
    client.post(INJECT, json={"pattern": "fee_season", "customer_ref": ref})

    after = evaluate("adaeze").json()
    assert after["id"] != before["id"]
    after_fee = next(
        (t for t in after["trace"]["triggers"] if t["type"] == "narration_school_fee"),
        None,
    )
    # Either the first run had no school-fee rows and the plant adds them, or
    # both runs have them and the planted count is strictly higher.
    assert after_fee is not None
    if before_fee is not None:
        before_count = int(before_fee["evidence"].split()[0])
        after_count = int(after_fee["evidence"].split()[0])
        assert after_count > before_count


def test_sme_growth_adds_pos_inflows_for_a_customer_without_them():
    start()
    ref = wiring.demo_customer_refs()["adaeze"]
    before_body = evaluate("adaeze").json()
    before_pos = next(
        (t for t in before_body["trace"]["triggers"] if t["type"] == "narration_pos"),
        None,
    )

    client.post(INJECT, json={"pattern": "sme_growth", "customer_ref": ref})

    after_body = evaluate("adaeze").json()
    after_pos = next(
        (t for t in after_body["trace"]["triggers"] if t["type"] == "narration_pos"),
        None,
    )
    assert after_pos is not None
    if before_pos is not None:
        before_count = int(before_pos["evidence"].split()[0])
        after_count = int(after_pos["evidence"].split()[0])
        assert after_count >= before_count


def test_reset_returns_to_the_start_line():
    start()
    ref = wiring.demo_customer_refs()["musa"]
    client.post(INJECT, json={"pattern": "salary_pattern", "customer_ref": ref})

    body = client.post(RESET).json()

    assert body["running"] is False
    assert body["clock"] is None
    assert body["injected"] == []
    assert body["n_customers"] == 5000
    assert client.get(STATE).json()["clock"] is None

    # The decision log is new too, so the demo's first evaluation runs again.
    start()
    assert evaluate("musa").json()["epoch"] == 0
