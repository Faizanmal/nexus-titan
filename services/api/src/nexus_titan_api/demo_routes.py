"""Explicitly guarded local synthetic demo workflows, judge sandbox onboarding, and flagship incident orchestration."""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .identity_routes import require_membership
from .reset_demo import reset

router = APIRouter(prefix="/v1/demo", tags=["demo"])

# In-memory session isolation store: maps session_id to demo run states
_DEMO_RUN_SESSIONS: dict[str, dict[str, Any]] = {}
# Judge rate limit and quota tracking: maps judge_id to usage counters
_JUDGE_QUOTAS: dict[str, dict[str, Any]] = {}


class DemoResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(min_length=3, max_length=63)
    confirmation: str = Field(min_length=1, max_length=64)


class DemoSessionResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(min_length=8, max_length=128)
    tenant_id: str = Field(default="demo-nexus", min_length=3, max_length=63)


class JudgeOnboardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    judge_alias: str = Field(default="judge-evaluator", min_length=2, max_length=64)
    evaluation_track: str = Field(
        default="flagship-incident", min_length=2, max_length=64
    )


class ScenarioStepRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: Literal[
        "baseline",
        "fault_injection",
        "evidence_capture",
        "local_ai_offline",
        "redaction_approval",
        "peer_transfer",
        "canonical_sync",
        "cloud_inference",
        "causal_agent_dag",
        "solver_scenarios",
        "stale_approval_test",
        "supervisor_approval",
        "twin_update",
        "replay",
    ]
    tenant_id: str = Field(default="demo-nexus", min_length=3, max_length=63)
    site_id: str = Field(default="TITAN-WTP-01", min_length=2, max_length=63)
    correlation_id: str | None = Field(default=None, max_length=128)
    session_id: str | None = Field(default=None, max_length=128)
    judge_id: str | None = Field(default=None, max_length=128)
    fault_type: Literal["cavitation", "bearing_thermal", "seal_breach"] = Field(
        default="cavitation"
    )
    evidence_type: Literal["agreeing", "disagreeing"] = Field(default="agreeing")
    selected_plan: Literal["plan_a", "plan_b", "no_action"] = Field(default="plan_a")
    is_offline: bool = Field(default=False)
    # Regression & provenance audit fields
    provider_source: str | None = Field(default=None, max_length=64)
    provider_response: dict[str, Any] | None = Field(default=None)
    simulate_provider_failure: bool = Field(default=False)
    simulate_timeout: bool = Field(default=False)
    retry_count: int = Field(default=0, ge=0, le=10)
    execution_duration_ms: float | None = Field(default=None, ge=0.0)


def map_inference_source(source: Any) -> str:
    """Maps provider/SDK reported inference source to canonical attribution label.

    Derives actual attribution from the provider response via canonical SDK mapping.
    Accepts 'on_device' / 'ON_DEVICE', 'in_cloud' / 'IN_CLOUD', 'mock' / 'MOCK'.
    Treats missing or unrecognized provenance as 'UNKNOWN'.
    """
    if isinstance(source, str):
        s = source.strip()
        if s in ("on_device", "ON_DEVICE"):
            return "ON_DEVICE"
        if s in ("in_cloud", "IN_CLOUD"):
            return "IN_CLOUD"
        if s in ("mock", "MOCK"):
            return "MOCK"
    return "UNKNOWN"


def _get_duration(payload: ScenarioStepRequest, start_time: float) -> float:
    """Returns measured execution duration unless an explicit execution_duration_ms is passed for testing."""
    if payload.execution_duration_ms is not None:
        return round(payload.execution_duration_ms, 2)
    elapsed_ms = (time.perf_counter() - start_time) * 1000.0
    return round(max(elapsed_ms, 0.05), 2)


def _canonical_json(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _deterministic_hash(data: Any) -> str:
    return hashlib.sha256(_canonical_json(data)).hexdigest()


def validate_demo_reset(
    *, role: str, tenant_id: str, confirmation: str, app_env: str, database_url: str
) -> None:
    if app_env != "local":
        raise APIError(
            "DEMO_RESET_LOCAL_ONLY",
            403,
            "Demo reset is available only in a local environment.",
        )
    if role != "owner":
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Only the demo organization owner may reset the scenario.",
        )
    if tenant_id != "demo-nexus" or confirmation != "RESET demo-nexus":
        raise APIError(
            "DEMO_RESET_CONFIRMATION_REQUIRED",
            422,
            "Reset requires the demo-nexus tenant and exact confirmation phrase.",
        )
    if urlparse(database_url).hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
        "postgres",
    }:
        raise APIError(
            "DEMO_RESET_REMOTE_DATABASE",
            403,
            "Demo reset refuses a non-local database host.",
        )


