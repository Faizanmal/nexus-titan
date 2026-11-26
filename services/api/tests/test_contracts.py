import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from nexus_titan_api.contracts import ROOT_SCHEMA, validate_contract

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "tests/fixtures/contracts/v1.0.0"
SYNC_FIXTURES = ROOT / "tests/fixtures/contracts/v1.1.0"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(
        {
            "$schema": ROOT_SCHEMA["$schema"],
            "$id": ROOT_SCHEMA["$id"],
            "$defs": ROOT_SCHEMA["$defs"],
            "$ref": f"#/$defs/{name}",
        },
        format_checker=FormatChecker(),
    )


def test_schema_is_valid_and_examples_validate() -> None:
    Draft202012Validator.check_schema(ROOT_SCHEMA)
    assert not validate_contract("EventBatch", fixture("event-sequence.json"))
    assert not validate_contract(
        "SimulationRequest", fixture("simulation-request.json")
    )


def test_invalid_tenant_is_rejected() -> None:
    payload = fixture("event-sequence.json")
    payload["tenant_id"] = "../other-tenant"
    for event in payload["events"]:
        event["tenant_id"] = payload["tenant_id"]
    assert any(
        v.code == "VALIDATION_ERROR" and v.status == 422
        for v in validate_contract("EventBatch", payload)
    )


def test_invalid_classification_and_unknown_source_are_safe_rejections() -> None:
    classification = fixture("event-sequence.json")
    classification["events"][0]["classification"] = "top-secret-unknown"
    source = fixture("event-sequence.json")
    source["events"][0]["source"] = "unknown-peer"
    for payload in (classification, source):
        violations = validate_contract("EventBatch", payload)
        assert violations
        assert all(v.code == "VALIDATION_ERROR" and v.status == 422 for v in violations)


def test_duplicate_event_id_is_a_conflict() -> None:
    payload = fixture("event-sequence.json")
    duplicate = copy.deepcopy(payload["events"][0])
    duplicate["sequence"] = 3
    payload["events"].append(duplicate)
    assert any(
        v.code == "CONFLICT" and v.status == 409
        for v in validate_contract("EventBatch", payload)
    )


def test_invalid_simulation_input_is_rejected() -> None:
    payload = fixture("simulation-request.json")
    payload["time_step_seconds"] = 0
    assert any(
        v.path.endswith("time_step_seconds")
        for v in validate_contract("SimulationRequest", payload)
    )


def test_v1_optional_fields_and_version_boundary() -> None:
    simulation = fixture("simulation-request.json")
    assert validator("SimulationRequest").is_valid(
        simulation
    )  # optional metadata is absent
    event = fixture("event-sequence.json")["events"][0]
    assert validator("Event").is_valid(
        event
    )  # v1.1 readers retain v1.0 event compatibility
    event["schema_version"] = "1.3.0"
    assert validator("Event").is_valid(event)
    event["schema_version"] = "1.4.0"
    assert not validator("Event").is_valid(event)
    assert "/v1.3.0/" in ROOT_SCHEMA["$id"]


def test_sync_contract_requires_revision_site_and_device() -> None:
    payload = json.loads(
        (SYNC_FIXTURES / "sync-event-batch.json").read_text(encoding="utf-8")
    )
    assert validator("SyncEventBatch").is_valid(payload)
    del payload["events"][0]["expected_revision"]
    assert not validator("SyncEventBatch").is_valid(payload)


def test_agent_role_declares_typed_schemas_and_risk_tier() -> None:
    descriptor = {
        "role_id": "synthetic.reviewer",
        "risk_tier": "high",
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}},
        "output_schema": {"type": "object", "required": ["decision"]},
    }
    assert validator("AgentRoleDescriptor").is_valid(descriptor)
    descriptor["risk_tier"] = "unlisted-tier"
    assert not validator("AgentRoleDescriptor").is_valid(descriptor)


def test_generated_openapi_has_schema_models_and_contract_routes() -> None:
    document = json.loads((ROOT / "docs/api/openapi.json").read_text(encoding="utf-8"))
    assert {"/health", "/v1/events", "/v1/simulations", "/v1/agents/execute"} <= set(
        document["paths"]
    )
    assert {
        "EventBatch",
        "SimulationRequest",
        "AgentInvocation",
        "ErrorResponse",
    } <= set(document["components"]["schemas"])
    assert {
        "/v1/world/assets",
        "/v1/world/topology",
        "/v1/world/incidents",
        "/v1/world/snapshot",
    } <= set(document["paths"])
    assert {
        "WorldAsset",
        "WorldTopology",
        "WorldIncident",
        "WorldSnapshot",
        "SceneEntity",
    } <= set(document["components"]["schemas"])
    assert "/v1/world/telemetry" in document["paths"]
    assert {"TelemetrySample", "TelemetryPoint", "TelemetrySeriesPage"} <= set(
        document["components"]["schemas"]
    )


def test_synthetic_manual_and_evidence_fixtures_are_tenant_scoped() -> None:
    manual = fixture("fake-manual.json")
    evidence = fixture("fake-evidence.json")
    assert manual["tenant_id"] == evidence["tenant_id"] == "tenant-demo"
    assert "Synthetic fixture only" in manual["content"]
    assert evidence["fixture_only"] is True
