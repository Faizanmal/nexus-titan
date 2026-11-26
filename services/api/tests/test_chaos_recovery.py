"""Tests for Phase 24: Distributed failure, chaos injection, and disaster recovery."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from nexus_titan_api.database import get_session
from nexus_titan_api.identity import Actor, current_actor
from nexus_titan_api.main import app
from nexus_titan_api.models import Membership


@pytest.fixture
def auth_actor():
    return Actor(uid="owner-01", email="owner@nexus-titan.test", email_verified=True)


@pytest.fixture
def mock_session(auth_actor):
    session = MagicMock()
    member = Membership(
        organization_id="demo-nexus",
        user_id=auth_actor.uid,
        role="owner",
        status="active",
    )
    session.get.return_value = member
    return session


@pytest.fixture
def client(auth_actor, mock_session):
    app.dependency_overrides[current_actor] = lambda: auth_actor
    app.dependency_overrides[get_session] = lambda: mock_session
    c = TestClient(app)
    yield c
    app.dependency_overrides.clear()


def test_recovery_status_endpoint(client):
    resp = client.get("/v1/recovery/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "operational"
    assert "queues" in data
    assert "dependency_matrix" in data
    assert len(data["invariants_verified"]) == 7
    assert "no_duplicate_interventions" in data["invariants_verified"]
    assert "restricted_data_never_transferred" in data["invariants_verified"]


def test_dlq_inspection_retry_and_quarantine(client):
    # 1. Inspect DLQ
    dlq_resp = client.get("/v1/recovery/dlq")
    assert dlq_resp.status_code == 200
    dlq_items = dlq_resp.json()["dlq_items"]
    assert len(dlq_items) >= 1
    event_id = dlq_items[0]["event_id"]

    # 2. Retry DLQ event
    retry_resp = client.post(
        f"/v1/recovery/dlq/{event_id}/retry",
        json={"event_id": event_id, "tenant_id": "demo-nexus"},
    )
    assert retry_resp.status_code == 200
    retry_data = retry_resp.json()
    assert retry_data["status"] == "requeued"
    assert retry_data["attempts"] == 0

    # 3. Quarantine poison event
    quarantine_resp = client.post(
        f"/v1/recovery/dlq/{event_id}/quarantine",
        json={
            "event_id": event_id,
            "tenant_id": "demo-nexus",
            "reason": "Poison payload corrupted CRC32",
        },
    )
    assert quarantine_resp.status_code == 200
    q_data = quarantine_resp.json()
    assert q_data["status"] == "quarantined"


def test_task_requeue_and_bounded_retry(client):
    task_id = "task-recon-4401"
    # Requeue attempts 1 through 4 should succeed
    for i in range(2, 6):
        resp = client.post(
            f"/v1/recovery/tasks/{task_id}/requeue",
            json={"task_id": task_id, "tenant_id": "demo-nexus"},
        )
        assert resp.status_code == 200
        assert resp.json()["attempts"] == i

    # Attempt 6 exceeds max limit of 5 -> 409 conflict
    fail_resp = client.post(
        f"/v1/recovery/tasks/{task_id}/requeue",
        json={"task_id": task_id, "tenant_id": "demo-nexus"},
    )
    assert fail_resp.status_code == 409
    assert fail_resp.json()["error"]["code"] == "TASK_MAX_ATTEMPTS_EXCEEDED"


def test_projection_replay_convergence(client):
    resp = client.post(
        "/v1/recovery/projections/replay",
        json={"tenant_id": "demo-nexus", "site_id": "TITAN-WTP-01"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "convergence_verified"
    assert data["eventual_projection_convergence"] is True
    assert len(data["reconstructed_sha256"]) == 64
    assert data["duration_ms"] > 0


def test_device_key_rotation(client):
    resp = client.post(
        "/v1/recovery/devices/dev-tablet-01/rotate",
        json={
            "device_id": "dev-tablet-01",
            "tenant_id": "demo-nexus",
            "new_public_key_pem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA9Y4aB...fakeEd25519...\n-----END PUBLIC KEY-----",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "identity_rotated"
    assert data["revocation_grace_seconds"] == 300


def test_backup_restore_scratch(client):
    resp = client.post(
        "/v1/recovery/scratch/restore-backup",
        json={
            "snapshot_id": "snap-20261118-040000",
            "scratch_environment_id": "env-scratch-e2e",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "backup_restored"
    assert data["integrity_verified"] is True
    assert data["restoration_duration_ms"] > 0


def test_all_16_chaos_vectors(client):
    vectors = [
        "dropped_wan",
        "peer_disconnect",
        "expired_lease",
        "duplicate_event",
        "out_of_order_event",
        "worker_crash_mid_activity",
        "outbox_publish_crash",
        "nats_unavailable",
        "postgres_restart",
        "firestore_stale",
        "model_quota_error",
        "schema_malformed",
        "stale_policy",
        "clock_skew",
        "browser_refresh",
        "storage_failure",
    ]

    for vec in vectors:
        resp = client.post(
            "/v1/recovery/chaos/simulate",
            json={"vector": vec, "tenant_id": "demo-nexus", "site_id": "TITAN-WTP-01"},
        )
        assert resp.status_code == 200, f"Vector {vec} failed: {resp.text}"
        data = resp.json()
        assert data["vector"] == vec
        assert data["invariants_maintained"] is True
        assert data["recovery_duration_ms"] > 0
        assert "invariant_checked" in data
