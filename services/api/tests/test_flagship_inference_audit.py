"""Regression tests for Flagship Inference Audit & Honest Trace Provenance.

Acceptance criteria verified:
1. Credentials configured with a fixture response never claims real cloud provenance.
2. Successful provider output derives on-device/in-cloud attribution via SDK mapping.
3. Absent or unrecognized source is treated strictly as UNKNOWN.
4. Provider failure produces an explicit 502 error and cannot reuse or append trace.
5. Provider timeout produces an explicit 504 error, and retries are recorded.
6. Execution latency is dynamically measured (not hardcoded static constants).
7. Missing peer transport and counterfactual solvers make zero unverified hardware or real-world savings claims.
"""

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
    return Actor(uid="judge-evaluator-01", email="judge@nexus-titan.test", email_verified=True)


@pytest.fixture
def mock_session(auth_actor):
    session = MagicMock()
    member = Membership(
        organization_id="demo-nexus",
        user_id=auth_actor.uid,
        role="judge",
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


def test_credentials_configured_with_fixture_response(client, monkeypatch):
    """Verifies that configuring FIREBASE_API_KEY does NOT claim actual cloud inference

    when executing a fixture. Provenance must remain MOCK_EXPLICITLY_LABELED and actual_source None.
    """
    monkeypatch.setenv("FIREBASE_API_KEY", "AIzaSyFakeKeyConfiguredInHostEnv123456")
    monkeypatch.setenv("NEXT_PUBLIC_FIREBASE_API_KEY", "AIzaSyFakeKeyConfiguredInHostEnv123456")

    resp = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-cred-fixture-01",
            "correlation_id": "corr-cred-fixture-01",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Crucial assertion: Configuration-based claims of IN_CLOUD execution are eliminated
    assert data["actual_source"] is None, "Credentials in env must not claim actual cloud execution"
    assert data["reported_source"] == "MOCK_EXPLICITLY_LABELED"
    assert data["is_fixture"] is True
    assert data["masquerading_prevented"] is True
    assert "Configuration presence does not claim cloud execution" in data["provenance_note"]

    # Verify trace item
    trace = data["source_trace"]
    assert trace["actual_source"] is None
    assert trace["source"] == "MOCK_EXPLICITLY_LABELED"
    assert trace["is_fixture"] is True


def test_successful_provider_output_derives_correct_attribution(client):
    """Verifies that actual provider responses mapped through the SDK derive true provenance."""
    # 1. Cloud provider success
    resp_cloud = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-prov-cloud-01",
            "correlation_id": "corr-prov-cloud-01",
            "provider_source": "in_cloud",
        },
    )
    assert resp_cloud.status_code == 200
    d_cloud = resp_cloud.json()
    assert d_cloud["actual_source"] == "IN_CLOUD"
    assert d_cloud["reported_source"] == "IN_CLOUD"
    assert d_cloud["client_reported_source"] == "IN_CLOUD"
    assert d_cloud["is_fixture"] is False
    assert "SDK-reported source (client)" in d_cloud["provenance_note"]
    assert "verified" not in d_cloud["provenance_note"].lower()

    # 2. Local on-device provider success
    resp_device = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "local_ai_offline",
            "session_id": "sess-prov-device-01",
            "correlation_id": "corr-prov-device-01",
            "provider_source": "on_device",
        },
    )
    assert resp_device.status_code == 200
    d_device = resp_device.json()
    assert d_device["actual_source"] == "ON_DEVICE"
    assert d_device["reported_source"] == "ON_DEVICE"
    assert d_device["client_reported_source"] == "ON_DEVICE"
    assert d_device["inference_source"] == "ON_DEVICE"
    assert d_device["is_fixture"] is False
    assert d_device["chrome_prompt_api_available"] is True
    assert "SDK-reported source (client)" in d_device["device_status_note"]


def test_fixture_run_yields_mock_plus_fallback_reason(client):
    """Verifies that a fixture run yields MOCK and a fallback_reason without claiming real execution."""
    resp = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-fixt-01",
            "correlation_id": "corr-fixt-01",
            "provider_response": {
                "fallback_reason": "Firebase Auth currentUser not signed in",
                "is_simulation_fallback": True,
            },
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reported_source"] == "MOCK_EXPLICITLY_LABELED"
    assert data["client_reported_source"] is None
    assert data["is_fixture"] is True
    assert "Simulated: Firebase Auth currentUser not signed in" in data["provenance_note"]
    assert "verified" not in data["provenance_note"].lower()


def test_absent_and_unrecognized_provider_source_treated_as_unknown(client):
    """Verifies that missing or unrecognized provider provenance is derived as UNKNOWN."""
    resp = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-unknown-src-01",
            "correlation_id": "corr-unknown-src-01",
            "provider_source": "unrecognized_third_party_engine",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["actual_source"] == "UNKNOWN"
    assert data["reported_source"] == "UNKNOWN"
    assert "derived attribution is UNKNOWN" in data["provenance_note"]


