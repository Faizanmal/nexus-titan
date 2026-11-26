"""Tests for Phase 19: Agent studio DAG, mesh capabilities, governance audit, replay, and observability."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from nexus_titan_api.agent_routes import export_sanitized_trace
from nexus_titan_api.database import get_session
from nexus_titan_api.governance_routes import (
    get_approvals_history,
    get_audit_stream,
    get_denied_access_log,
    list_governance_policies,
)
from nexus_titan_api.identity import Actor, current_actor
from nexus_titan_api.main import app
from nexus_titan_api.mesh_routes import (
    HeartbeatPayload,
    PairRequest,
    create_pairing_challenge,
    get_mesh_status,
    record_device_heartbeat,
)
from nexus_titan_api.models import Device, Membership
from nexus_titan_api.replay_routes import reconstruct_replay_state


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
def authed_client(auth_actor, mock_session):
    app.dependency_overrides[current_actor] = lambda: auth_actor
    app.dependency_overrides[get_session] = lambda: mock_session
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_agent_api_openapi_has_phase_19_routes():
    paths = app.openapi()["paths"]
    # Agent studio
    assert "/v1/agents/runs" in paths
    assert "/v1/agents/runs/{run_id}" in paths
    assert "/v1/agents/runs/{run_id}/{action}" in paths
    assert "/v1/agents/runs/{run_id}/export" in paths
    # Mesh
    assert "/v1/organizations/{organization_id}/mesh/status" in paths
    assert "/v1/organizations/{organization_id}/mesh/devices/pair" in paths
    assert (
        "/v1/organizations/{organization_id}/mesh/devices/{device_id}/heartbeat"
        in paths
    )
    # Governance
    assert "/v1/organizations/{organization_id}/governance/policies" in paths
    assert "/v1/organizations/{organization_id}/governance/audit" in paths
    assert "/v1/organizations/{organization_id}/governance/approvals" in paths
    assert "/v1/organizations/{organization_id}/governance/denials" in paths
    # Replay
    assert "/v1/world/replay" in paths
    # Observability
    assert "/v1/observability/metrics" in paths
    assert "/v1/observability/readiness" in paths


def test_observability_metrics_privacy_and_source_isolation(authed_client: TestClient):
    resp = authed_client.get("/v1/observability/metrics")
    assert resp.status_code == 200
    data = resp.json()

    # Latencies and durations
    assert "p50_ms" in data["api_latencies"]
    assert "supervisor" in data["agent_durations_ms"]
    assert "causal" in data["agent_durations_ms"]

    # Solver metrics
    assert data["solver_convergence"]["converged_rate_percent"] == 100.0

    # Source isolation gate: mock executions must be counted separately and not as real
    counts = data["source_counts"]
    assert "mock" in counts
    assert "local" in counts
    assert "cloud" in counts
    assert counts["mock"] > 0
    # Verification that note clarifies mock isolation
    assert "Mock executions are strictly isolated" in counts["note"]

    # Privacy guarantee: OTel export sanitization
    assert data["otel_trace_export"]["privacy_sanitization"] == "enforced"


def test_observability_readiness_diagnostics(authed_client: TestClient):
    resp = authed_client.get("/v1/observability/readiness")
    assert resp.status_code == 200
    data = resp.json()

    assert data["status"] == "ready"
    assert data["device_checks"]["chrome_prompt_api_compatible"] is True
    assert data["device_checks"]["webrtc_datachannel_supported"] is True

    # Quota diagnostics
    assert data["quota_diagnostics"]["quota_error_rate_percent"] == 0.0

    # Strict privacy assertions
    assert data["privacy_guarantees"]["raw_user_prompts_logged"] is False
    assert data["privacy_guarantees"]["local_traces_cloud_withheld"] is True
    assert data["privacy_guarantees"]["restricted_bytes_redacted"] is True


def test_governance_policies_and_tamper_evident_audit(auth_actor, mock_session):
    # Policies
    policies_data = list_governance_policies(
        "demo-nexus", actor=auth_actor, session=mock_session
    )
    assert len(policies_data["policies"]) >= 4
    versions = {p["id"]: p["version"] for p in policies_data["policies"]}
    assert "POL-DATA-CLASS-01" in versions
    assert "POL-INFER-PLACE-02" in versions

    # Tamper-evident audit stream
    audit_data = get_audit_stream("demo-nexus", actor=auth_actor, session=mock_session)
    assert audit_data["is_tamper_evident"] is True
    assert len(audit_data["events"]) >= 5
    assert len(audit_data["chain_head_sha256"]) == 64
    for ev in audit_data["events"]:
        assert len(ev["event_sha256"]) == 64

    # Approvals history
    approvals_data = get_approvals_history(
        "demo-nexus", actor=auth_actor, session=mock_session
    )
    assert "approvals" in approvals_data
    assert len(approvals_data["approvals"]) >= 2
    for approval in approvals_data["approvals"]:
        assert approval["aggregate_id"]

    # Denied access log
    denials_data = get_denied_access_log(
        "demo-nexus", actor=auth_actor, session=mock_session
    )
    assert len(denials_data["denials"]) >= 4
    reason_codes = {d["reason_code"] for d in denials_data["denials"]}
    assert "ROLE_FORBIDDEN" in reason_codes
    assert "SELF_APPROVAL_PROHIBITED" in reason_codes
    assert "DEVICE_PROOF_INVALID" in reason_codes


def test_mesh_capabilities_pairing_and_heartbeat(auth_actor, mock_session):
    dev_id = uuid4()
    mock_dev = Device(
        id=dev_id,
        organization_id="demo-nexus",
        user_id=auth_actor.uid,
        client_device_id="client-desktop-p2000",
        label="Operator Workstation Quadro P2000",
        public_key_pem="-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----",
        status="registered",
    )
    member = Membership(
        organization_id="demo-nexus",
        user_id=auth_actor.uid,
        role="owner",
        status="active",
    )

    def mock_get(model, ident):
        if model is Membership:
            return member
        elif model is Device:
            return mock_dev
        return None

    mock_session.get.side_effect = mock_get
    mock_session.scalars.return_value.all.return_value = [mock_dev]

    # Mesh status
    status_data = get_mesh_status("demo-nexus", actor=auth_actor, session=mock_session)
    assert status_data["organization_id"] == "demo-nexus"
    assert len(status_data["devices"]) == 1
    dev_entry = status_data["devices"][0]
    assert dev_entry["capabilities"]["webrtc_datachannel"] is True
    assert dev_entry["capabilities"]["prompt_api"] is True
    assert (
        "Direct peer-to-peer DataChannel functions without cloud connectivity"
        in status_data["offline_caveat"]
    )

    # Pairing challenge
    pair_resp = create_pairing_challenge(
        "demo-nexus",
        PairRequest(
            label="Mobile Inspection Tablet",
            public_key_pem="-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----",
        ),
        actor=auth_actor,
        session=mock_session,
    )
    assert pair_resp["pairing_code"].startswith("TITAN-PAIR-")
    assert len(pair_resp["nonce"]) == 32

    # Heartbeat
    hb_resp = record_device_heartbeat(
        "demo-nexus",
        dev_id,
        HeartbeatPayload(
            client_device_id="client-desktop-p2000",
            transport="webrtc_datachannel",
            latency_ms=18.4,
        ),
        actor=auth_actor,
        session=mock_session,
    )
    assert hb_resp["status"] == "acknowledged"


def test_replay_state_reconstruction_and_stable_checksum(auth_actor, mock_session):
    # Sequence 0 (empty world)
    rep_0 = reconstruct_replay_state(
        tenant_id="demo-nexus",
        site_id="TITAN-WTP-01",
        sequence=0,
        actor=auth_actor,
        session=mock_session,
    )
    assert rep_0["sequence"] == 0
    assert rep_0["asset_count"] == 0
    assert rep_0["checksum_match"] is True

    # Sequence 50
    rep_50 = reconstruct_replay_state(
        tenant_id="demo-nexus",
        site_id="TITAN-WTP-01",
        sequence=50,
        actor=auth_actor,
        session=mock_session,
    )
    assert rep_50["sequence"] == 50
    assert rep_50["asset_count"] > 0
    assert len(rep_50["replayed_sha256"]) == 64
    assert rep_50["checksum_match"] is True
    assert rep_50["telemetry_at_sequence"]["pressure_kpa"] > 0

    # Sequence 120 (full head state)
    rep_120 = reconstruct_replay_state(
        tenant_id="demo-nexus",
        site_id="TITAN-WTP-01",
        sequence=120,
        actor=auth_actor,
        session=mock_session,
    )
    assert rep_120["sequence"] == 120
    assert rep_120["asset_count"] == 120
    assert rep_120["checksum_match"] is True
    assert rep_120["divergence"] == []


def test_agent_run_export_strictly_withholds_restricted_data(auth_actor, mock_session):
    run_id = uuid4()
    # Mock row mapping
    row = {
        "id": run_id,
        "tenant_id": "demo-nexus",
        "site_id": "TITAN-WTP-01",
        "state": "running",
        "input": {"source": "unit_test"},
        "created_at": "2026-11-18T12:00:00Z",
        "deadline_at": "2026-11-18T13:00:00Z",
    }
    mock_session.execute.return_value.mappings.return_value.first.return_value = row
    mock_session.execute.return_value.mappings.return_value.all.return_value = [
        {
            "role_name": "supervisor",
            "executor": "deterministic",
            "state": "completed",
            "result": {
                "summary": "valid input",
                "restricted_secret": "TOP_SECRET_BYTES",
            },
            "evidence_refs": [],
            "updated_at": "2026-11-18T12:01:00Z",
        }
    ]

    exported = export_sanitized_trace(run_id, actor=auth_actor, session=mock_session)
    assert exported["run_id"] == str(run_id)
    assert exported["restricted_records_withheld"] is True
    assert exported["sanitization"] == "enforced_no_restricted_bytes"

    # Verify restricted fields were stripped
    role = exported["roles"][0]
    assert role["role_name"] == "supervisor"
    assert "summary" in role["output_refs"]
    assert "restricted_secret" not in role["output_refs"]
