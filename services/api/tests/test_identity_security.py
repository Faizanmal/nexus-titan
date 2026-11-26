from __future__ import annotations

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from firebase_admin import auth

from nexus_titan_api.database import get_session
from nexus_titan_api.identity import (
    Actor,
    current_actor,
    validate_identity_configuration,
)
from nexus_titan_api.main import app
from nexus_titan_api.models import Device, Membership

client = TestClient(app)


@pytest.fixture(autouse=True)
def secure_test_environment(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("ALLOW_APPCHECK_BYPASS", "false")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:expected")
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def test_missing_id_token_is_rejected(monkeypatch):
    verifier = Mock()
    monkeypatch.setattr("nexus_titan_api.identity.verify_firebase_id_token", verifier)
    response = client.get("/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    verifier.assert_not_called()


@pytest.mark.parametrize(
    "failure,code",
    [
        (ValueError("invalid"), "INVALID_ID_TOKEN"),
        (auth.ExpiredIdTokenError("expired", None), "INVALID_ID_TOKEN"),
    ],
)
def test_invalid_and_expired_id_tokens_fail_closed(monkeypatch, failure, code):
    def reject(_token):
        raise failure

    monkeypatch.setattr("nexus_titan_api.identity.verify_firebase_id_token", reject)
    response = client.get("/v1/me", headers={"Authorization": "Bearer not-a-token"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == code


def test_wrong_app_check_app_is_rejected(monkeypatch):
    monkeypatch.setattr(
        "nexus_titan_api.identity.verify_firebase_id_token",
        lambda _token: {"uid": "u1"},
    )
    monkeypatch.setattr(
        "nexus_titan_api.identity.verify_firebase_app_check",
        lambda _token: {"sub": "1:other:web:app"},
    )
    response = client.get(
        "/v1/me",
        headers={"Authorization": "Bearer good", "X-Firebase-AppCheck": "wrong-app"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "APPCHECK_WRONG_APP"


def test_missing_and_invalid_app_check_are_rejected(monkeypatch):
    monkeypatch.setattr(
        "nexus_titan_api.identity.verify_firebase_id_token",
        lambda _token: {"uid": "u1"},
    )
    missing = client.get("/v1/me", headers={"Authorization": "Bearer good"})
    assert missing.status_code == 403
    assert missing.json()["error"]["code"] == "APPCHECK_REQUIRED"

    def reject(_token):
        raise ValueError("invalid App Check token")

    monkeypatch.setattr("nexus_titan_api.identity.verify_firebase_app_check", reject)
    invalid = client.get(
        "/v1/me",
        headers={"Authorization": "Bearer good", "X-Firebase-AppCheck": "invalid"},
    )
    assert invalid.status_code == 403
    assert invalid.json()["error"]["code"] == "APPCHECK_INVALID"


def test_local_bypass_refuses_production_startup(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_APPCHECK_BYPASS", "true")
    with pytest.raises(RuntimeError, match="forbidden"):
        validate_identity_configuration()


def test_production_requires_expected_app_check_app_id(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_APPCHECK_BYPASS", "false")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "nexus-prod")
    monkeypatch.delenv("FIREBASE_APP_ID", raising=False)
    with pytest.raises(RuntimeError, match="FIREBASE_APP_ID"):
        validate_identity_configuration()


def test_production_rejects_firestore_emulator(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_APPCHECK_BYPASS", "false")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "nexus-prod")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:expected")
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    with pytest.raises(RuntimeError, match="Firestore emulator"):
        validate_identity_configuration()


def test_invite_delivery_is_disabled_outside_local_environment(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:expected")
    _use_actor_and_session("owner")
    response = client.post(
        "/v1/organizations/org-alpha/invites",
        json={"email": "new@example.test", "role": "viewer", "site_ids": []},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "INVITE_DELIVERY_UNCONFIGURED"


def _event_payload(tenant_id: str) -> dict:
    return {
        "tenant_id": tenant_id,
        "device_id": "00000000-0000-4000-8000-000000000001",
        "events": [
            {
                "event_id": "11111111-1111-4111-8111-111111111111",
                "tenant_id": tenant_id,
                "schema_version": "1.1.0",
                "event_type": "asset.created",
                "source": "device",
                "sequence": 1,
                "occurred_at": "2026-11-15T10:00:00Z",
                "classification": "internal",
                "site_id": "site-alpha",
                "aggregate_type": "asset",
                "aggregate_id": "asset-1",
                "expected_revision": 0,
                "payload": {},
            }
        ],
    }


class MembershipSession:
    def __init__(
        self,
        *,
        role: str,
        organization_id: str = "org-alpha",
        device_status: str | None = None,
    ):
        self.role = role
        self.organization_id = organization_id
        self.device_status = device_status

    def get(self, model, key):
        if model is Membership and key == (self.organization_id, "test-user"):
            return Membership(
                organization_id=self.organization_id,
                user_id="test-user",
                role=self.role,
                status="active",
            )
        if model is Device:
            return Device(
                id=key,
                organization_id=self.organization_id,
                user_id="test-user",
                client_device_id="browser-device",
                label="test",
                public_key_pem="pem",
                status=self.device_status or "registered",
            )
        return None

    def scalar(self, _query):
        if self.device_status:
            return Device(
                id="00000000-0000-4000-8000-000000000001",
                organization_id=self.organization_id,
                user_id="test-user",
                client_device_id="browser-device",
                label="test",
                public_key_pem="pem",
                status=self.device_status,
            )
        return None

    def scalars(self, _query):
        class Result:
            @staticmethod
            def all():
                return []

        return Result()


def _use_actor_and_session(
    role: str, organization_id: str = "org-alpha", device_status: str | None = None
):
    app.dependency_overrides[current_actor] = lambda: Actor(
        "test-user", "test@example.test", True
    )
    app.dependency_overrides[get_session] = lambda: MembershipSession(
        role=role, organization_id=organization_id, device_status=device_status
    )


def test_tenant_id_tampering_does_not_select_another_membership():
    _use_actor_and_session("viewer", "org-alpha")
    response = client.post("/v1/events", json=_event_payload("org-bravo"))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "TENANT_ACCESS_DENIED"


def test_viewer_cannot_write_events(monkeypatch):
    _use_actor_and_session("viewer", "org-alpha")
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )
    response = client.post("/v1/events", json=_event_payload("org-alpha"))
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "denied"
    assert response.json()["results"][0]["code"] == "ROLE_FORBIDDEN"


def test_revoked_device_is_rejected_by_trust_check():
    _use_actor_and_session("operator", "org-alpha", "revoked")
    response = client.get("/v1/organizations/org-alpha/devices/browser-device/trust")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "DEVICE_NOT_TRUSTED"


def test_peer_key_lookup_requires_active_same_tenant_membership_and_registered_key():
    _use_actor_and_session("operator", "org-alpha", "registered")
    response = client.get(
        "/v1/organizations/org-alpha/devices/00000000-0000-4000-8000-000000000001/peer-key"
    )
    assert response.status_code == 200
    assert response.json() == {
        "device_id": "00000000-0000-4000-8000-000000000001",
        "public_key_pem": "pem",
        "status": "registered",
    }

    _use_actor_and_session("viewer", "org-alpha", "registered")
    viewer = client.get(
        "/v1/organizations/org-alpha/devices/00000000-0000-4000-8000-000000000001/peer-key"
    )
    assert viewer.status_code == 403
    assert viewer.json()["error"]["code"] == "ROLE_FORBIDDEN"

    _use_actor_and_session("operator", "org-alpha", "revoked")
    # A real SQL query's status filter would return no row for the fake revoked device.
    app.dependency_overrides[get_session] = lambda: MembershipSession(
        role="operator", organization_id="org-alpha"
    )
    revoked = client.get(
        "/v1/organizations/org-alpha/devices/00000000-0000-4000-8000-000000000001/peer-key"
    )
    assert revoked.status_code == 404
    assert revoked.json()["error"]["code"] == "PEER_DEVICE_UNAVAILABLE"

    _use_actor_and_session("operator", "org-alpha")
    cross_tenant = client.get(
        "/v1/organizations/org-bravo/devices/00000000-0000-4000-8000-000000000001/peer-key"
    )
    assert cross_tenant.status_code == 403

    class ViewerOwnedDeviceSession(MembershipSession):
        def scalar(self, _query):
            return Device(
                id="00000000-0000-4000-8000-000000000002",
                organization_id="org-alpha",
                user_id="viewer-user",
                client_device_id="viewer-browser",
                label="viewer",
                public_key_pem="pem",
                status="registered",
            )

        def get(self, model, key):
            if model is Membership and key == ("org-alpha", "viewer-user"):
                return Membership(
                    organization_id="org-alpha",
                    user_id="viewer-user",
                    role="viewer",
                    status="active",
                )
            return super().get(model, key)

    _use_actor_and_session("operator", "org-alpha")
    app.dependency_overrides[get_session] = lambda: ViewerOwnedDeviceSession(
        role="operator", organization_id="org-alpha"
    )
    viewer_device = client.get(
        "/v1/organizations/org-alpha/devices/00000000-0000-4000-8000-000000000002/peer-key"
    )
    assert viewer_device.status_code == 404


def test_peer_device_inventory_is_tenant_authenticated_and_excludes_unregistered_rows():
    _use_actor_and_session("operator", "org-alpha")
    response = client.get("/v1/organizations/org-alpha/devices/peers")
    assert response.status_code == 200
    assert response.json() == {"organization_id": "org-alpha", "devices": []}
    openapi = client.get("/openapi.json").json()
    assert "/v1/organizations/{organization_id}/devices/peers" in openapi["paths"]
    assert (
        "/v1/organizations/{organization_id}/devices/{device_id}/peer-key"
        in openapi["paths"]
    )

    cross_tenant = client.get("/v1/organizations/org-bravo/devices/peers")
    assert cross_tenant.status_code == 403
