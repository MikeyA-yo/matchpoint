from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.customer.message_log import StoredMessage, message_store
from matchpoint.main import app

client = TestClient(app)
OVERVIEW = "/api/v1/metrics/overview"
BY_CHANNEL = "/api/v1/metrics/by-channel"
EVALUATE = "/api/v1/decisions/evaluate"
RESPOND = "/api/v1/messages/{}/respond"
RESET = "/api/v1/sim/reset"
CLOCK = "2026-12-03T09:00:00+01:00"


@pytest.fixture(autouse=True)
def runtime():
    yield wiring.reset_runtime()
    wiring.reset_runtime()


def add_message(
    message_id: str,
    channel: str = "app",
    *,
    sent_at=None,
    opened: bool = False,
    accepted: bool = False,
) -> None:
    at = sent_at or wiring.get_runtime().clock.now()
    message_store.append(
        StoredMessage(
            id=message_id,
            customer_ref="cus_000000000000",
            channel=channel,
            title="Put your salary to work",
            body="You can stop offers at any time.",
            why="Based on your salary. You allowed personalised offers.",
            product_id="prd_target_savings",
            sent_at=at,
            status="accepted" if accepted else "opened" if opened else "sent",
            opened_at=at if opened else None,
            accepted_at=at if accepted else None,
        )
    )


def test_empty_metrics_are_zero():
    overview = client.get(OVERVIEW).json()

    assert overview["notifications_sent"] == 0
    assert overview["sent"] == 0
    assert overview["click_rate"] == 0.0
    assert overview["product_uptake"] == 0.0
    assert overview["simulated"] is True

    by_channel = client.get(BY_CHANNEL).json()
    assert by_channel["total"]["sent"] == 0
    assert all(row["sent"] == 0 for row in by_channel["channels"])
    assert by_channel["simulated"] is True


def test_overview_counts_sent_opened_and_accepted():
    add_message("msg_app", "app", opened=True)
    add_message("msg_sms", "sms", accepted=True)

    body = client.get(OVERVIEW).json()

    assert body["notifications_sent"] == 2
    assert body["click_rate"] == 0.5
    assert body["product_uptake"] == 0.5


def test_by_channel_groups_and_totals_counts():
    add_message("msg_app", "app", opened=True)
    add_message("msg_sms", "sms", accepted=True)
    add_message("msg_sms_2", "sms")

    body = client.get(BY_CHANNEL).json()
    rows = {row["channel"]: row for row in body["channels"]}

    assert rows["app"]["sent"] == 1
    assert rows["app"]["click_rate"] == 1.0
    assert rows["sms"]["sent"] == 2
    assert rows["sms"]["click_rate"] == 0.0
    assert rows["sms"]["product_uptake"] == 0.5
    assert body["total"] == {"sent": 3, "click_rate": 0.333, "product_uptake": 0.333}


def test_messages_outside_the_window_are_ignored():
    as_of = wiring.get_runtime().clock.now()
    add_message("msg_old", "app", sent_at=as_of - timedelta(days=40))
    add_message("msg_new", "app", sent_at=as_of - timedelta(days=3))

    body = client.get(OVERVIEW, params={"window_days": 7}).json()

    assert body["window_days"] == 7
    assert body["notifications_sent"] == 1


def test_window_days_is_validated():
    res = client.get(OVERVIEW, params={"window_days": 0})

    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_respond_makes_a_click_visible_to_metrics():
    ref = wiring.demo_customer_refs()["adaeze"]
    client.post(EVALUATE, json={"customer_ref": ref, "as_of": CLOCK, "mode": "live"})
    message = message_store.all()[0]

    res = client.post(RESPOND.format(message.id), json={"action": "opened"})

    assert res.status_code == 200
    assert client.get(OVERVIEW).json()["click_rate"] == 1.0
    assert client.get(OVERVIEW).json()["product_uptake"] == 0.0


def test_reset_makes_both_endpoints_return_zeros():
    add_message("msg_app", "app", opened=True, accepted=True)

    client.post(RESET)

    assert client.get(OVERVIEW).json()["notifications_sent"] == 0
    assert client.get(OVERVIEW).json()["click_rate"] == 0.0
    assert client.get(BY_CHANNEL).json()["total"]["sent"] == 0
