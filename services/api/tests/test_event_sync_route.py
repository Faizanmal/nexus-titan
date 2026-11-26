from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from uuid import UUID

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from nexus_titan_api.database import get_session
from nexus_titan_api.event_store import canonical_json
from nexus_titan_api.identity import Actor, current_actor
from nexus_titan_api.main import app
from nexus_titan_api.models import Device, Membership

ROOT = Path(__file__).resolve().parents[3]
SYNC_FIXTURE = ROOT / "tests/fixtures/contracts/v1.1.0/sync-event-batch.json"
DEVICE_ID = UUID("00000000-0000-4000-8000-000000000002")


class FakeRows:
    def all(self):
        return ["site-demo"]


class FakeSession:
    def __init__(self, public_key_pem: str):
        self.public_key_pem = public_key_pem

    def get(self, model, key):
        if model is Membership and key == ("tenant-demo", "sync-user"):
            return Membership(
                organization_id="tenant-demo",
                user_id="sync-user",
                role="owner",
                status="active",
            )
        return None

    def scalar(self, query, *_args):
        if getattr(query, "column_descriptions", None):
            return Device(
                id=DEVICE_ID,
                organization_id="tenant-demo",
                user_id="sync-user",
                client_device_id="browser-device-1",
                label="test",
                public_key_pem=self.public_key_pem,
                status="registered",
            )
        return 0

    def scalars(self, _query):
        return FakeRows()


def test_signed_event_sync_returns_partial_per_event_results(monkeypatch, caplog):
    caplog.set_level("INFO", logger="nexus_titan_api.events")
    key = ec.generate_private_key(ec.SECP256R1())
    public_key_pem = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode("ascii")
    )
    session = FakeSession(public_key_pem)
    app.dependency_overrides[current_actor] = lambda: Actor(
        "sync-user", "sync@example.test", True
    )
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.enforce_rate_limit",
        lambda *_args, **_kwargs: None,
    )
    outcomes = iter(
        [
            {
                "event_id": "22222222-2222-4222-8222-222222222222",
                "status": "accepted",
                "sequence": 2,
                "revision": 1,
            },
            {
                "event_id": "33333333-3333-4333-8333-333333333333",
                "status": "conflict",
                "code": "REVISION_CONFLICT",
                "expected_revision": 1,
            },
        ]
    )
    monkeypatch.setattr(
        "nexus_titan_api.event_routes.append_event",
        lambda *_args, **_kwargs: next(outcomes),
    )

    payload = json.loads(SYNC_FIXTURE.read_text(encoding="utf-8"))
    second = copy.deepcopy(payload["events"][0])
    second.update({"event_id": "33333333-3333-4333-8333-333333333333", "sequence": 3})
    denied = copy.deepcopy(payload["events"][0])
    denied.update(
        {
            "event_id": "44444444-4444-4444-8444-444444444444",
            "sequence": 4,
            "classification": "restricted",
            "payload": {"evidence": "RESTRICTED_MARKER_DO_NOT_SEND"},
        }
    )
    payload["events"].extend([second, denied])
    body = canonical_json(payload)
    signature = key.sign(body.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    try:
        response = TestClient(app).post(
            "/sync/events",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Nexus-Device-Signature": base64.b64encode(signature).decode("ascii"),
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    results = response.json()["results"]
    assert [result["status"] for result in results] == [
        "accepted",
        "conflict",
        "denied",
    ]
    assert results[2]["code"] == "CLASSIFICATION_FORBIDDEN"
    assert "privacy_policy_denied" in caplog.text
    assert "RESTRICTED_MARKER_DO_NOT_SEND" not in caplog.text
