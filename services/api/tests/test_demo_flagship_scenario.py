"""Comprehensive automated tests for Phase 23: Flagship End-to-End Incident Scenario."""

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


def test_judge_onboarding_and_quota(client):
    resp = client.post(
        "/v1/demo/judge/onboard",
        json={
            "judge_alias": "contest-judge-01",
            "evaluation_track": "flagship-incident",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["role"] == "judge"
    assert data["alias"] == "contest-judge-01"
    assert "sandbox:simulate" in data["permissions"]
    assert "production:write" in data["denied_permissions"]
    assert data["rate_limit"]["requests_per_minute"] == 30
    assert data["quota"]["simulation_units_allocated"] == 50

    judge_id = data["judge_id"]
    quota_resp = client.get(f"/v1/demo/judge/quota/{judge_id}")
    assert quota_resp.status_code == 200
    assert quota_resp.json()["judge_id"] == judge_id


def test_flagship_scenario_full_lifecycle(client):
    session_id = "test-flagship-session-001"
    correlation_id = "corr-flagship-test-001"

    # 1. Baseline
    r1 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "baseline",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["status"] == "nominal"
    assert d1["primary_asset"]["asset_id"] == "P-101"
    assert d1["correlation_id"] == correlation_id

    # 2. Fault Injection (default cavitation)
    r2 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "fault_injection",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "fault_type": "cavitation",
        },
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["status"] == "fault_detected"
    assert d2["metrics"]["vibration_mms"] > 8.0
    assert d2["twin_status"] == "alarm"

    # 3. Evidence Capture (agreeing)
    r3 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "evidence_capture",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "evidence_type": "agreeing",
        },
    )
    assert r3.status_code == 200
    d3 = r3.json()
    assert d3["status"] == "evidence_captured"
    assert d3["contradiction_detected"] is False
    assert d3["privacy_classification"] == "restricted"
    assert d3["restricted_payload_retained"]["transmitted_to_cloud"] is False

    # 4. Local AI Offline
    r4 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "local_ai_offline",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "is_offline": True,
        },
    )
    assert r4.status_code == 200
    d4 = r4.json()
    assert d4["network_status"] == "OFFLINE"
    assert d4["privacy_boundary"]["zero_restricted_bytes_egressed"] is True
    assert "DEVICE_HARDWARE_LIMITATION" in d4["device_status_note"]

    # 5. Redaction Approval
    r5 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "redaction_approval",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r5.status_code == 200
    d5 = r5.json()
    assert d5["status"] == "redaction_approved"
    assert d5["redaction_audit"]["leakage_check_passed"] is True
    assert "employee_id" in d5["redaction_audit"]["redacted_fields"]

    # 6. Peer Transfer (Honest missing hardware segment)
    r6 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "peer_transfer",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r6.status_code == 200
    d6 = r6.json()
    assert d6["status"] == "BLOCKED"
    assert d6["reason"] == "NO_PEER_AVAILABLE"
    assert d6["fixture_label"] == "EXPLICITLY_LABELED_FIXTURE_TEST_ONLY"

    # 7. Canonical Sync
    r7 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "canonical_sync",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r7.status_code == 200
    d7 = r7.json()
    assert d7["status"] == "accepted"
    assert d7["deduplication_proof"]["zero_duplicate_mutations"] is True

    # 8. Cloud Inference (Honest attribution)
    r8 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r8.status_code == 200
    d8 = r8.json()
    assert d8["status"] == "cloud_inference_complete"
    assert d8["masquerading_prevented"] is True
    assert d8["zero_restricted_tokens"] is True

    # 9. Causal Agent DAG
    r9 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "causal_agent_dag",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r9.status_code == 200
    d9 = r9.json()
    assert len(d9["causal_graph"]["nodes"]) >= 4
    assert len(d9["agent_dag_execution"]) == 4

    # 10. Solver Scenarios (Baseline, Counterfactual, and Wrong-Plan)
    r10 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "solver_scenarios",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r10.status_code == 200
    d10 = r10.json()
    assert "plan_a" in d10["scenarios"]
    assert "plan_b" in d10["scenarios"]
    assert "wrong_plan_no_action" in d10["scenarios"]
    wrong = d10["scenarios"]["wrong_plan_no_action"]
    assert wrong["repair_cost_usd"] == 65400.0
    assert wrong["downtime_hours"] == 240.0
    assert d10["measured_comparison"]["measured_on_actual_calls_only"] is True

    # 11. Stale Approval Conflict Test
    r11 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "stale_approval_test",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r11.status_code == 200
    d11 = r11.json()
    assert d11["status"] == "CONFLICT_PREVENTED"
    assert d11["stale_validation"]["http_status"] == 409
    assert d11["stale_validation"]["error_code"] == "SIMULATION_SNAPSHOT_STALE"

    # 12. Supervisor Approval
    r12 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "supervisor_approval",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "selected_plan": "plan_a",
        },
    )
    assert r12.status_code == 200
    d12 = r12.json()
    assert d12["status"] == "plan_approved"
    assert d12["no_actuator_path"] is True

    # 13. Digital Twin Update
    r13 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "twin_update",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r13.status_code == 200
    d13 = r13.json()
    assert d13["status"] == "twin_reconciled"
    assert any(m["status"] == "mitigated_throttled" for m in d13["twin_modifications"])

    # 14. Replay
    r14 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "replay",
            "session_id": session_id,
            "correlation_id": correlation_id,
        },
    )
    assert r14.status_code == 200
    d14 = r14.json()
    assert d14["status"] == "replay_verified"
    assert len(d14["timeline"]) >= 10
    assert len(d14["deterministic_replay_hash"]) == 64


def test_alternate_injected_faults(client):
    sess = "test-faults-session"
    r_thermal = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "fault_injection",
            "session_id": sess,
            "fault_type": "bearing_thermal",
        },
    )
    assert r_thermal.status_code == 200
    d_thermal = r_thermal.json()
    assert d_thermal["metrics"]["bearing_temp_c"] > 90.0
    assert d_thermal["metrics"]["alarm_code"] == "ALARM_BEARING_THERMAL_RUNAWAY"

    r_seal = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "fault_injection",
            "session_id": sess,
            "fault_type": "seal_breach",
        },
    )
    assert r_seal.status_code == 200
    d_seal = r_seal.json()
    assert d_seal["metrics"]["seal_leak_flow_lpm"] > 4.0
    assert d_seal["metrics"]["alarm_code"] == "ALARM_DISCHARGE_SEAL_BREACH"


def test_disagreeing_evidence(client):
    sess = "test-disagreeing-session"
    r = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "evidence_capture",
            "session_id": sess,
            "evidence_type": "disagreeing",
        },
    )
    assert r.status_code == 200
    d = r.json()
    assert d["contradiction_detected"] is True
    assert "discrepancy" in d["observation_text"].lower()


def test_session_reset_isolation(client):
    sess = "test-isolate-reset-session"
    client.post(
        "/v1/demo/scenario/step",
        json={"step": "baseline", "session_id": sess},
    )
    reset_resp = client.post(
        "/v1/demo/session/reset",
        json={"session_id": sess, "tenant_id": "demo-nexus"},
    )
    assert reset_resp.status_code == 200
    data = reset_resp.json()
    assert data["status"] == "session_reset"
    assert data["global_state_preserved"] is True
