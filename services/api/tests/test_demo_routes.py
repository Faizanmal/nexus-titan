from __future__ import annotations

import pytest

from nexus_titan_api.demo_routes import validate_demo_reset
from nexus_titan_api.errors import APIError
from nexus_titan_api.main import app


def valid(**updates):
    values = {
        "role": "owner",
        "tenant_id": "demo-nexus",
        "confirmation": "RESET demo-nexus",
        "app_env": "local",
        "database_url": "postgresql://localhost/nexus",
    }
    values.update(updates)
    return validate_demo_reset(**values)


def test_demo_reset_requires_owner_exact_phrase_local_environment_and_local_database():
    assert valid() is None
    for override, code in [
        ({"role": "admin"}, "ROLE_FORBIDDEN"),
        ({"tenant_id": "another-tenant"}, "DEMO_RESET_CONFIRMATION_REQUIRED"),
        ({"confirmation": "demo-nexus"}, "DEMO_RESET_CONFIRMATION_REQUIRED"),
        ({"app_env": "production"}, "DEMO_RESET_LOCAL_ONLY"),
        (
            {"database_url": "postgresql://db.example.com/nexus"},
            "DEMO_RESET_REMOTE_DATABASE",
        ),
    ]:
        with pytest.raises(APIError) as error:
            valid(**override)
        assert error.value.code == code


def test_demo_reset_runtime_openapi_operation_is_registered():
    operation = app.openapi()["paths"]["/v1/demo/reset"]["post"]
    assert operation["requestBody"]["required"] is True


def test_allow_demo_actor_flag_in_production(monkeypatch):
    from nexus_titan_api.identity import current_actor
    from nexus_titan_api.errors import APIError

    # In production without allow flag -> fails
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_DEMO_ACTOR", "false")
    monkeypatch.setattr(
        "nexus_titan_api.identity.verify_firebase_id_token",
        lambda _t: (_ for _ in ()).throw(ValueError("Invalid token")),
    )
    with pytest.raises(APIError) as exc:
        current_actor(authorization="Bearer demo-actor-token")
    assert exc.value.code == "INVALID_ID_TOKEN"

    # In production with ALLOW_DEMO_ACTOR=true -> succeeds
    monkeypatch.setenv("ALLOW_DEMO_ACTOR", "true")
    monkeypatch.setenv("ALLOW_APPCHECK_BYPASS", "false")
    # bypass App Check or provide dummy claims
    monkeypatch.setattr(
        "nexus_titan_api.identity.app_check_bypassed", lambda: True
    )
    actor = current_actor(authorization="Bearer demo-actor-token")
    assert actor.uid == "6kuTpl7BOrYA5OWUOKAm4akZCMJ3"
    assert actor.email == "operator@nexus-titan.test"


def test_independent_judge_sessions_and_state():
    from fastapi.testclient import TestClient
    from nexus_titan_api.identity import Actor, current_actor

    actor = Actor(uid="judge-eval-test", email="judge@nexus-titan.test", email_verified=True)
    app.dependency_overrides[current_actor] = lambda: actor
    c = TestClient(app)

    # Onboard Judge Alpha
    r1 = c.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-alpha", "evaluation_track": "flagship-incident"})
    assert r1.status_code == 200
    j1 = r1.json()

    # Onboard Judge Beta
    r2 = c.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-beta", "evaluation_track": "flagship-incident"})
    assert r2.status_code == 200
    j2 = r2.json()

    assert j1["judge_id"] != j2["judge_id"]
    assert j1["session_id"] != j2["session_id"]
    assert j1["correlation_id"] != j2["correlation_id"]

    # Run steps independently
    s1_res = c.post("/v1/demo/scenario/step", json={"step": "baseline", "session_id": j1["session_id"], "correlation_id": j1["correlation_id"], "judge_id": j1["judge_id"]})
    assert s1_res.status_code == 200
    s1_fault = c.post("/v1/demo/scenario/step", json={"step": "fault_injection", "session_id": j1["session_id"], "correlation_id": j1["correlation_id"], "judge_id": j1["judge_id"]})
    assert s1_fault.status_code == 200

    s2_res = c.post("/v1/demo/scenario/step", json={"step": "baseline", "session_id": j2["session_id"], "correlation_id": j2["correlation_id"], "judge_id": j2["judge_id"]})
    assert s2_res.status_code == 200
    assert s2_res.json()["step"] == "baseline"

    app.dependency_overrides.clear()


def test_judge_quota_decrement_and_exhaustion():
    from fastapi.testclient import TestClient
    from nexus_titan_api.identity import Actor, current_actor
    from nexus_titan_api.demo_routes import _JUDGE_QUOTAS

    actor = Actor(uid="judge-quota-eval", email="quota@nexus-titan.test", email_verified=True)
    app.dependency_overrides[current_actor] = lambda: actor
    c = TestClient(app)

    r = c.post("/v1/demo/judge/onboard", json={"judge_alias": "judge-quota-user", "evaluation_track": "flagship-incident"})
    assert r.status_code == 200
    judge_data = r.json()
    judge_id = judge_data["judge_id"]
    session_id = judge_data["session_id"]
    corr_id = judge_data["correlation_id"]

    # 1. Causal Agent DAG decrements agent_runs_remaining
    dag_res = c.post("/v1/demo/scenario/step", json={"step": "causal_agent_dag", "session_id": session_id, "correlation_id": corr_id, "judge_id": judge_id})
    assert dag_res.status_code == 200
    quota_res = c.get(f"/v1/demo/judge/quota/{judge_id}")
    assert quota_res.json()["quota"]["agent_runs_remaining"] == 19

    # 2. Solver Scenarios decrements simulation_units_remaining
    solver_res = c.post("/v1/demo/scenario/step", json={"step": "solver_scenarios", "session_id": session_id, "correlation_id": corr_id, "judge_id": judge_id})
    assert solver_res.status_code == 200
    quota_res = c.get(f"/v1/demo/judge/quota/{judge_id}")
    assert quota_res.json()["quota"]["simulation_units_remaining"] == 49

    # 3. Quota Exhaustion
    _JUDGE_QUOTAS[judge_id]["quota"]["simulation_units_remaining"] = 0
    exhaust_res = c.post("/v1/demo/scenario/step", json={"step": "solver_scenarios", "session_id": session_id, "correlation_id": corr_id, "judge_id": judge_id})
    assert exhaust_res.status_code == 429
    assert exhaust_res.json()["error"]["code"] == "JUDGE_QUOTA_EXHAUSTED"

    app.dependency_overrides.clear()


