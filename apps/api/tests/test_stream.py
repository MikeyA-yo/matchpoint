import asyncio
import json
import threading

import pytest
from fastapi.testclient import TestClient

from matchpoint import wiring
from matchpoint.main import app
from matchpoint.routers.stream import event_stream

client = TestClient(app)
START = "/api/v1/sim/start"
EVALUATE = "/api/v1/decisions/evaluate"
CONFIG = {"seed": 42, "n_customers": 5000, "days": 120, "scenario": "baseline"}
CLOCK = "2026-12-03T09:00:00+01:00"


@pytest.fixture(autouse=True)
def runtime():
    yield wiring.reset_runtime()
    wiring.reset_runtime()


def test_stream_is_an_event_stream():
    with client.stream("GET", "/api/v1/stream") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"


def test_pipeline_publishes_decision_and_message_frames():
    wiring.reset_runtime()
    client.post(START, json=CONFIG)
    ref = wiring.demo_customer_refs()["adaeze"]

    async def collect():
        bus = wiring.get_runtime().events
        stream = event_stream(bus, bus.subscribe())
        try:
            first = asyncio.create_task(anext(stream))
            await asyncio.sleep(0)  # let the generator subscribe

            def evaluate():
                client.post(
                    EVALUATE,
                    json={"customer_ref": ref, "as_of": CLOCK, "mode": "live"},
                )

            thread = threading.Thread(target=evaluate)
            thread.start()
            chunks = [await asyncio.wait_for(first, 5)]
            chunks.append(await asyncio.wait_for(anext(stream), 5))
            thread.join(5)
            return chunks
        finally:
            await stream.aclose()

    decision, message = asyncio.run(collect())

    assert decision.startswith("event: decision_created\ndata: ")
    assert message.startswith("event: message_delivered\ndata: ")

    decision_data = json.loads(decision.split("data: ", 1)[1])
    assert decision_data["customer_ref"] == ref
    assert decision_data["outcome"] == "send"
    assert decision_data["mode"] == "live"
    assert decision_data["at"] == CLOCK

    message_data = json.loads(message.split("data: ", 1)[1])
    assert message_data["customer_ref"] == ref
    assert message_data["product_id"] == decision_data["product_id"]
    assert message_data["channel"] == "app"
    assert message_data["decision_id"] == decision_data["decision_id"]
