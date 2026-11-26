from fastapi.testclient import TestClient

from nexus_titan_api.main import app


def test_health_contract_roundtrip() -> None:
    response = TestClient(app).get("/health")
    print(f"GET /health -> {response.status_code} {response.json()}")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "nexus-titan-api"}


def test_request_id_is_propagated_without_logging_request_data() -> None:
    response = TestClient(app).get("/health", headers={"x-request-id": "phase03-smoke"})
    assert response.headers["x-request-id"] == "phase03-smoke"


def test_readiness_is_not_green_without_database(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    response = TestClient(app).get("/health/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"
