from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from uuid import UUID

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from fastapi.testclient import TestClient

from nexus_titan_api.contracts import validate_contract
from nexus_titan_api.database import get_session
from nexus_titan_api.event_store import canonical_json
from nexus_titan_api.identity import Actor, current_actor
from nexus_titan_api.main import app
from nexus_titan_api.models import Device, Membership
from nexus_titan_api.queue_migration import (
    CURRENT_SCHEMA_VERSION,
    migrate_event_record,
)

ROOT = Path(__file__).resolve().parents[3]
SYNC_FIXTURE_PATH = ROOT / "tests/fixtures/contracts/v1.1.0/sync-event-batch.json"
TEST_DEVICE_UUID = UUID("00000000-0000-4000-8000-000000000009")


class FakeRows:
    def all(self):
        return ["site-demo", "TITAN-WTP-01"]


class FakeSession:
    def __init__(
        self,
        public_key_pem: str,
        organization_id: str = "tenant-demo",
        status: str = "registered",
    ):
        self.public_key_pem = public_key_pem
        self.organization_id = organization_id
        self.device_status = status

    def get(self, model, key):
        if model is Membership and key == (self.organization_id, "interop-user"):
            return Membership(
                organization_id=self.organization_id,
                user_id="interop-user",
                role="owner",
                status="active",
            )
        if model is Device and key == TEST_DEVICE_UUID:
            return Device(
                id=TEST_DEVICE_UUID,
                organization_id=self.organization_id,
                user_id="interop-user",
                client_device_id="device-interop-test",
                label="Interop Test Device",
                public_key_pem=self.public_key_pem,
                status=self.device_status,
            )
        return None

    def scalar(self, query, *_args):
        if getattr(query, "column_descriptions", None):
            return Device(
                id=TEST_DEVICE_UUID,
                organization_id=self.organization_id,
                user_id="interop-user",
                client_device_id="device-interop-test",
                label="Interop Test Device",
                public_key_pem=self.public_key_pem,
                status=self.device_status,
            )
        return 0

    def scalars(self, _query):
        return FakeRows()


@pytest.fixture
def auth_client():
    actor = Actor("interop-user", "interop@example.test", True)
    app.dependency_overrides[current_actor] = lambda: actor
    yield TestClient(app)
    app.dependency_overrides.clear()


# ==============================================================================
# 1. Mesh Protocol Conformance & Capability Matrix Tests
# ==============================================================================


def test_mesh_conformance_endpoint_returns_platform_matrix(auth_client):
    session = FakeSession("dummy_pem")
    app.dependency_overrides[get_session] = lambda: session

    response = auth_client.get("/v1/organizations/tenant-demo/mesh/conformance")
    assert response.status_code == 200

    data = response.json()
    assert data["schema_version"] == "1.3.0"
    assert data["timestamp_standard"] == "ISO-8601-UTC"

    platforms = data["platforms"]
    assert platforms["web"]["status"] == "VERIFIED"
    assert platforms["web"]["hardware_floor_verified"] is True
    assert platforms["web"]["primary_transport"] == "webrtc_datachannel"

    assert platforms["android"]["status"] == "PARTIAL_SOURCE_VERIFIED"
    assert platforms["android"]["blocker"] == "HOST_ANDROID_SDK_JDK_ABSENT"
    assert platforms["android"]["security_vault"] == "android_keystore_aes_256_gcm"

    assert platforms["ios"]["status"] == "PARTIAL_SOURCE_VERIFIED"
    assert platforms["ios"]["blocker"] == "HOST_MACOS_XCODE_ABSENT"
    assert platforms["ios"]["primary_transport"] == "multipeer_connectivity"

    assert "Ed25519" in data["sync_contract"]["signature_algorithms"]
    assert "ECDSA_SECP256R1_SHA256" in data["sync_contract"]["signature_algorithms"]


# ==============================================================================
# 2. Canonical JSON Determinism & Contract Roundtrip Tests
# ==============================================================================


def test_canonical_json_determinism():
    dict_a = {"z": 1, "a": {"k": 2, "b": 3}, "m": [3, 2, 1]}
    dict_b = {"a": {"b": 3, "k": 2}, "m": [3, 2, 1], "z": 1}

    # Different key ordering must produce identical canonical string
    assert canonical_json(dict_a) == canonical_json(dict_b)
    assert canonical_json(dict_a) == '{"a":{"b":3,"k":2},"m":[3,2,1],"z":1}'


def test_contract_roundtrip_v130_compatibility():
    payload = json.loads(SYNC_FIXTURE_PATH.read_text(encoding="utf-8"))
    for ev in payload["events"]:
        ev["schema_version"] = "1.3.0"

    violations = validate_contract("SyncEventBatch", payload)
    assert not violations, f"Contract validation errors: {violations}"


# ==============================================================================
# 3. Dual-Algorithm Device Signing & Verification Tests
# ==============================================================================


