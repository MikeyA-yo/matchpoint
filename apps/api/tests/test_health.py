from fastapi.testclient import TestClient

from matchpoint.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_unknown_route_uses_error_envelope():
    res = client.get("/api/v1/nope")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["trace_id"].startswith("trc_")
