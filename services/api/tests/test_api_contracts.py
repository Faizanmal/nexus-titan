import pytest
from fastapi.testclient import TestClient

from nexus_titan_api.database import get_session
from nexus_titan_api.identity import Actor, current_actor
from nexus_titan_api.main import app
from nexus_titan_api.models import Membership

client = TestClient(app)


class ContractTestSession:
    def get(self, model, key):
        if model is Membership and key == ("tenant-demo", "test-user"):
            return Membership(
                organization_id="tenant-demo",
                user_id="test-user",
                role="owner",
                status="active",
            )
        return None


@pytest.fixture
def authenticated_client():
    app.dependency_overrides[current_actor] = lambda: Actor(
        "test-user", "test@example.test", True
    )
    app.dependency_overrides[get_session] = lambda: ContractTestSession()
    yield client
    app.dependency_overrides.clear()


def test_api_rejects_invalid_event_and_reports_schema_path(
    authenticated_client,
) -> None:
    response = authenticated_client.post(
        "/v1/events",
        json={"tenant_id": "tenant-demo", "events": [{"source": "unknown-source"}]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["request_id"]


def test_api_valid_event_requires_device_signature(authenticated_client) -> None:
    payload = {
        "tenant_id": "tenant-demo",
        "device_id": "00000000-0000-4000-8000-000000000001",
        "events": [
            {
                "event_id": "11111111-1111-4111-8111-111111111111",
                "tenant_id": "tenant-demo",
                "schema_version": "1.1.0",
                "event_type": "asset.created",
                "source": "device",
                "sequence": 1,
                "occurred_at": "2026-11-14T10:00:00Z",
                "classification": "internal",
                "site_id": "site-demo",
                "aggregate_type": "asset",
                "aggregate_id": "asset-1",
                "expected_revision": 0,
                "payload": {},
            }
        ],
    }
    response = authenticated_client.post("/v1/events", json=payload)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "DEVICE_PROOF_REQUIRED"


def test_api_serves_generated_openapi_models(authenticated_client) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "EventBatch" in response.json()["components"]["schemas"]
    assert "/sync/events" in response.json()["paths"]
    assert "SyncEventBatch" in response.json()["components"]["schemas"]
