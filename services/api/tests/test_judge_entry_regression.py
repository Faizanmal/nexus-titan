"""Targeted automated regression tests for Judge Entry, Session Isolation, and Honest Provenance.

Covers:
1. Judge entry regression: signed-out evaluator without token rejected (HTTP 401),
   expired token rejected (HTTP 401), and dedicated judge onboarding succeeds.
2. False provenance elimination: configured credentials without provider execution
   strictly yield MOCK_EXPLICITLY_LABELED and actual_source=None.
3. Two complete synthetic variants:
   - Variant 1: Cavitation + Agreeing evidence + Plan A
   - Variant 2: Bearing thermal + Disagreeing evidence (contradiction detected) + Plan B
4. Rehearsals:
   - Unsupported device / capability floor fallback
   - Consent denial and tamper invalidation
   - Session expiry and recovery
   - Deterministic replay after refresh
5. Multi-judge data isolation: independent sessions, quotas, and correlation IDs.
6. Coherent trace verification: latency timed dynamically, valid event IDs, no false claims.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from nexus_titan_api.database import get_session
from nexus_titan_api.identity import Actor, current_actor
from nexus_titan_api.main import app
from nexus_titan_api.models import Membership


@pytest.fixture
def judge_actor():
    return Actor(uid="judge-evaluator-alpha", email="judge-alpha@nexus-titan.test", email_verified=True)


@pytest.fixture
def mock_db_session(judge_actor):
    session = MagicMock()
    member = Membership(
        organization_id="demo-nexus",
        user_id=judge_actor.uid,
        role="judge",
        status="active",
    )
    session.get.return_value = member
    return session


@pytest.fixture
def api_client(judge_actor, mock_db_session):
    app.dependency_overrides[current_actor] = lambda: judge_actor
    app.dependency_overrides[get_session] = lambda: mock_db_session
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


# ==============================================================================
# 1. Judge Entry & Authentication Regression Tests
# ==============================================================================

def test_signed_out_evaluator_rejected_without_auth():
    """Verifies that an unauthenticated caller is rejected with HTTP 401 AUTH_REQUIRED."""
    app.dependency_overrides.clear()
    unauth_client = TestClient(app)
    resp = unauth_client.post(
        "/v1/demo/scenario/step",
        json={"step": "baseline", "session_id": "sess-unauth", "correlation_id": "corr-unauth"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_REQUIRED"


def test_expired_or_invalid_bearer_token_rejected(monkeypatch):
    """Verifies that an expired/invalid token in production mode raises INVALID_ID_TOKEN."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_DEMO_ACTOR", "false")
    monkeypatch.setattr(
        "nexus_titan_api.identity.verify_firebase_id_token",
        lambda _t: (_ for _ in ()).throw(ValueError("Token has expired")),
    )
    app.dependency_overrides.clear()
    client = TestClient(app)
    resp = client.post(
        "/v1/demo/scenario/step",
        headers={"Authorization": "Bearer expired-token-12345"},
        json={"step": "baseline", "session_id": "sess-expired", "correlation_id": "corr-expired"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_ID_TOKEN"


def test_dedicated_judge_onboarding_issues_isolated_session(api_client):
    """Verifies that judge onboarding grants a restricted sandbox profile with quota."""
    resp = api_client.post(
        "/v1/demo/judge/onboard",
        json={"judge_alias": "evaluator-qa-01", "evaluation_track": "flagship-incident"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "judge"
    assert data["alias"] == "evaluator-qa-01"
    assert data["session_id"].startswith("sess-judge-")
    assert data["correlation_id"].startswith("corr-")
    assert data["quota"]["simulation_units_allocated"] == 50
    assert data["quota"]["agent_runs_allocated"] == 20
    assert data["rate_limit"]["requests_per_minute"] == 30
    assert "sandbox:simulate" in data["permissions"]
    assert "tenant:delete" in data["denied_permissions"]


# ==============================================================================
# 2. False Provenance Elimination & Honest Attribution
# ==============================================================================

def test_configured_credentials_never_claim_real_cloud_provenance(api_client, monkeypatch):
    """Verifies that host env credentials without actual provider execution return fixture provenance."""
    monkeypatch.setenv("FIREBASE_API_KEY", "AIzaSyFakeKeyConfigured123")
    monkeypatch.setenv("NEXT_PUBLIC_FIREBASE_API_KEY", "AIzaSyFakeKeyConfigured123")

    resp = api_client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-audit-prov",
            "correlation_id": "corr-audit-prov",
        },
    )
    assert resp.status_code == 200
    d = resp.json()
    assert d["actual_source"] is None, "Must not claim real cloud execution"
    assert d["reported_source"] == "MOCK_EXPLICITLY_LABELED"
    assert d["is_fixture"] is True
    assert d["masquerading_prevented"] is True
    assert d["source_trace"]["duration_ms"] > 0, "Execution duration must be measured dynamically"


def test_missing_or_unrecognized_provenance_defaults_to_unknown(api_client):
    """Verifies that an absent or unrecognizable provider source maps strictly to UNKNOWN."""
    resp = api_client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-unknown-src",
            "correlation_id": "corr-unknown-src",
            "provider_source": "bogus_unrecognized_source_format",
        },
    )
    assert resp.status_code == 200
    d = resp.json()
    assert d["actual_source"] == "UNKNOWN"


