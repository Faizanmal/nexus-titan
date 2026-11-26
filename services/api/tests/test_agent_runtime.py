import pytest

from nexus_titan_api.agent_runtime import (
    ROLE_BY_NAME,
    ROLES,
    topological_order,
    validate_result,
)


def test_all_thirteen_typed_roles_are_ordered_with_dependencies_first():
    order = topological_order()
    assert len(order) == 13
    positions = {name: index for index, name in enumerate(order)}
    for role in ROLES:
        assert all(positions[dep] < positions[role.name] for dep in role.dependencies)
        assert role.executor in {"deterministic", "client_model"}


def test_cycle_and_unknown_dependency_rejected():
    from dataclasses import replace

    with pytest.raises(ValueError, match="cycle"):
        topological_order(
            (
                replace(ROLES[0], dependencies=(ROLES[1].name,)),
                replace(ROLES[1], dependencies=(ROLES[0].name,)),
            )
        )
    with pytest.raises(ValueError, match="unknown"):
        topological_order((replace(ROLES[0], dependencies=("missing",)),))


def test_role_result_schema_is_closed_and_bounded():
    valid = {key: "ok" for key in ROLE_BY_NAME["supervisor"].output_schema["required"]}
    assert validate_result("supervisor", valid) == valid
    with pytest.raises(ValueError):
        validate_result("supervisor", {**valid, "undeclared": "bad"})
    with pytest.raises(ValueError):
        validate_result("supervisor", {"summary": "x" * 4001})


def test_agent_api_exposes_run_trace_and_typed_role_registry():
    from nexus_titan_api.main import app

    paths = app.openapi()["paths"]
    assert "/v1/agents/runs" in paths
    assert "/v1/agents/runs/{run_id}" in paths
    assert "/v1/agents/roles" in paths


def test_run_payload_rejects_restricted_bytes_and_oversized_input():
    from nexus_titan_api.agent_routes import RunCreate

    common = {
        "tenant_id": "tenant-1",
        "site_id": "site-1",
        "idempotency_key": "idempotency-123",
        "input": {},
    }
    with pytest.raises(ValueError):
        RunCreate(**{**common, "input": {"restricted_bytes": "not allowed"}})
    with pytest.raises(ValueError):
        RunCreate(**{**common, "input": {"observations": "x" * 66000}})