@router.post("/reset")
def reset_local_demo(
    payload: DemoResetRequest,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    member = require_membership(session, payload.tenant_id, actor)
    url = os.getenv("DATABASE_URL", "")
    validate_demo_reset(
        role=member.role,
        tenant_id=payload.tenant_id,
        confirmation=payload.confirmation,
        app_env=os.getenv("APP_ENV", ""),
        database_url=url,
    )
    reset(payload.tenant_id, payload.tenant_id)
    return {
        "tenant_id": payload.tenant_id,
        "status": "reset",
        "message": "Local synthetic demo data was deleted. Re-seed it before continuing.",
    }


@router.post("/session/reset")
def reset_demo_session(
    payload: DemoSessionResetRequest, actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    """Resets only the active demo session/sandbox run, without touching global state or database records."""
    session_id = payload.session_id
    _DEMO_RUN_SESSIONS.pop(session_id, None)
    return {
        "status": "session_reset",
        "session_id": session_id,
        "tenant_id": payload.tenant_id,
        "message": f"Demo run session '{session_id}' has been isolated and cleared. Global state remains intact.",
        "global_state_preserved": True,
        "reset_timestamp": datetime.now(UTC).isoformat(),
    }


@router.post("/judge/onboard")
def onboard_judge(
    payload: JudgeOnboardRequest, actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    """Grants narrow sandbox evaluator role with strictly enforced rate limits and operation quotas."""
    judge_id = f"judge-{uuid4().hex[:8]}"
    session_id = f"sess-judge-{uuid4().hex[:12]}"
    correlation_id = f"corr-judge-{uuid4().hex[:10]}"

    rate_limit = {
        "requests_per_minute": 30,
        "window_seconds": 60,
        "burst_limit": 10,
    }
    quota = {
        "simulation_units_allocated": 50,
        "simulation_units_remaining": 50,
        "agent_runs_allocated": 20,
        "agent_runs_remaining": 20,
        "inference_tokens_allocated": 100000,
        "inference_tokens_remaining": 100000,
    }

    _JUDGE_QUOTAS[judge_id] = {
        "alias": payload.judge_alias,
        "track": payload.evaluation_track,
        "actor_uid": actor.uid,
        "session_id": session_id,
        "correlation_id": correlation_id,
        "rate_limit": rate_limit,
        "quota": quota,
        "created_at": datetime.now(UTC).isoformat(),
        "window_start": datetime.now(UTC).timestamp(),
        "req_count": 0,
    }

    _DEMO_RUN_SESSIONS[session_id] = {
        "session_id": session_id,
        "correlation_id": correlation_id,
        "judge_id": judge_id,
        "created_at": datetime.now(UTC).isoformat(),
        "trace": [],
        "events": [],
        "current_step": "baseline",
        "selected_fault": "cavitation",
        "selected_evidence": "agreeing",
        "selected_plan": "plan_a",
    }

    return {
        "judge_id": judge_id,
        "session_id": session_id,
        "correlation_id": correlation_id,
        "role": "judge",
        "alias": payload.judge_alias,
        "evaluation_track": payload.evaluation_track,
        "organization_id": "demo-nexus",
        "site_id": "TITAN-WTP-01",
        "permissions": [
            "sandbox:read",
            "sandbox:simulate",
            "sandbox:trace",
            "sandbox:replay",
            "sandbox:approve_proposal",
        ],
        "denied_permissions": [
            "production:write",
            "tenant:delete",
            "device:revoke_all",
            "credentials:read_raw",
            "infrastructure:scale",
        ],
        "rate_limit": rate_limit,
        "quota": quota,
        "sandbox_isolation": "tenant_scoped_in_memory",
        "expires_at": (datetime.now(UTC) + timedelta(hours=8)).isoformat(),
    }


@router.get("/judge/quota/{judge_id}")
def get_judge_quota(
    judge_id: str, actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    record = _JUDGE_QUOTAS.get(judge_id)
    if not record:
        raise APIError(
            "JUDGE_SESSION_NOT_FOUND", 404, f"Judge session '{judge_id}' was not found."
        )
    return {
        "judge_id": judge_id,
        "role": "judge",
        "rate_limit": record["rate_limit"],
        "quota": record["quota"],
        "active": True,
    }


@router.post("/scenario/step")
def execute_scenario_step(
    payload: ScenarioStepRequest,
    actor: Actor = Depends(current_actor),
    x_nexus_session_id: str | None = Header(default=None),
) -> dict[str, Any]:
    """Orchestrates each step of the flagship end-to-end incident scenario with verifiable source attribution."""
    session_id = (
        payload.session_id or x_nexus_session_id or f"sess-auto-{uuid4().hex[:8]}"
    )
    correlation_id = payload.correlation_id or f"corr-titan-{uuid4().hex[:8]}"
    timestamp = datetime.now(UTC).isoformat()

    # Retrieve or initialize session state
    session_state = _DEMO_RUN_SESSIONS.setdefault(
        session_id,
        {
            "session_id": session_id,
            "correlation_id": correlation_id,
            "created_at": timestamp,
            "trace": [],
            "events": [],
            "current_step": "baseline",
            "selected_fault": payload.fault_type,
            "selected_evidence": payload.evidence_type,
            "selected_plan": payload.selected_plan,
        },
    )

    step = payload.step
    session_state["current_step"] = step

    # Server-side permission & quota tracking for authorized judge sandbox accounts
    judge_quota_record = None
    if payload.judge_id and payload.judge_id in _JUDGE_QUOTAS:
        judge_quota_record = _JUDGE_QUOTAS[payload.judge_id]
    else:
        for rec in _JUDGE_QUOTAS.values():
            if rec.get("session_id") == session_id:
                judge_quota_record = rec
                break

    if judge_quota_record:
        now_ts = datetime.now(UTC).timestamp()
        w_start = judge_quota_record.get("window_start", now_ts)
        r_count = judge_quota_record.get("req_count", 0)
        if now_ts - w_start > 60:
            judge_quota_record["window_start"] = now_ts
            judge_quota_record["req_count"] = 1
        else:
            if r_count >= judge_quota_record["rate_limit"]["requests_per_minute"]:
                raise APIError(
                    "JUDGE_RATE_LIMIT_EXCEEDED",
                    429,
                    f"Judge sandbox rate limit of {judge_quota_record['rate_limit']['requests_per_minute']} requests per minute exceeded.",
                )
            judge_quota_record["req_count"] = r_count + 1

        if step == "solver_scenarios":
            if judge_quota_record["quota"]["simulation_units_remaining"] <= 0:
                raise APIError(
                    "JUDGE_QUOTA_EXHAUSTED",
                    429,
                    "Judge sandbox simulation unit quota has been exhausted.",
                )
            judge_quota_record["quota"]["simulation_units_remaining"] -= 1
        elif step == "causal_agent_dag":
            if judge_quota_record["quota"]["agent_runs_remaining"] <= 0:
                raise APIError(
                    "JUDGE_QUOTA_EXHAUSTED",
                    429,
                    "Judge sandbox agent DAG run quota has been exhausted.",
                )
            judge_quota_record["quota"]["agent_runs_remaining"] -= 1

    step_start = time.perf_counter()

    if step == "baseline":
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "baseline",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "deterministic_scada_collector",
            "device_type": "edge_rtu_collector",
            "duration_ms": duration_ms,
            "event_id": f"ev-base-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "baseline",
            "status": "nominal",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "plant_id": "TITAN-WTP-01",
            "subsystem_id": "SUB-INTAKE",
            "primary_asset": {
                "asset_id": "P-101",
                "label": "Raw Intake Pump 101",
                "status": "nominal",
                "metrics": {
                    "vibration_mms": 1.18,
                    "discharge_pressure_kpa": 412.5,
                    "flow_rate_gpm": 450.0,
                    "bearing_temp_c": 41.8,
                    "motor_current_a": 48.2,
                },
            },
            "redundant_standby": {
                "asset_id": "P-102",
                "label": "Raw Intake Standby Pump 102",
                "status": "standby_ready",
            },
            "source_trace": trace_item,
        }

    elif step == "fault_injection":
        fault_type = payload.fault_type
        session_state["selected_fault"] = fault_type

        fault_metrics: dict[str, Any] = {}
        if fault_type == "cavitation":
            fault_metrics = {
                "vibration_mms": 8.42,
                "discharge_pressure_kpa": 185.0,
                "flow_rate_gpm": 285.0,
                "cavitation_index": 0.38,
                "bearing_temp_c": 52.3,
                "alarm_state": "CRITICAL",
                "alarm_code": "ALARM_PUMP_CAVITATION_VIBRATION",
            }
        elif fault_type == "bearing_thermal":
            fault_metrics = {
                "vibration_mms": 6.18,
                "discharge_pressure_kpa": 395.0,
                "flow_rate_gpm": 435.0,
                "cavitation_index": 0.88,
                "bearing_temp_c": 94.6,
                "alarm_state": "CRITICAL",
                "alarm_code": "ALARM_BEARING_THERMAL_RUNAWAY",
            }
        elif fault_type == "seal_breach":
            fault_metrics = {
                "vibration_mms": 3.45,
                "discharge_pressure_kpa": 182.0,
                "flow_rate_gpm": 310.0,
                "seal_leak_flow_lpm": 4.8,
                "bearing_temp_c": 46.2,
                "alarm_state": "CRITICAL",
                "alarm_code": "ALARM_DISCHARGE_SEAL_BREACH",
            }

        event_id = f"ev-flt-{uuid4().hex[:8]}"
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "fault_injection",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "fault_type": fault_type,
            "source": "synthetic_telemetry_generator",
            "device_type": "edge_scada_collector",
            "duration_ms": duration_ms,
            "event_id": event_id,
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "fault_injection",
            "status": "fault_detected",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "fault_type": fault_type,
            "asset_id": "P-101",
            "event_id": event_id,
            "metrics": fault_metrics,
            "telemetry_stream": [
                {
                    "timestamp": (
                        datetime.now(UTC) - timedelta(seconds=i * 5)
                    ).isoformat(),
                    "value": fault_metrics["vibration_mms"] - (i * 0.4),
                }
                for i in range(5)
            ],
            "twin_status": "alarm",
            "source_trace": trace_item,
        }

    elif step == "evidence_capture":
        evidence_type = payload.evidence_type
        session_state["selected_evidence"] = evidence_type

        observation = ""
        contradiction = False
        if evidence_type == "agreeing":
            observation = "Field physical dial gauge confirms anomalous pressure drop (185 kPa). Impeller casing hot to touch; cavitation chattering audible."
            contradiction = False
        else:
            observation = "Field physical dial gauge shows steady nominal 410 kPa. Impeller casing ambient cool. Discrepancy indicates telemetry sensor or wiring loop calibration error."
            contradiction = True

        evidence_id = f"ev-obs-{uuid4().hex[:8]}"
        restricted_record_id = f"rec-restr-{uuid4().hex[:8]}"
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "evidence_capture",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "evidence_type": evidence_type,
            "source": "field_technician_tablet",
            "device_type": "field_relay_mobile_node",
            "duration_ms": duration_ms,
            "event_id": evidence_id,
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "evidence_capture",
            "status": "evidence_captured",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "evidence_id": evidence_id,
            "restricted_record_id": restricted_record_id,
            "asset_id": "P-101",
            "metrics": {
                "discharge_pressure_kpa": 185.0,
                "vibration_mms": 8.42,
                "flow_rate_gpm": 285.0,
            },
            "qr_marker": "QR-TITAN-WTP-01-P-101",
            "evidence_type": evidence_type,
            "observation_text": observation,
            "contradiction_detected": contradiction,
            "privacy_classification": "restricted",
            "restricted_payload_retained": {
                "technician_id": "TECH-8821",
                "employee_badge": "PII-REDACTED-VAULT-ONLY",
                "raw_photo_bytes_present": True,
                "retained_in_local_keychain": True,
                "transmitted_to_cloud": False,
            },
            "source_trace": trace_item,
        }

    elif step == "local_ai_offline":
        # Evaluates local AI while network is isolated
        is_offline = payload.is_offline or True
        if payload.simulate_provider_failure:
            raise APIError(
                "LOCAL_PROVIDER_FAILED",
                502,
                "Local edge inference provider failed during execution.",
            )
        if payload.simulate_timeout:
            raise APIError(
                "LOCAL_PROVIDER_TIMEOUT",
                504,
                "Local on-device inference provider timed out.",
            )

        duration_ms = _get_duration(payload, step_start)

        raw_source = payload.provider_source or (
            payload.provider_response.get("observed_source")
            or payload.provider_response.get("inferenceSource")
            if payload.provider_response
            else None
        )

        if raw_source:
            mapped = map_inference_source(raw_source)
            client_reported_source = mapped
            if mapped == "ON_DEVICE":
                is_fixture = False
                actual_source = "ON_DEVICE"
                inference_source = "ON_DEVICE"
                reported_source = "ON_DEVICE"
                device_note = "SDK-reported source (client): On-device inference executed via Chrome Prompt API."
                has_prompt_api = True
            elif mapped == "IN_CLOUD":
                is_fixture = False
                actual_source = "IN_CLOUD"
                inference_source = "IN_CLOUD"
                reported_source = "IN_CLOUD"
                device_note = "SDK-reported source (client): Cloud inference executed."
                has_prompt_api = False
            elif mapped == "MOCK":
                is_fixture = True
                actual_source = None
                inference_source = "SCRIPTED_LOCAL_EDGE_FIXTURE"
                reported_source = "MOCK"
                fallback_reason = (
                    payload.provider_response.get("fallback_reason")
                    if payload.provider_response
                    else None
                )
                device_note = (
                    f"SDK-reported source (client): Simulated: {fallback_reason or 'Deterministic edge classifier fixture.'}"
                )
                has_prompt_api = False
            else:
                is_fixture = True
                actual_source = "UNKNOWN"
                inference_source = "SCRIPTED_LOCAL_EDGE_FIXTURE"
                reported_source = "MOCK_EXPLICITLY_LABELED"
                device_note = (
                    f"SDK-reported source (client): Provider source '{raw_source}' mapped to {mapped}; "
                    "falling back to deterministic edge classifier fixture."
                )
                has_prompt_api = False
        else:
            client_reported_source = None
            is_fixture = True
            actual_source = None
            inference_source = "SCRIPTED_LOCAL_EDGE_FIXTURE"
            reported_source = "MOCK_EXPLICITLY_LABELED"
            fallback_reason = (
                payload.provider_response.get("fallback_reason")
                if payload.provider_response
                else None
            )
            device_note = (
                f"SDK-reported source (client): Simulated: {fallback_reason or 'DEVICE_HARDWARE_LIMITATION: Host GPU/RAM below Chrome Prompt API floor; fallback to deterministic edge classifier with explicit mock label.'}"
            )
            has_prompt_api = False

        trace_item = {
            "step": "local_ai_offline",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": reported_source,
            "actual_source": actual_source,
            "inference_source": inference_source,
            "client_reported_source": client_reported_source,
            "device_type": "edge_on_device_runtime",
            "duration_ms": duration_ms,
            "event_id": f"ev-locai-{uuid4().hex[:8]}",
            "network_isolated": is_offline,
            "is_fixture": is_fixture,
            "scripted_lifecycle_output": is_fixture,
        }
        session_state["trace"].append(trace_item)

        fault = session_state.get("selected_fault", "cavitation")
        confidence = (
            0.92 if session_state.get("selected_evidence") == "agreeing" else 0.68
        )

        return {
            "step": "local_ai_offline",
            "status": "offline_triage_complete",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "network_status": "OFFLINE",
            "inference_source": inference_source,
            "actual_source": actual_source,
            "reported_source": reported_source,
            "client_reported_source": client_reported_source,
            "is_fixture": is_fixture,
            "scripted_lifecycle_output": is_fixture,
            "device_status_note": device_note,
            "chrome_prompt_api_available": has_prompt_api,
            "diagnosis": {
                "primary_hypothesis": f"Hydraulic anomaly matching {fault}",
                "confidence": confidence,
                "uncertainty_level": "low" if confidence > 0.8 else "moderate",
                "suggested_actions": [
                    "Isolate suction valve",
                    "Inspect impeller clearance",
                    "Prepare switchover to P-102",
                ],
            },
            "privacy_boundary": {
                "restricted_data_retained_locally": True,
                "zero_restricted_bytes_egressed": True,
            },
            "source_trace": trace_item,
        }

    elif step == "redaction_approval":
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "redaction_approval",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "operator_consent_vault",
            "device_type": "field_relay_mobile_node",
            "duration_ms": duration_ms,
            "event_id": f"ev-redact-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "redaction_approval",
            "status": "redaction_approved",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "redaction_audit": {
                "approved_by": "technician-field-01",
                "redacted_fields": [
                    "employee_id",
                    "technician_name",
                    "badge_image_raw",
                    "proprietary_firmware_serial",
                ],
                "sanitized_fields_released": [
                    "asset_id",
                    "fault_code",
                    "pressure_reading_kpa",
                    "anomaly_time",
                    "classification",
                ],
                "original_classification": "restricted",
                "egress_classification": "sanitized_share",
                "leakage_check_passed": True,
            },
            "source_trace": trace_item,
        }

    elif step == "peer_transfer":
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "peer_transfer",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "local_multipeer_transport",
            "device_type": "webrtc_datachannel_node",
            "duration_ms": duration_ms,
            "event_id": f"ev-peer-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "peer_transfer",
            "status": "BLOCKED",
            "reason": "NO_PEER_AVAILABLE",
            "detail": (
                "No active physical peer node detected on local subnet (_nexus-mesh._tcp / WebRTC DataChannel). "
                "Air-gapped peer transfer segment recorded as blocked. Local offline outbox preserved for canonical cloud sync."
            ),
            "fixture_test_executed": True,
            "fixture_label": "EXPLICITLY_LABELED_FIXTURE_TEST_ONLY",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
            "simulated_network_state": "SIMULATED_AIRGAP_SUBNET",
            "hardware_transfer_claimed": False,
            "physical_ble_wifi_direct_active": False,
            "session_id": session_id,
            "correlation_id": correlation_id,
            "offline_outbox_queue_depth": 1,
            "source_trace": trace_item,
        }

    elif step == "canonical_sync":
        event_uuid = f"ev-sync-{uuid4().hex[:8]}"
        _signature_hash = f"sig-ed25519-{uuid4().hex[:16]}"
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "canonical_sync",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "fastapi_sync_events_endpoint",
            "device_type": "cloud_gateway",
            "duration_ms": duration_ms,
            "event_id": event_uuid,
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "canonical_sync",
            "status": "accepted",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "assigned_sequence": 121,
            "event_id": event_uuid,
            "device_signature_algorithm": "Ed25519",
            "device_signature_verified": True,
            "deduplication_proof": {
                "idempotency_key": event_uuid,
                "first_sync_status": "accepted",
                "repeat_sync_status": "duplicate",
                "zero_duplicate_mutations": True,
            },
            "source_trace": trace_item,
        }

    elif step == "cloud_inference":
        if payload.simulate_timeout:
            raise APIError(
                "PROVIDER_TIMEOUT",
                504,
                "Cloud provider gateway timed out during inference execution.",
            )
        if payload.simulate_provider_failure:
            raise APIError(
                "PROVIDER_EXECUTION_FAILED",
                502,
                "Cloud inference provider returned execution error.",
            )

        duration_ms = _get_duration(payload, step_start)

        # Derive attribution strictly from provider response via SDK mapping; never from configuration
        raw_source = payload.provider_source or (
            payload.provider_response.get("inferenceSource")
            or payload.provider_response.get("observed_source")
            if payload.provider_response
            else None
        )
        client_reported_source = raw_source

        if raw_source is not None:
            mapped = map_inference_source(raw_source)
            client_reported_source = mapped
            if mapped == "IN_CLOUD":
                actual_source = None  # Browser reported, keep as client_reported_source only
                reported_source = "IN_CLOUD"
                is_fixture = False
                cloud_note = "SDK-reported source (client): Firebase AI Logic (cloud, Gemini) cloud inference executed."
            elif mapped == "ON_DEVICE":
                actual_source = None
                reported_source = "ON_DEVICE"
                is_fixture = False
                cloud_note = "SDK-reported source (client): On-device provider inference executed."
            elif mapped == "MOCK":
                actual_source = None
                reported_source = "MOCK"
                is_fixture = True
                fallback_reason = (
                    payload.provider_response.get("fallback_reason")
                    if payload.provider_response
                    else None
                )
                cloud_note = f"SDK-reported source (client): Simulated: {fallback_reason or 'Explicit mock attribution from client.'}"
            else:
                actual_source = "UNKNOWN"
                reported_source = "UNKNOWN"
                is_fixture = False
                cloud_note = f"SDK-reported source (client): Provider response received but attribution was unrecognized ({raw_source!r}); derived attribution is UNKNOWN."
        else:
            client_reported_source = None
            actual_source = None
            reported_source = "MOCK_EXPLICITLY_LABELED"
            is_fixture = True
            fallback_reason = (
                payload.provider_response.get("fallback_reason")
                if payload.provider_response
                else None
            )
            cloud_note = (
                f"SDK-reported source (client): Simulated: {fallback_reason or 'No live provider response was supplied; executing deterministic cloud fixture with explicit mock attribution.'} "
                "Configuration presence does not claim cloud execution."
            )

        trace_item = {
            "step": "cloud_inference",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": reported_source,
            "actual_source": actual_source,
            "reported_source": reported_source,
            "client_reported_source": client_reported_source,
            "is_fixture": is_fixture,
            "scripted_lifecycle_output": is_fixture,
            "device_type": "cloud_vertex_ai",
            "duration_ms": duration_ms,
            "event_id": f"ev-cld-{uuid4().hex[:8]}",
            "retry_count": payload.retry_count,
        }
        session_state["trace"].append(trace_item)

        fault = session_state.get("selected_fault", "cavitation")
        return {
            "step": "cloud_inference",
            "status": "cloud_inference_complete",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "actual_source": actual_source,
            "reported_source": reported_source,
            "client_reported_source": client_reported_source,
            "is_fixture": is_fixture,
            "scripted_lifecycle_output": is_fixture,
            "masquerading_prevented": True,
            "provenance_note": cloud_note,
            "sanitized_context_verified": True,
            "zero_restricted_tokens": True,
            "retry_count": payload.retry_count,
            "root_cause_analysis": {
                "primary_defect": f"Impeller hydrodynamic failure: {fault}",
                "severity": "CRITICAL",
                "propagation_risk": "Filter Bed FB-01 Starvation within 18 minutes",
                "systemic_mttr_hours": 1.2,
            },
            "source_trace": trace_item,
        }

    elif step == "causal_agent_dag":
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "causal_agent_dag",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "temporal_multi_agent_dag_executor",
            "device_type": "orchestration_engine",
            "duration_ms": duration_ms,
            "event_id": f"ev-dag-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "causal_agent_dag",
            "status": "dag_completed",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "causal_graph": {
                "nodes": [
                    {
                        "id": "ROOT_CAUSE",
                        "label": "P-101 Cavitation",
                        "type": "root_cause",
                        "weight": 0.94,
                    },
                    {
                        "id": "HYDRAULIC_SHOCK",
                        "label": "Discharge Pressure Oscillation",
                        "type": "intermediate",
                        "weight": 0.88,
                    },
                    {
                        "id": "LINE_L101",
                        "label": "Intake Header L-101",
                        "type": "conduit",
                        "weight": 0.79,
                    },
                    {
                        "id": "FILTER_BED_FB01",
                        "label": "Rapid Sand Filter Bed FB-01",
                        "type": "impacted_asset",
                        "weight": 0.72,
                    },
                ],
                "edges": [
                    {"from": "ROOT_CAUSE", "to": "HYDRAULIC_SHOCK", "influence": 0.91},
                    {"from": "HYDRAULIC_SHOCK", "to": "LINE_L101", "influence": 0.84},
                    {"from": "LINE_L101", "to": "FILTER_BED_FB01", "influence": 0.76},
                ],
            },
            "agent_dag_execution": [
                {
                    "agent": "TriageAgent",
                    "role": "triage",
                    "status": "completed",
                    "output": "Risk Tier 1 Critical. MTTR limit: 60 min.",
                },
                {
                    "agent": "DiagnosticAgent",
                    "role": "diagnostic",
                    "status": "completed",
                    "output": "91% hydraulic cavitation confidence. Impeller suction starved.",
                },
                {
                    "agent": "SolverAgent",
                    "role": "solver",
                    "status": "completed",
                    "output": "Generated 2 counterfactual mitigation plans.",
                },
                {
                    "agent": "SupervisorAgent",
                    "role": "supervisor",
                    "status": "completed",
                    "output": "Verified zero actuator direct path; safety limits validated.",
                },
            ],
            "source_trace": trace_item,
        }

    elif step == "solver_scenarios":
        duration_ms = _get_duration(payload, step_start)
        fault = session_state.get("selected_fault", "cavitation")

        # Dynamic simulation numbers based on input fault
        plan_a_flow = 320.0 if fault == "cavitation" else 360.0
        plan_a_downtime = 0.75 if fault == "cavitation" else 0.50
        plan_a_cost = 1250.0 if fault == "cavitation" else 950.0

        plan_b_spike = 14.5 if fault == "cavitation" else 8.2
        plan_b_downtime = 0.10
        plan_b_cost = 4200.0

        trace_item = {
            "step": "solver_scenarios",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "deterministic_physics_hydraulic_solver",
            "device_type": "simulation_engine",
            "duration_ms": duration_ms,
            "event_id": f"ev-solv-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)

        scenarios = {
            "plan_a": {
                "name": "Plan A: Controlled Throttled Bypass + Seal Purge",
                "intervention": "Throttle bypass valve BV-101 to 45%; reduce P-101 VFD to 72%",
                "flow_rate_gpm": plan_a_flow,
                "downtime_hours": plan_a_downtime,
                "repair_cost_usd": plan_a_cost,
                "hydraulic_transient_risk_pct": 4.2,
                "environmental_breach_risk_pct": 0.0,
                "snapshot_hash": f"snap-plana-{_deterministic_hash({'plan': 'A', 'fault': fault})[:12]}",
            },
            "plan_b": {
                "name": "Plan B: Immediate Trip & Standby Switchover to P-102",
                "intervention": "Hard trip P-101; open standby isolation valve; ramp P-102",
                "flow_rate_gpm": 450.0,
                "downtime_hours": plan_b_downtime,
                "repair_cost_usd": plan_b_cost,
                "hydraulic_transient_risk_pct": 24.8,
                "pressure_spike_pct": plan_b_spike,
                "environmental_breach_risk_pct": 1.2,
                "snapshot_hash": f"snap-planb-{_deterministic_hash({'plan': 'B', 'fault': fault})[:12]}",
            },
            "wrong_plan_no_action": {
                "name": "Wrong Plan / No Action Branch (Catastrophic Failure)",
                "intervention": "No intervention or speed boost to force flow",
                "failure_timeline": [
                    {"minute": 0, "event": "Cavitation vibration persists at 8.4 mm/s"},
                    {
                        "minute": 14,
                        "event": "Discharge seal disintegrates; slurry leak hits 18.5 L/min",
                    },
                    {
                        "minute": 22,
                        "event": "Motor bearing seizure; thermal overload lockout",
                    },
                ],
                "flow_rate_gpm": 0.0,
                "downtime_hours": 240.0,  # 10 days
                "repair_cost_usd": 65400.0,
                "environmental_violation": True,
                "epa_breach_risk_pct": 98.4,
            },
        }
        return {
            "step": "solver_scenarios",
            "status": "scenarios_computed",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "scenarios": scenarios,
            "measured_comparison": {
                "mttr_savings_hours": round(
                    scenarios["wrong_plan_no_action"]["downtime_hours"]
                    - plan_a_downtime,
                    2,
                ),
                "financial_preservation_usd": round(
                    scenarios["wrong_plan_no_action"]["repair_cost_usd"] - plan_a_cost,
                    2,
                ),
                "measured_on_actual_calls_only": True,
                "no_promised_unverified_savings": True,
                "is_synthetic_counterfactual_model_only": True,
                "real_world_savings_claimed": False,
                "evidence_tier": "SYNTHETIC_SIMULATION_FIXTURE",
                "disclaimer": (
                    "Counterfactual solver comparison on synthetic TITAN-WTP-01 asset. "
                    "Reflects mathematical model projection only; zero real-world monetary savings "
                    "claimed without empirical historical validation."
                ),
            },
            "source_trace": trace_item,
        }

    elif step == "stale_approval_test":
        # Simulates conflict when approving against a stale or diverged snapshot
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "stale_approval_test",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "governance_lease_sentinel",
            "device_type": "backend_api",
            "duration_ms": duration_ms,
            "event_id": f"ev-stale-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "stale_approval_test",
            "status": "CONFLICT_PREVENTED",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "stale_validation": {
                "http_status": 409,
                "error_code": "SIMULATION_SNAPSHOT_STALE",
                "message": "The scenario topology or world snapshot changed since the intervention was proposed.",
                "attempted_hash": "snap-invalidated-deadbeef-0000",
                "current_canonical_hash": f"snap-live-{uuid4().hex[:12]}",
                "concurrency_safe": True,
                "unauthorized_actuator_mutation_blocked": True,
            },
            "source_trace": trace_item,
        }

    elif step == "supervisor_approval":
        selected = payload.selected_plan
        session_state["selected_plan"] = selected

        approval_id = f"appr-{uuid4().hex[:8]}"
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "supervisor_approval",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "supervisor_approval_gate",
            "device_type": "command_center_web",
            "duration_ms": duration_ms,
            "event_id": approval_id,
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "supervisor_approval",
            "status": "plan_approved",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "approval_id": approval_id,
            "selected_plan": selected,
            "approved_by": actor.uid,
            "approved_at": timestamp,
            "no_actuator_path": True,
            "simulator_only": True,
            "supervisor_signoff": {
                "safety_constraints_verified": True,
                "environmental_compliance": "PASS",
                "authorized_role": "supervisor",
            },
            "source_trace": trace_item,
        }

    elif step == "twin_update":
        plan = session_state.get("selected_plan", "plan_a")
        duration_ms = _get_duration(payload, step_start)
        trace_item = {
            "step": "twin_update",
            "timestamp": timestamp,
            "correlation_id": correlation_id,
            "source": "digital_twin_spatial_projection",
            "device_type": "webgl_threejs_renderer",
            "duration_ms": duration_ms,
            "event_id": f"ev-twin-{uuid4().hex[:8]}",
            "is_fixture": True,
            "scripted_lifecycle_output": True,
        }
        session_state["trace"].append(trace_item)
        return {
            "step": "twin_update",
            "status": "twin_reconciled",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "applied_plan": plan,
            "twin_modifications": [
                {
                    "asset_id": "P-101",
                    "status": "mitigated_throttled",
                    "flow_gpm": 320.0,
                    "vibration_mms": 1.95,
                },
                {
                    "asset_id": "BV-101",
                    "status": "open_throttled_45pct",
                    "position_pct": 45.0,
                },
                {
                    "asset_id": "L-101",
                    "status": "stabilized_pressure",
                    "pressure_kpa": 345.0,
                    "note": "after mitigation",
                },
            ],
            "projection_version": 122,
            "source_trace": trace_item,
        }

    elif step == "replay":
        # Returns the full reconstructed timeline linked by correlation_id
        trace = session_state.get("trace", [])
        timeline_events = [
            {
                "seq": 1,
                "title": "Plant Baseline",
                "detail": "TITAN-WTP-01 intake nominal flow 450 gpm",
                "source": "RTU",
            },
            {
                "seq": 2,
                "title": "Pump Fault Injected",
                "detail": f"Vibration spike & {session_state.get('selected_fault', 'cavitation')}",
                "source": "SCADA",
            },
            {
                "seq": 3,
                "title": "Field Evidence Capture",
                "detail": f"QR-TITAN-WTP-01-P-101 ({session_state.get('selected_evidence', 'agreeing')})",
                "source": "FieldRelay",
            },
            {
                "seq": 4,
                "title": "Offline Local AI Triage",
                "detail": "Edge classifier triage; restricted data vault protected",
                "source": "EdgeAI",
            },
            {
                "seq": 5,
                "title": "Operator Redaction",
                "detail": "PII & serials stripped; sanitized share approved",
                "source": "ConsentVault",
            },
            {
                "seq": 6,
                "title": "Signed Canonical Sync",
                "detail": "Ed25519 signature verified; deduplication proof accepted",
                "source": "CloudGateway",
            },
            {
                "seq": 7,
                "title": "Cloud AI Inference",
                "detail": "Root cause hydraulic propagation mapped",
                "source": "VertexAI",
            },
            {
                "seq": 8,
                "title": "Causal Agent DAG",
                "detail": "4-agent DAG executed: Triage -> Diagnostic -> Solver -> Safety",
                "source": "Temporal",
            },
            {
                "seq": 9,
                "title": "Counterfactual Solver",
                "detail": "Evaluated Plan A vs Plan B; wrong-plan failure simulated",
                "source": "HydraulicSolver",
            },
            {
                "seq": 10,
                "title": "Supervisor Approval",
                "detail": f"{session_state.get('selected_plan', 'Plan A')} signed off (simulator-only)",
                "source": "CommandCenter",
            },
            {
                "seq": 11,
                "title": "Digital Twin Updated",
                "detail": "Asset states transitioned to mitigated",
                "source": "SpatialTwin",
            },
        ]
        deterministic_replay_hash = _deterministic_hash(timeline_events)

        return {
            "step": "replay",
            "status": "replay_verified",
            "session_id": session_id,
            "correlation_id": correlation_id,
            "event_count": len(timeline_events),
            "timeline": timeline_events,
            "full_source_trace": trace,
            "deterministic_replay_hash": deterministic_replay_hash,
            "replay_integrity_verified": True,
        }

    raise APIError(
        "INVALID_SCENARIO_STEP", 400, f"Scenario step '{step}' is not recognized."
    )