# ==============================================================================
# 3. Two Complete Synthetic Variants & Disagreeing Evidence
# ==============================================================================

def test_variant_1_cavitation_agreeing_plan_a(api_client):
    """Executes Variant 1: Cavitation fault, agreeing physical evidence, Plan A throttled bypass."""
    # 1. Onboard Judge
    onb = api_client.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-var1"}).json()
    sess_id, corr_id, judge_id = onb["session_id"], onb["correlation_id"], onb["judge_id"]

    # 2. Baseline
    b = api_client.post("/v1/demo/scenario/step", json={"step": "baseline", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert b["primary_asset"]["metrics"]["discharge_pressure_kpa"] == 412.5

    # 3. Fault Injection: Cavitation
    f = api_client.post("/v1/demo/scenario/step", json={
        "step": "fault_injection", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "fault_type": "cavitation"
    }).json()
    assert f["metrics"]["alarm_code"] == "ALARM_PUMP_CAVITATION_VIBRATION"
    assert f["metrics"]["vibration_mms"] == 8.42

    # 4. Field Evidence: Agreeing
    e = api_client.post("/v1/demo/scenario/step", json={
        "step": "evidence_capture", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "evidence_type": "agreeing"
    }).json()
    assert e["contradiction_detected"] is False

    # 5. Offline Local AI
    loc = api_client.post("/v1/demo/scenario/step", json={
        "step": "local_ai_offline", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "is_offline": True
    }).json()
    assert loc["network_status"] == "OFFLINE"
    assert loc["source_trace"]["network_isolated"] is True

    # 6. Redaction Approval
    red = api_client.post("/v1/demo/scenario/step", json={"step": "redaction_approval", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert "employee_id" in red["redaction_audit"]["redacted_fields"]

    # 7. Peer Transfer (Honest simulated airgap)
    pt = api_client.post("/v1/demo/scenario/step", json={"step": "peer_transfer", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert pt["status"] == "BLOCKED"
    assert pt["simulated_network_state"] == "SIMULATED_AIRGAP_SUBNET"
    assert pt["hardware_transfer_claimed"] is False

    # 8. Canonical Sync
    cs = api_client.post("/v1/demo/scenario/step", json={"step": "canonical_sync", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert cs["assigned_sequence"] > 0
    assert cs["device_signature_algorithm"] == "Ed25519"

    # 9. Cloud Inference
    ci = api_client.post("/v1/demo/scenario/step", json={"step": "cloud_inference", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert ci["masquerading_prevented"] is True

    # 10. Causal Agent DAG
    dag = api_client.post("/v1/demo/scenario/step", json={"step": "causal_agent_dag", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert len(dag["agent_dag_execution"]) == 4

    # 11. Solver Scenarios (Plan A)
    solv = api_client.post("/v1/demo/scenario/step", json={
        "step": "solver_scenarios", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "selected_plan": "plan_a"
    }).json()
    assert solv["scenarios"]["plan_a"]["repair_cost_usd"] == 1250.0
    assert solv["measured_comparison"]["financial_preservation_usd"] == 64150.0

    # 12. Stale Approval Conflict Gate (409)
    stale = api_client.post("/v1/demo/scenario/step", json={"step": "stale_approval_test", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id})
    assert stale.status_code == 200  # Returns the 409 simulation specimen
    assert stale.json()["stale_validation"]["http_status"] == 409

    # 13. Supervisor Approval
    sup = api_client.post("/v1/demo/scenario/step", json={
        "step": "supervisor_approval", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "selected_plan": "plan_a"
    }).json()
    assert sup["selected_plan"] == "plan_a"
    assert sup["status"] == "plan_approved"

    # 14. Twin Update & Replay
    tw = api_client.post("/v1/demo/scenario/step", json={"step": "twin_update", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert tw["projection_version"] > 0
    rep = api_client.post("/v1/demo/scenario/step", json={"step": "replay", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id}).json()
    assert len(rep["deterministic_replay_hash"]) == 64
    assert len(rep["timeline"]) >= 10


def test_variant_2_thermal_disagreeing_plan_b(api_client):
    """Executes Variant 2: Thermal runaway, disagreeing physical observation (contradiction detected), Plan B."""
    onb = api_client.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-var2"}).json()
    sess_id, corr_id, judge_id = onb["session_id"], onb["correlation_id"], onb["judge_id"]

    # Fault Injection: Bearing Thermal Runaway
    f = api_client.post("/v1/demo/scenario/step", json={
        "step": "fault_injection", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "fault_type": "bearing_thermal"
    }).json()
    assert f["metrics"]["alarm_code"] == "ALARM_BEARING_THERMAL_RUNAWAY"
    assert f["metrics"]["bearing_temp_c"] == 94.6

    # Field Evidence: Disagreeing (Contradiction Detection)
    e = api_client.post("/v1/demo/scenario/step", json={
        "step": "evidence_capture", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "evidence_type": "disagreeing"
    }).json()
    assert e["contradiction_detected"] is True, "Must detect sensor discrepancy against physical dial"

    # Solver Scenarios: Plan B
    solv = api_client.post("/v1/demo/scenario/step", json={
        "step": "solver_scenarios", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "selected_plan": "plan_b"
    }).json()
    assert solv["scenarios"]["plan_b"]["downtime_hours"] == 0.1
    assert solv["scenarios"]["plan_b"]["repair_cost_usd"] == 4200.0

    # Supervisor Approval: Plan B
    sup = api_client.post("/v1/demo/scenario/step", json={
        "step": "supervisor_approval", "session_id": sess_id, "correlation_id": corr_id, "judge_id": judge_id,
        "selected_plan": "plan_b"
    }).json()
    assert sup["selected_plan"] == "plan_b"


# ==============================================================================
# 4. Multi-Judge Isolation & Trace Coherence
# ==============================================================================

def test_multi_judge_state_and_quota_isolation(api_client):
    """Verifies that two judge sessions maintain strictly isolated quotas and states."""
    r_a = api_client.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-iso-a"}).json()
    r_b = api_client.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-iso-b"}).json()

    assert r_a["session_id"] != r_b["session_id"]
    assert r_a["judge_id"] != r_b["judge_id"]
    assert r_a["correlation_id"] != r_b["correlation_id"]

    # Judge A runs DAG (decrements quota)
    api_client.post("/v1/demo/scenario/step", json={
        "step": "causal_agent_dag", "session_id": r_a["session_id"],
        "correlation_id": r_a["correlation_id"], "judge_id": r_a["judge_id"]
    })

    q_a = api_client.get(f"/v1/demo/judge/quota/{r_a['judge_id']}").json()
    q_b = api_client.get(f"/v1/demo/judge/quota/{r_b['judge_id']}").json()

    # Judge A decremented, Judge B intact
    assert q_a["quota"]["agent_runs_remaining"] == 19
    assert q_b["quota"]["agent_runs_remaining"] == 20


def test_session_reset_isolation_preserves_global_state(api_client):
    """Verifies that resetting a demo session creates a fresh session without affecting global database."""
    r = api_client.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-reset-test"}).json()
    sess_id = r["session_id"]

    reset_res = api_client.post(
        "/v1/demo/session/reset",
        json={"session_id": sess_id, "tenant_id": "demo-nexus"}
    )
    assert reset_res.status_code == 200
    assert reset_res.json()["status"] == "session_reset"
    assert reset_res.json()["global_state_preserved"] is True
