"""Typed, bounded agent DAG metadata and deterministic validation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Role:
    name: str
    dependencies: tuple[str, ...]
    executor: str
    tools: tuple[str, ...]
    output_schema: dict[str, Any]
    max_attempts: int = 2
    timeout_seconds: int = 90
    human_review: bool = False


def _schema(required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {key: {"type": "string", "maxLength": 4000} for key in required},
        "required": required,
        "additionalProperties": False,
    }


ROLES: tuple[Role, ...] = (
    Role("supervisor", (), "deterministic", ("validate_input",), _schema(["summary"])),
    Role(
        "vision",
        ("supervisor",),
        "client_model",
        ("inspect_image",),
        _schema(["observations", "evidence_refs"]),
    ),
    Role(
        "sensor",
        ("supervisor",),
        "deterministic",
        ("read_fixture_sensors",),
        _schema(["observations", "evidence_refs"]),
    ),
    Role(
        "spatial",
        ("vision", "sensor"),
        "deterministic",
        ("resolve_asset_geometry",),
        _schema(["locations", "evidence_refs"]),
    ),
    Role(
        "knowledge",
        ("supervisor", "sensor"),
        "deterministic",
        ("search_knowledge", "read_verified_memory"),
        _schema(["sources", "limitations"]),
    ),
    Role(
        "privacy",
        ("vision", "sensor", "knowledge"),
        "deterministic",
        ("classify_output",),
        _schema(["classification", "decision"]),
    ),
    Role(
        "causal",
        ("vision", "sensor", "spatial", "knowledge"),
        "client_model",
        ("compare_hypotheses",),
        _schema(["hypotheses", "evidence_refs"]),
    ),
    Role(
        "simulation",
        ("spatial", "sensor"),
        "deterministic",
        ("evaluate_fixture_rules",),
        _schema(["scenarios", "limitations"]),
    ),
    Role(
        "planning",
        ("causal", "simulation", "privacy"),
        "deterministic",
        ("rank_safe_actions",),
        _schema(["actions", "limitations"]),
        human_review=True,
    ),
    Role(
        "critic",
        ("planning", "causal"),
        "client_model",
        ("review_consistency",),
        _schema(["issues", "followup_questions"]),
    ),
    Role(
        "memory",
        ("knowledge", "spatial", "causal", "planning"),
        "deterministic",
        ("read_verified_memory",),
        _schema(["references", "limitations"]),
    ),
    Role(
        "recovery",
        ("vision", "sensor", "causal", "critic"),
        "deterministic",
        ("identify_missing_evidence",),
        _schema(["gaps", "followup_questions"]),
    ),
    Role(
        "verification",
        ("critic", "privacy", "memory", "recovery"),
        "deterministic",
        ("verify_result_bundle",),
        _schema(["verified", "reasons"]),
        human_review=True,
    ),
)
ROLE_BY_NAME = {role.name: role for role in ROLES}
BOUNDS = {
    "max_steps": 40,
    "max_depth": 8,
    "max_cost_microusd": 500_000,
    "max_concurrency": 4,
    "deadline_seconds": 1800,
}


def topological_order(roles: tuple[Role, ...] = ROLES) -> tuple[str, ...]:
    by_name = {r.name: r for r in roles}
    if len(by_name) != len(roles):
        raise ValueError("duplicate role")
    for role in roles:
        if any(dep not in by_name for dep in role.dependencies):
            raise ValueError(f"unknown dependency for {role.name}")
    pending = {r.name: set(r.dependencies) for r in roles}
    ordered: list[str] = []
    while pending:
        ready = sorted(name for name, deps in pending.items() if not deps)
        if not ready:
            raise ValueError("agent DAG contains a cycle")
        for name in ready:
            ordered.append(name)
            del pending[name]
        for deps in pending.values():
            deps.difference_update(ready)
    if len(ordered) > BOUNDS["max_steps"]:
        raise ValueError("agent DAG exceeds step limit")
    return tuple(ordered)


def validate_result(role_name: str, result: object) -> dict[str, Any]:
    role = ROLE_BY_NAME[role_name]
    if not isinstance(result, dict) or set(result) != set(
        role.output_schema["required"]
    ):
        raise ValueError("role result does not match declared output fields")
    for key, value in result.items():
        if not isinstance(value, str) or len(value) > 4000:
            raise ValueError(f"invalid result field: {key}")
    return result


assert len(ROLES) == 13
topological_order()