def test_ed25519_device_signature_verification(auth_client, monkeypatch):
    ed_key = ed25519.Ed25519PrivateKey.generate()
    pub_pem = (
        ed_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode("ascii")
    )

    session = FakeSession(pub_pem)
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.append_event",
        lambda *_args, **_kwargs: {
            "event_id": "11111111-1111-4111-8111-111111111111",
            "status": "accepted",
            "sequence": 1,
            "revision": 1,
        },
    )

    payload = json.loads(SYNC_FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["device_id"] = str(TEST_DEVICE_UUID)
    body = canonical_json(payload)
    sig = ed_key.sign(body.encode("utf-8"))

    response = auth_client.post(
        "/sync/events",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Nexus-Device-Signature": base64.b64encode(sig).decode("ascii"),
        },
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "accepted"


def test_ecdsa_secp256r1_device_signature_verification(auth_client, monkeypatch):
    ec_key = ec.generate_private_key(ec.SECP256R1())
    pub_pem = (
        ec_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode("ascii")
    )

    session = FakeSession(pub_pem)
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.append_event",
        lambda *_args, **_kwargs: {
            "event_id": "11111111-1111-4111-8111-111111111111",
            "status": "accepted",
            "sequence": 1,
            "revision": 1,
        },
    )

    payload = json.loads(SYNC_FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["device_id"] = str(TEST_DEVICE_UUID)
    body = canonical_json(payload)
    sig = ec_key.sign(body.encode("utf-8"), ec.ECDSA(hashes.SHA256()))

    response = auth_client.post(
        "/sync/events",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Nexus-Device-Signature": base64.b64encode(sig).decode("ascii"),
        },
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "accepted"


# ==============================================================================
# 4. Negative Security Gates: Tampered Payload & Cross-Tenant Rejection
# ==============================================================================


def test_negative_tampered_payload_rejected(auth_client, monkeypatch):
    ed_key = ed25519.Ed25519PrivateKey.generate()
    pub_pem = (
        ed_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode("ascii")
    )

    session = FakeSession(pub_pem)
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )

    payload = json.loads(SYNC_FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["device_id"] = str(TEST_DEVICE_UUID)
    body = canonical_json(payload)
    sig = ed_key.sign(body.encode("utf-8"))

    # Tamper with the body after signing
    tampered_payload = copy.deepcopy(payload)
    tampered_payload["events"][0]["payload"]["tampered_field"] = "ATTACK_VALUE"
    tampered_body = canonical_json(tampered_payload)

    response = auth_client.post(
        "/sync/events",
        content=tampered_body,
        headers={
            "Content-Type": "application/json",
            "X-Nexus-Device-Signature": base64.b64encode(sig).decode("ascii"),
        },
    )
    assert response.status_code == 403
    err_body = response.json()
    code = err_body.get("code") or err_body.get("error", {}).get("code")
    assert code == "DEVICE_PROOF_INVALID"


def test_negative_cross_tenant_transfer_rejected(auth_client, monkeypatch):
    ed_key = ed25519.Ed25519PrivateKey.generate()
    pub_pem = (
        ed_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode("ascii")
    )

    # Session only authorizes tenant-demo, not tenant-rogue
    session = FakeSession(pub_pem, organization_id="tenant-demo")
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )

    payload = json.loads(SYNC_FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["tenant_id"] = "tenant-rogue"
    payload["device_id"] = str(TEST_DEVICE_UUID)
    for ev in payload["events"]:
        ev["tenant_id"] = "tenant-rogue"

    body = canonical_json(payload)
    sig = ed_key.sign(body.encode("utf-8"))

    response = auth_client.post(
        "/sync/events",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Nexus-Device-Signature": base64.b64encode(sig).decode("ascii"),
        },
    )
    # Rejection: Actor lacks membership in tenant-rogue
    assert response.status_code in {403, 404}


# ==============================================================================
# 5. Exactly-Once Offline Synchronization (Deduplication)
# ==============================================================================


def test_offline_outbox_deduplication(auth_client, monkeypatch):
    ed_key = ed25519.Ed25519PrivateKey.generate()
    pub_pem = (
        ed_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode("ascii")
    )

    session = FakeSession(pub_pem)
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )

    committed_ids = set()

    def mock_append(_sess, device_id, event):
        eid = event["event_id"]
        if eid in committed_ids:
            return {"event_id": eid, "status": "duplicate"}
        committed_ids.add(eid)
        return {"event_id": eid, "status": "accepted", "sequence": 1, "revision": 1}

    monkeypatch.setattr("nexus_titan_api.event_routes.append_event", mock_append)

    payload = json.loads(SYNC_FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["device_id"] = str(TEST_DEVICE_UUID)
    body = canonical_json(payload)
    sig = ed_key.sign(body.encode("utf-8"))
    headers = {
        "Content-Type": "application/json",
        "X-Nexus-Device-Signature": base64.b64encode(sig).decode("ascii"),
    }

    # First sync: Accepted
    res1 = auth_client.post("/sync/events", content=body, headers=headers)
    assert res1.status_code == 200
    assert res1.json()["results"][0]["status"] == "accepted"

    # Second sync of identical batch: Deduplicated as "duplicate"
    res2 = auth_client.post("/sync/events", content=body, headers=headers)
    assert res2.status_code == 200
    assert res2.json()["results"][0]["status"] == "duplicate"


# ==============================================================================
# 6. Legacy Queue Migration & Schema Upgrades
# ==============================================================================


def test_legacy_queue_migration():
    legacy_event = {
        "schema_version": "1.0.0",
        "event_id": "99999999-9999-4999-8999-999999999999",
        "timestamp": 1710000000,
        "aggregate_type": "asset",
        "event_type": "asset.updated",
        "payload": {"state": "nominal"},
    }

    upgraded = migrate_event_record(legacy_event)
    assert upgraded["schema_version"] == CURRENT_SCHEMA_VERSION
    assert upgraded["timestamp"] == "2024-03-09T16:00:00Z"
    assert upgraded["classification"] == "confidential"
    assert upgraded["source"] == "device"
    assert upgraded["payload"] == {"state": "nominal"}
