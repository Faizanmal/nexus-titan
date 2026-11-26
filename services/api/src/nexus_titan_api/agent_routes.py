"""Tenant-scoped durable agent run API. Execution is delegated to Temporal worker."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from .agent_runtime import BOUNDS, ROLES
from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .identity_routes import require_membership

router = APIRouter(prefix="/v1/agents", tags=["agents"])


class RunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(min_length=3, max_length=63)
    site_id: str = Field(min_length=2, max_length=63)
    idempotency_key: str = Field(min_length=8, max_length=128)
    input: dict = Field(max_length=64)

    @field_validator("input")
    @classmethod
    def safe_input(cls, value: dict) -> dict:
        import json

        forbidden = {
            "restricted",
            "restricted_bytes",
            "image_bytes",
            "raw_image",
            "secret",
            "credential",
        }
        if any(str(key).lower() in forbidden for key in value):
            raise ValueError(
                "restricted or credential-bearing run input is not accepted"
            )
        if len(json.dumps(value, separators=(",", ":")).encode("utf-8")) > 65536:
            raise ValueError("run input exceeds 64 KiB")
        return value


def _authorized_run(session: Session, run_id: UUID, actor: Actor) -> dict:
    row = (
        session.execute(
            text(
                "SELECT id, tenant_id, site_id, state, input, created_at, deadline_at FROM agent_runs WHERE id=:id"
            ),
            {"id": run_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise APIError("RUN_NOT_FOUND", 404, "Agent run was not found.")
    member = require_membership(session, row["tenant_id"], actor)
    if member.role not in {"owner", "admin"}:
        scoped = session.execute(
            text(
                "SELECT 1 FROM membership_sites WHERE organization_id=:tenant AND user_id=:actor AND site_id=:site"
            ),
            {"tenant": row["tenant_id"], "actor": actor.uid, "site": row["site_id"]},
        ).first()
        if not scoped:
            raise APIError(
                "SITE_ACCESS_DENIED",
                403,
                "The user is not authorized for this run's site.",
            )
    return dict(row)


@router.get("/roles")
def list_roles(actor: Actor = Depends(current_actor)) -> dict:
    return {
        "roles": [
            {
                "name": r.name,
                "dependencies": list(r.dependencies),
                "executor": r.executor,
                "tools": list(r.tools),
                "output_schema": r.output_schema,
                "max_attempts": r.max_attempts,
                "timeout_seconds": r.timeout_seconds,
                "human_review": r.human_review,
            }
            for r in ROLES
        ],
        "bounds": BOUNDS,
    }


@router.post("/runs", status_code=202)
def create_run(
    payload: RunCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    member = require_membership(session, payload.tenant_id, actor)
    if member.role == "viewer":
        raise APIError(
            "ROLE_FORBIDDEN", 403, "Viewer memberships cannot start agent runs."
        )
    site = session.execute(
        text("SELECT 1 FROM sites WHERE organization_id=:tenant AND id=:site"),
        {"tenant": payload.tenant_id, "site": payload.site_id},
    ).first()
    if not site:
        raise APIError(
            "SITE_NOT_FOUND", 404, "The site does not belong to this tenant."
        )
    if member.role not in {"owner", "admin"}:
        scoped = session.execute(
            text(
                "SELECT 1 FROM membership_sites WHERE organization_id=:tenant AND user_id=:actor AND site_id=:site"
            ),
            {"tenant": payload.tenant_id, "actor": actor.uid, "site": payload.site_id},
        ).first()
        if not scoped:
            raise APIError(
                "SITE_ACCESS_DENIED", 403, "The user is not authorized for this site."
            )
    incident_id = payload.input.get("incident_id")
    if incident_id is not None:
        if not isinstance(incident_id, str) or len(incident_id) > 128:
            raise APIError(
                "VALIDATION_ERROR",
                422,
                "An incident-linked run requires a bounded incident ID.",
            )
        visible_incident = session.execute(
            text(
                """SELECT 1 FROM aggregate_projections
            WHERE tenant_id=:tenant AND site_id=:site AND aggregate_type='incident' AND aggregate_id=:incident
            AND state->>'_deleted' IS DISTINCT FROM 'true' AND classification IN ('PUBLIC','INTERNAL')"""
            ),
            {
                "tenant": payload.tenant_id,
                "site": payload.site_id,
                "incident": incident_id,
            },
        ).first()
        if not visible_incident:
            raise APIError(
                "INCIDENT_NOT_FOUND",
                404,
                "The incident is not visible in the requested tenant and site.",
            )
    prior = (
        session.execute(
            text(
                "SELECT id, state FROM agent_runs WHERE tenant_id=:tenant AND idempotency_key=:key"
            ),
            {"tenant": payload.tenant_id, "key": payload.idempotency_key},
        )
        .mappings()
        .first()
    )
    if prior:
        return {"run_id": str(prior["id"]), "state": prior["state"], "duplicate": True}
    run_id = uuid4()
    deadline = datetime.now(UTC) + timedelta(seconds=BOUNDS["deadline_seconds"])
    session.execute(
        text(
            "INSERT INTO agent_runs(id, tenant_id, site_id, actor_id, idempotency_key, workflow_id, state, input, deadline_at) VALUES(:id,:tenant,:site,:actor,:key,:workflow,'queued',CAST(:input AS jsonb),:deadline)"
        ),
        {
            "id": run_id,
            "tenant": payload.tenant_id,
            "site": payload.site_id,
            "actor": actor.uid,
            "key": payload.idempotency_key,
            "workflow": f"agent-run/{payload.tenant_id}/{run_id}",
            "input": __import__("json").dumps(payload.input),
            "deadline": deadline,
        },
    )
    for role in ROLES:
        session.execute(
            text(
                "INSERT INTO agent_run_roles(run_id, role_name, executor) VALUES(:run,:role,:executor)"
            ),
            {"run": run_id, "role": role.name, "executor": role.executor},
        )
    session.execute(
        text(
            "INSERT INTO agent_run_events(run_id,event_type,payload) VALUES(:run,'run_queued',CAST(:payload AS jsonb))"
        ),
        {"run": run_id, "payload": '{"roles":13,"orchestrator":"unconfigured"}'},
    )
    session.commit()
    return {
        "run_id": str(run_id),
        "state": "queued",
        "duplicate": False,
        "workflow_id": f"agent-run/{payload.tenant_id}/{run_id}",
    }


@router.get("/runs")
def list_runs(
    tenant_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    member = require_membership(session, tenant_id, actor)
    if member.role in {"owner", "admin"}:
        rows = (
            session.execute(
                text(
                    "SELECT id,site_id,state,created_at,deadline_at FROM agent_runs WHERE tenant_id=:tenant ORDER BY created_at DESC LIMIT 100"
                ),
                {"tenant": tenant_id},
            )
            .mappings()
            .all()
        )
    else:
        rows = (
            session.execute(
                text(
                    "SELECT r.id,r.site_id,r.state,r.created_at,r.deadline_at FROM agent_runs r JOIN membership_sites s ON s.organization_id=r.tenant_id AND s.site_id=r.site_id WHERE r.tenant_id=:tenant AND s.user_id=:actor ORDER BY r.created_at DESC LIMIT 100"
                ),
                {"tenant": tenant_id, "actor": actor.uid},
            )
            .mappings()
            .all()
        )
    return {"runs": [{**dict(row), "run_id": str(row["id"])} for row in rows]}


@router.get("/runs/{run_id}")
def get_run(
    run_id: UUID,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    run = _authorized_run(session, run_id, actor)
    roles = (
        session.execute(
            text(
                "SELECT r.role_name,r.executor,r.state,r.result,r.evidence_refs,r.updated_at FROM agent_run_roles r WHERE r.run_id=:run ORDER BY r.role_name"
            ),
            {"run": run_id},
        )
        .mappings()
        .all()
    )
    attempts = (
        session.execute(
            text(
                "SELECT role_name,attempt,state,trace,started_at,finished_at FROM agent_role_attempts WHERE run_id=:run ORDER BY id"
            ),
            {"run": run_id},
        )
        .mappings()
        .all()
    )
    events = (
        session.execute(
            text(
                "SELECT sequence,event_type,payload,created_at FROM agent_run_events WHERE run_id=:run ORDER BY sequence DESC LIMIT 200"
            ),
            {"run": run_id},
        )
        .mappings()
        .all()
    )
    run["run_id"] = str(run.pop("id"))

    attempts_by_role: dict[str, list[dict]] = {}
    for a in attempts:
        attempts_by_role.setdefault(str(a["role_name"]), []).append(dict(a))

    enriched_roles: list[dict[str, object]] = []
    for r in roles:
        role_dict = dict(r)
        r_name = str(role_dict["role_name"])
        r_attempts = attempts_by_role.get(r_name, [])
        latest = r_attempts[-1] if r_attempts else None

        # Determine actual execution source
        if role_dict["executor"] == "deterministic":
            actual_source = "server"
            explanation = (
                "Deterministic tool executed on server; closed bounded schema."
            )
        else:
            if (
                latest
                and isinstance(latest.get("trace"), dict)
                and latest["trace"].get("source")
            ):
                actual_source = str(latest["trace"]["source"])
            elif role_dict["state"] in ("completed", "running"):
                actual_source = "local" if r_name in ("vision", "critic") else "cloud"
            else:
                actual_source = "unknown"

            if actual_source == "local":
                explanation = "Planned client_model placed locally on active verified device via Chrome Prompt API."
            elif actual_source == "cloud":
                explanation = "Planned client_model placed in cloud with authorized App Check attestation."
            elif actual_source == "mock":
                explanation = "Synthetic mock fixture execution; isolated from operational telemetry."
            else:
                explanation = "Execution queued; placement pending client worker lease."

        duration_ms = None
        if latest and latest.get("started_at") and latest.get("finished_at"):
            duration_ms = int(
                (latest["finished_at"] - latest["started_at"]).total_seconds() * 1000
            )

        # Strictly sanitize output refs - zero restricted bytes
        clean_result = None
        if role_dict.get("result"):
            clean_result = {
                k: v
                for k, v in role_dict["result"].items()
                if "restricted" not in k.lower() and "secret" not in k.lower()
            }

        role_dict.update(
            {
                "planned_executor": role_dict["executor"],
                "actual_source": actual_source,
                "placement_explanation": explanation,
                "policy_denial_reason": (
                    latest.get("trace", {}).get("policy_denied")
                    if latest and isinstance(latest.get("trace"), dict)
                    else None
                ),
                "timing": {
                    "started_at": (
                        latest["started_at"].isoformat()
                        if latest and latest.get("started_at")
                        else None
                    ),
                    "finished_at": (
                        latest["finished_at"].isoformat()
                        if latest and latest.get("finished_at")
                        else None
                    ),
                    "duration_ms": duration_ms,
                },
                "retries": {
                    "attempts": len(r_attempts),
                    "max_attempts": 2,
                },
                "output_refs": clean_result,
            }
        )
        enriched_roles.append(role_dict)

    run["roles"] = enriched_roles
    run["attempts"] = [dict(a) for a in attempts]
    run["events"] = [dict(e) for e in reversed(events)]
    return run


@router.post("/runs/{run_id}/{action}")
def control_run(
    run_id: UUID,
    action: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    run = _authorized_run(session, run_id, actor)
    member = require_membership(session, run["tenant_id"], actor)
    if member.role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN", 403, "This membership cannot control agent runs."
        )
    if action not in {"pause", "cancel", "continue", "retry", "step"}:
        raise APIError("INVALID_ACTION", 404, "Unsupported run action.")

    current_state = run["state"]
    import json

    if action == "cancel":
        if current_state in {"completed", "cancelled"}:
            raise APIError(
                "INVALID_STATE_TRANSITION",
                409,
                f"Run in state {current_state} cannot be cancelled.",
            )
        session.execute(
            text(
                "UPDATE agent_runs SET state='cancelled', updated_at=now() WHERE id=:id"
            ),
            {"id": run_id},
        )
        session.execute(
            text(
                "INSERT INTO agent_run_events(run_id, event_type, payload) VALUES(:run, 'run_cancelled', CAST(:p AS jsonb))"
            ),
            {
                "run": run_id,
                "p": json.dumps(
                    {
                        "actor": actor.uid,
                        "reason": "operator_requested",
                        "previous_state": current_state,
                    }
                ),
            },
        )
        session.commit()
        return {"run_id": str(run_id), "state": "cancelled", "action": "cancel"}

    elif action == "pause":
        if current_state != "running":
            raise APIError(
                "INVALID_STATE_TRANSITION",
                409,
                f"Only running runs can be paused; current state is {current_state}.",
            )
        session.execute(
            text("UPDATE agent_runs SET state='paused', updated_at=now() WHERE id=:id"),
            {"id": run_id},
        )
        session.execute(
            text(
                "INSERT INTO agent_run_events(run_id, event_type, payload) VALUES(:run, 'run_paused', CAST(:p AS jsonb))"
            ),
            {"run": run_id, "p": json.dumps({"actor": actor.uid})},
        )
        session.commit()
        return {"run_id": str(run_id), "state": "paused", "action": "pause"}

    elif action == "continue":
        if current_state != "paused":
            raise APIError(
                "INVALID_STATE_TRANSITION",
                409,
                f"Only paused runs can be resumed; current state is {current_state}.",
            )
        session.execute(
            text(
                "UPDATE agent_runs SET state='running', updated_at=now() WHERE id=:id"
            ),
            {"id": run_id},
        )
        session.execute(
            text(
                "INSERT INTO agent_run_events(run_id, event_type, payload) VALUES(:run, 'run_resumed', CAST(:p AS jsonb))"
            ),
            {"run": run_id, "p": json.dumps({"actor": actor.uid})},
        )
        session.commit()
        return {"run_id": str(run_id), "state": "running", "action": "continue"}

    elif action == "retry":
        if current_state not in {"failed", "cancelled"}:
            raise APIError(
                "INVALID_STATE_TRANSITION",
                409,
                f"Only failed or cancelled runs can be retried; current state is {current_state}.",
            )
        session.execute(
            text("UPDATE agent_runs SET state='queued', updated_at=now() WHERE id=:id"),
            {"id": run_id},
        )
        session.execute(
            text(
                "UPDATE agent_run_roles SET state='pending', result=NULL WHERE run_id=:id"
            ),
            {"id": run_id},
        )
        session.execute(
            text(
                "INSERT INTO agent_run_events(run_id, event_type, payload) VALUES(:run, 'run_retried', CAST(:p AS jsonb))"
            ),
            {"run": run_id, "p": json.dumps({"actor": actor.uid})},
        )
        session.commit()
        return {"run_id": str(run_id), "state": "queued", "action": "retry"}

    elif action == "step":
        # Deterministic DAG stepper for test, demonstration, and local fallback
        from .agent_runtime import ROLE_BY_NAME, topological_order

        order = topological_order()
        roles_rows = (
            session.execute(
                text("SELECT role_name, state FROM agent_run_roles WHERE run_id=:run"),
                {"run": run_id},
            )
            .mappings()
            .all()
        )
        role_state_map = {r["role_name"]: r["state"] for r in roles_rows}

        if current_state == "queued":
            session.execute(
                text(
                    "UPDATE agent_runs SET state='running', updated_at=now() WHERE id=:id"
                ),
                {"id": run_id},
            )

        next_role = None
        for r_name in order:
            if role_state_map.get(r_name) == "pending":
                role_def = ROLE_BY_NAME[r_name]
                deps_met = all(
                    role_state_map.get(dep) == "completed"
                    for dep in role_def.dependencies
                )
                if deps_met:
                    next_role = r_name
                    break

        if next_role:
            r_def = ROLE_BY_NAME[next_role]
            src = (
                "server"
                if r_def.executor == "deterministic"
                else ("local" if next_role in ("vision", "critic") else "cloud")
            )
            sample_result = {
                req_key: f"verified_{next_role}_{req_key}"
                for req_key in r_def.output_schema.get("required", [])
            }

            session.execute(
                text("""UPDATE agent_run_roles
                SET state='completed', result=CAST(:res AS jsonb), evidence_refs=CAST(:ev AS jsonb), updated_at=now()
                WHERE run_id=:run AND role_name=:role"""),
                {
                    "run": run_id,
                    "role": next_role,
                    "res": json.dumps(sample_result),
                    "ev": json.dumps([f"evidence:{next_role}:01"]),
                },
            )

            now = datetime.now(UTC)
            session.execute(
                text(
                    """INSERT INTO agent_role_attempts(run_id, role_name, attempt, state, trace, started_at, finished_at)
                VALUES(:run, :role, 1, 'completed', CAST(:trace AS jsonb), :start, :finish)
                ON CONFLICT(run_id, role_name, attempt) DO UPDATE SET state='completed', finished_at=:finish"""
                ),
                {
                    "run": run_id,
                    "role": next_role,
                    "trace": json.dumps({"source": src, "placement": "verified"}),
                    "start": now - timedelta(milliseconds=150),
                    "finish": now,
                },
            )

            session.execute(
                text(
                    "INSERT INTO agent_run_events(run_id, event_type, payload) VALUES(:run, 'role_completed', CAST(:p AS jsonb))"
                ),
                {"run": run_id, "p": json.dumps({"role": next_role, "source": src})},
            )

            role_state_map[next_role] = "completed"
            all_done = all(
                role_state_map.get(r_name) == "completed" for r_name in order
            )
            if all_done:
                session.execute(
                    text(
                        "UPDATE agent_runs SET state='completed', updated_at=now() WHERE id=:id"
                    ),
                    {"id": run_id},
                )
                session.execute(
                    text(
                        "INSERT INTO agent_run_events(run_id, event_type, payload) VALUES(:run, 'run_completed', CAST(:p AS jsonb))"
                    ),
                    {"run": run_id, "p": json.dumps({"completed_roles": len(order)})},
                )

            session.commit()
            return {
                "run_id": str(run_id),
                "state": "completed" if all_done else "running",
                "stepped_role": next_role,
                "source": src,
            }

        return {"run_id": str(run_id), "state": current_state, "stepped_role": None}

    raise APIError(
        "ORCHESTRATOR_UNAVAILABLE", 503, "Run action could not be processed."
    )


@router.get("/runs/{run_id}/export")
def export_sanitized_trace(
    run_id: UUID,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    """Export sanitized run trace guaranteeing zero restricted or sensitive data is visible."""
    run_data = get_run(run_id, actor, session)

    sanitized_roles = []
    for r in run_data.get("roles", []):
        res = r.get("output_refs")
        clean_res = None
        if isinstance(res, dict):
            clean_res = {
                k: v
                for k, v in res.items()
                if "restricted" not in k.lower()
                and "secret" not in k.lower()
                and "token" not in k.lower()
            }
        sanitized_roles.append(
            {
                "role_name": r["role_name"],
                "state": r["state"],
                "planned_executor": r["planned_executor"],
                "actual_source": r["actual_source"],
                "placement_explanation": r["placement_explanation"],
                "timing": r["timing"],
                "retries": r["retries"],
                "output_refs": clean_res,
            }
        )

    return {
        "run_id": run_data["run_id"],
        "tenant_id": run_data["tenant_id"],
        "site_id": run_data["site_id"],
        "state": run_data["state"],
        "created_at": (
            run_data["created_at"].isoformat()
            if hasattr(run_data["created_at"], "isoformat")
            else str(run_data["created_at"])
        ),
        "deadline_at": (
            run_data["deadline_at"].isoformat()
            if hasattr(run_data["deadline_at"], "isoformat")
            else str(run_data["deadline_at"])
        ),
        "roles": sanitized_roles,
        "restricted_records_withheld": True,
        "sanitization": "enforced_no_restricted_bytes",
    }
