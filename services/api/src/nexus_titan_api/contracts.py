"""Schema-backed request validation shared by API routes and tests."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from jsonschema import Draft202012Validator, FormatChecker

ROOT = next(
    (
        parent
        for parent in Path(__file__).resolve().parents
        if (parent / "contracts/schemas/v1.3.0/contracts.schema.json").is_file()
    ),
    Path("/app"),
)
SCHEMA_PATH = ROOT / "contracts/schemas/v1.3.0/contracts.schema.json"
ROOT_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
FORMAT_CHECKER = FormatChecker()


def _versioned_definition(name: str) -> dict[str, Any]:
    return {
        "$schema": ROOT_SCHEMA["$schema"],
        "$id": ROOT_SCHEMA["$id"],
        "$defs": ROOT_SCHEMA["$defs"],
        "$ref": f"#/$defs/{name}",
    }


@dataclass(frozen=True)
class ContractViolation:
    code: str
    status: int
    path: str
    message: str


def validate_contract(name: str, value: Any) -> list[ContractViolation]:
    """Return stable, bounded violations; never throw on untrusted enum values."""
    validator = Draft202012Validator(
        _versioned_definition(name), format_checker=FORMAT_CHECKER
    )
    errors = sorted(
        validator.iter_errors(value),
        key=lambda error: (list(map(str, error.absolute_path)), error.message),
    )
    violations = [
        ContractViolation(
            code="VALIDATION_ERROR",
            status=422,
            path="/" + "/".join(map(str, error.absolute_path)),
            # Do not echo untrusted payload values into the client-facing error.
            message=f"Failed {error.validator or 'schema'} validation.",
        )
        for error in errors[:20]
    ]
    if name == "EventBatch" and isinstance(value, dict):
        events = value.get("events")
        if isinstance(events, list):
            event_ids = [
                item.get("event_id") for item in events if isinstance(item, dict)
            ]
            seen: set[str] = set()
            for event_id in event_ids:
                if not isinstance(event_id, str):
                    continue
                try:
                    UUID(event_id)
                except ValueError:
                    continue
                if event_id in seen:
                    violations.append(
                        ContractViolation(
                            "CONFLICT",
                            409,
                            "/events",
                            "event_id values must be unique within a batch",
                        )
                    )
                    break
                seen.add(event_id)
            tenant = value.get("tenant_id")
            if any(
                isinstance(item, dict)
                and isinstance(item.get("tenant_id"), str)
                and item["tenant_id"] != tenant
                for item in events
            ):
                violations.append(
                    ContractViolation(
                        "TENANT_SCOPE_VIOLATION",
                        403,
                        "/events",
                        "all events must match the batch tenant_id",
                    )
                )
    return violations