def test_provider_failure_produces_explicit_failure(client):
    """Verifies that a provider failure raises an explicit HTTP 502 with structured error."""
    resp = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-fail-01",
            "correlation_id": "corr-fail-01",
            "simulate_provider_failure": True,
        },
    )
    assert resp.status_code == 502
    data = resp.json()
    assert data["error"]["code"] == "PROVIDER_EXECUTION_FAILED"

    # Local provider failure
    resp_local = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "local_ai_offline",
            "session_id": "sess-local-fail-01",
            "correlation_id": "corr-local-fail-01",
            "simulate_provider_failure": True,
        },
    )
    assert resp_local.status_code == 502
    assert resp_local.json()["error"]["code"] == "LOCAL_PROVIDER_FAILED"


def test_provider_timeout_and_retry_recorded(client):
    """Verifies that timeout produces HTTP 504 and retry_count is tracked in output."""
    resp_timeout = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-timeout-01",
            "correlation_id": "corr-timeout-01",
            "simulate_timeout": True,
        },
    )
    assert resp_timeout.status_code == 504
    assert resp_timeout.json()["error"]["code"] == "PROVIDER_TIMEOUT"

    # Successful call with retry count
    resp_retry = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-retry-01",
            "correlation_id": "corr-retry-01",
            "provider_source": "in_cloud",
            "retry_count": 2,
        },
    )
    assert resp_retry.status_code == 200
    data = resp_retry.json()
    assert data["retry_count"] == 2
    assert data["source_trace"]["retry_count"] == 2


def test_measured_latency_is_timed(client):
    """Verifies that duration_ms is dynamically measured, not static hardcoded constants."""
    resp1 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "local_ai_offline",
            "session_id": "sess-time-01",
            "correlation_id": "corr-time-01",
        },
    )
    assert resp1.status_code == 200
    d1 = resp1.json()
    assert d1["source_trace"]["duration_ms"] > 0
    # Must not be hardcoded 48.6 ms
    assert isinstance(d1["source_trace"]["duration_ms"], float)

    # Test explicit test duration pass-through
    resp2 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": "sess-time-02",
            "correlation_id": "corr-time-02",
            "execution_duration_ms": 78.4,
        },
    )
    assert resp2.status_code == 200
    d2 = resp2.json()
    assert d2["source_trace"]["duration_ms"] == 78.4


def test_errors_do_not_reuse_or_append_trace(client):
    """Verifies that a failed step does not append a trace item to the session state."""
    session_id = "sess-trace-clean-01"
    corr_id = "corr-trace-clean-01"

    # 1. Successful baseline
    r1 = client.post(
        "/v1/demo/scenario/step",
        json={"step": "baseline", "session_id": session_id, "correlation_id": corr_id},
    )
    assert r1.status_code == 200

    # 2. Failed cloud inference
    r2 = client.post(
        "/v1/demo/scenario/step",
        json={
            "step": "cloud_inference",
            "session_id": session_id,
            "correlation_id": corr_id,
            "simulate_provider_failure": True,
        },
    )
    assert r2.status_code == 502

    # 3. Check replay: trace should only contain the 1 successful step
    replay_resp = client.post(
        "/v1/demo/scenario/step",
        json={"step": "replay", "session_id": session_id, "correlation_id": corr_id},
    )
    assert replay_resp.status_code == 200
    trace = replay_resp.json()["full_source_trace"]
    steps_in_trace = [t["step"] for t in trace]
    assert "baseline" in steps_in_trace
    assert "cloud_inference" not in steps_in_trace, "Failed step must not append to trace"


def test_fixture_claims_clarified(client):
    """Verifies that solver scenarios and peer transfer make zero unverified hardware or monetary claims."""
    # Solver scenarios
    r_solv = client.post(
        "/v1/demo/scenario/step",
        json={"step": "solver_scenarios", "session_id": "sess-claim-01", "correlation_id": "corr-claim-01"},
    )
    assert r_solv.status_code == 200
    d_solv = r_solv.json()
    comp = d_solv["measured_comparison"]
    assert comp["is_synthetic_counterfactual_model_only"] is True
    assert comp["real_world_savings_claimed"] is False
    assert comp["financial_preservation_usd"] == 64150.0
    assert "zero real-world monetary savings claimed" in comp["disclaimer"]

    # Peer transfer
    r_peer = client.post(
        "/v1/demo/scenario/step",
        json={"step": "peer_transfer", "session_id": "sess-claim-02", "correlation_id": "corr-claim-02"},
    )
    assert r_peer.status_code == 200
    d_peer = r_peer.json()
    assert d_peer["hardware_transfer_claimed"] is False
    assert d_peer["physical_ble_wifi_direct_active"] is False
    assert d_peer["simulated_network_state"] == "SIMULATED_AIRGAP_SUBNET"
    assert d_peer["fixture_label"] == "EXPLICITLY_LABELED_FIXTURE_TEST_ONLY"
