"""Cohort pipeline unit + e2e tests. One file to keep the suite compact."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.adapters.transactions.translate import classify_narration
from matchpoint.clock import WAT
from matchpoint.main import app
from matchpoint.models import Profile
from matchpoint.pipeline.explainer import compose
from matchpoint.pipeline.features import balances_from_transactions, build_feature_vector
from matchpoint.pipeline.guardrail import check_copy
from matchpoint.pipeline.policy import DEFAULT_POLICY, filter_eligible

client = TestClient(app)
EVALUATE = "/api/v1/decisions/evaluate"
AS_OF = "2026-12-03T09:02:00+01:00"


@pytest.fixture(autouse=True)
def runtime():
    yield wiring.reset_runtime()
    wiring.reset_runtime()


# ---------------------------------------------------------------------------
# classify_narration
# ---------------------------------------------------------------------------


def test_classify_narration_known_phrases_pick_the_right_label():
    assert classify_narration("MONTHLY SALARY FROM EMPLOYER") == "salary"
    assert classify_narration("MTN AIRTIME TOP UP") == "airtime"
    assert classify_narration("EEDC ELECTRICITY BILL") == "utility"
    assert classify_narration("SCHOOL FEE PAYMENT FOR TUNDE JR") == "school_fee"
    assert classify_narration("BET9JA DEPOSIT") == "bet"


def test_classify_narration_trn_code_short_circuits_the_embedding():
    # Even when the narration has nothing to go on, the TRN_CODE path still wins.
    assert classify_narration("", trn_code="SAL") == "salary"
    assert classify_narration("REFUND", trn_code="REV") == "reversal"


def test_classify_narration_unknown_text_falls_to_other():
    assert classify_narration("ZZZ UNRECOGNISED STRING QQQ") == "other"


# ---------------------------------------------------------------------------
# build_feature_vector
# ---------------------------------------------------------------------------


def _txn(at, kind, direction, narration=None, amount=1_000_00, ref="cus_000000000001"):
    from matchpoint.models import Txn

    return Txn(
        id=f"t_{at.isoformat()}",
        customer_ref=ref,
        at=at,
        direction=direction,
        kind=kind,
        amount_band="under_5k",
        amount_kobo=amount,
        narration=narration,
    )


def test_build_feature_vector_populates_the_five_groups():
    base = datetime(2026, 9, 25, 9, 0, tzinfo=WAT)
    txns = [
        _txn(base, "salary", "credit", "SALARY", amount=500_000_00),
        _txn(base + timedelta(days=30), "salary", "credit", "SALARY", amount=500_000_00),
        _txn(base + timedelta(days=60), "salary", "credit", "SALARY", amount=500_000_00),
        _txn(base + timedelta(days=5), "pos", "debit", "SPAR GROCERIES", amount=12_000_00),
        _txn(base + timedelta(days=10), "pos", "debit", "SHOPRITE", amount=15_000_00),
    ]
    profile = Profile(customer_ref=txns[0].customer_ref, age_band="25-34", segment="salaried")
    balances = balances_from_transactions(txns)
    fv = build_feature_vector(txns, balances, list(profile.holdings), profile)

    assert fv.narration_counts["salary"] == 3
    assert fv.narration_counts.get("pos", 0) == 2
    assert fv.freq_txns_per_month > 0
    assert fv.amt_median_credit == 500_000_00
    assert fv.time_payday == 25
    assert fv.bal_turnover > 0


def test_build_feature_vector_drops_reversals_and_fees():
    base = datetime(2026, 9, 1, 9, 0, tzinfo=WAT)
    txns = [
        _txn(base, "salary", "credit", "SALARY"),
        _txn(base + timedelta(days=1), "reversal", "credit", "REVERSAL"),
        _txn(base + timedelta(days=2), "stamp_duty", "debit", "STAMP DUTY"),
        _txn(base + timedelta(days=3), "charge", "debit", "SMS FEE"),
    ]
    profile = Profile(customer_ref=txns[0].customer_ref, age_band="25-34", segment="salaried")
    balances = balances_from_transactions(txns)
    fv = build_feature_vector(txns, balances, list(profile.holdings), profile)

    assert "reversal" not in fv.narration_counts
    assert "stamp_duty" not in fv.narration_counts
    assert "fee" not in fv.narration_counts


# ---------------------------------------------------------------------------
# filter_eligible
# ---------------------------------------------------------------------------


def _product(product_id: str, catalogue):
    return next(p for p in catalogue if p.id == product_id)


def test_filter_eligible_age_gate_blocks_a_minor(runtime):
    as_of = datetime.fromisoformat(AS_OF)
    catalogue = runtime.adapters.catalogue.active(as_of, purpose="marketing")
    product = _product("Salary_Advance", catalogue)
    minor = Profile(customer_ref="cus_000000000001", age_band="18-24", segment="salaried")

    kept = filter_eligible([product], minor, None)
    # 18-24 lower edge is 18, Salary_Advance needs 21+
    assert kept == []


def test_filter_eligible_holdings_forbidden(runtime):
    as_of = datetime.fromisoformat(AS_OF)
    catalogue = runtime.adapters.catalogue.active(as_of, purpose="marketing")
    product = _product("eaZySave_Classic", catalogue)
    holder = Profile(
        customer_ref="cus_000000000001",
        age_band="25-34",
        segment="salaried",
        holdings=["eazysave_classic"],
    )

    assert filter_eligible([product], holder, None) == []


def test_filter_eligible_signal_required(runtime):
    from matchpoint.models import FeatureVector

    as_of = datetime.fromisoformat(AS_OF)
    catalogue = runtime.adapters.catalogue.active(as_of, purpose="marketing")
    product = _product("Domiciliary_USD", catalogue)
    profile = Profile(customer_ref="cus_000000000001", age_band="25-34", segment="salaried")
    no_signal = FeatureVector(customer_ref=profile.customer_ref, narration_counts={})
    with_signal = FeatureVector(
        customer_ref=profile.customer_ref, narration_counts={"remittance": 3}
    )

    assert filter_eligible([product], profile, no_signal) == []
    assert filter_eligible([product], profile, with_signal) == [product]


# ---------------------------------------------------------------------------
# guardrail.check_copy
# ---------------------------------------------------------------------------


def test_check_copy_passes_clean_text():
    good = "Save with us. You can stop offers at any time."
    checks = {c.rule: c.passed for c in check_copy(good, DEFAULT_POLICY)}
    assert all(checks.values())


def test_check_copy_catches_misleading_claims():
    bad = "Guaranteed returns! Risk-free money. Reply STOP."
    checks = {c.rule: c.passed for c in check_copy(bad, DEFAULT_POLICY)}
    assert checks["CBN_NO_MISLEADING_CLAIMS"] is False


def test_check_copy_requires_opt_out():
    missing = "A great product for you."
    checks = {c.rule: c.passed for c in check_copy(missing, DEFAULT_POLICY)}
    assert checks["CBN_OPT_OUT"] is False


# ---------------------------------------------------------------------------
# explainer.compose (Jinja2)
# ---------------------------------------------------------------------------


def test_compose_renders_cluster_template_with_evidence():
    evidence = {
        "time_payday": 25,
        "freq_txns_per_month": 12.0,
        "bal_avg": 150_000_00,
        "balance_naira": 150_000,
        "surplus_naira": 25_000,
        "product_name": "eaZySave Classic",
        "product_id": "eaZySave_Classic",
        "rate_pct": "10%",
        "tenor_months": 12,
        "cluster_description": "fit this product's typical profile",
        "scheduled_for": AS_OF,
    }
    guarded = compose("cluster_0", evidence, gain_kobo=1_200_000_00)

    assert guarded.message is not None
    assert "eaZySave Classic" in guarded.message.title
    assert "stop offers" in guarded.message.body.lower()


def test_compose_fallback_template_renders_without_cluster_fields():
    evidence = {"product_name": "Save4Me", "product_id": "Save_4_me"}
    guarded = compose("cluster_999", evidence, gain_kobo=5_000_00)
    # cluster_999 does not exist -> fallback.j2
    assert guarded.message is not None
    assert "Save4Me" in guarded.message.title


# ---------------------------------------------------------------------------
# End-to-end
# ---------------------------------------------------------------------------


def test_evaluate_endpoint_carries_cohort_metadata_in_the_trace(runtime):
    ref = wiring.demo_customer_refs()["adaeze"]
    res = client.post(
        EVALUATE, json={"customer_ref": ref, "as_of": AS_OF, "mode": "live"}
    )

    assert res.status_code == 200
    body = res.json()
    step_names = [step["name"] for step in body["trace"]["steps"]]
    # The cohort steps always appear once the gate opens, regardless of outcome.
    assert "build_features" in step_names
    assert "assign_cluster" in step_names
    # Trace rules include CLUSTER_ASSIGNED for an observable cluster id.
    assert any(rule["rule"] == "CLUSTER_ASSIGNED" for rule in body["trace"]["rules"])
