"""Synthetic hydraulic scenarios and approval-bound simulator reducer."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .privacy_policy import canonical_digest
from .simulation import (
    NETWORK,
    SOLVER_ID,
    can_operate_simulator,
    compare_scenarios,
    propose_intervention,
    solve,
    validate_approval,
)
from .world_routes import (
    FIXTURE_ID,
    _assets,
    _authorize_site,
    _graph_version,
    _relations,
)

router = APIRouter(prefix="/v1/simulations", tags=["simulations"])


class ScenarioCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(min_length=3, max_length=63)
    site_id: str = Field(min_length=2, max_length=63)
    idempotency_key: str = Field(min_length=1, max_length=128)


class InterventionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intervention: Literal["virtual_backup", "synthetic_resistance"]
    idempotency_key: str = Field(min_length=1, max_length=128)
    expires_minutes: int = Field(default=10, ge=1, le=30)


def _current_graph(
    session: Session, tenant: str, site: str, actor: Actor
) -> tuple[str, str]:
    _role, classifications = _authorize_site(session, tenant, actor, site)
    assets = _assets(session, tenant, site, classifications)
    if not assets:
        raise APIError(
            "WORLD_SNAPSHOT_NOT_FOUND",
            409,
            "A visible synthetic world snapshot is required before simulation.",
        )
    return _graph_version(assets, _relations(assets)), _role


def _run_row(
    session: Session, tenant: str, site: str, run_id: str, *, lock: bool = False
):
    suffix = " FOR UPDATE" if lock else ""
    return (
        session.execute(
            text(
                """SELECT id,actor_id,idempotency_key,state,fixture_id,graph_version,input_hash,
        input_snapshot,result,output_hash,seed,created_at,completed_at FROM simulation_runs
        WHERE tenant_id=:tenant AND site_id=:site AND id=:id"""
                + suffix
            ),
            {"tenant": tenant, "site": site, "id": run_id},
        )
        .mappings()
        .first()
    )


def _run_view(
    session: Session, tenant: str, site: str, run_id: str
) -> dict[str, Any] | None:
    row = _run_row(session, tenant, site, run_id)
    if row is None:
        return None
    audits = (
        session.execute(
            text(
                "SELECT event_type,actor_id,details,created_at FROM simulation_audit WHERE run_id=:id ORDER BY sequence"
            ),
            {"id": run_id},
        )
        .mappings()
        .all()
    )
    approvals = (
        session.execute(
            text(
                """SELECT id,state,action,action_hash,snapshot_hash,requester_id,approved_by,expires_at
        FROM simulation_approvals WHERE run_id=:id ORDER BY created_at"""
            ),
            {"id": run_id},
        )
        .mappings()
        .all()
    )
    return {
        "simulation_id": str(row["id"]),
        "tenant_id": tenant,
        "site_id": site,
        "status": row["state"],
        "fixture_id": row["fixture_id"],
        "solver_version": SOLVER_ID,
        "graph_version": row["graph_version"],
        "input_hash": row["input_hash"],
        "input_snapshot": dict(row["input_snapshot"]),
        "result": dict(row["result"]) if row["result"] is not None else None,
        "output_hash": row["output_hash"],
        "seed": row["seed"],
        "created_at": row["created_at"]
        .astimezone(UTC)
        .isoformat()
        .replace("+00:00", "Z"),
        "completed_at": (
            row["completed_at"].astimezone(UTC).isoformat().replace("+00:00", "Z")
            if row["completed_at"]
            else None
        ),
        "audit": [
            {
                "event_type": item["event_type"],
                "actor_id": item["actor_id"],
                "details": dict(item["details"]),
                "at": item["created_at"]
                .astimezone(UTC)
                .isoformat()
                .replace("+00:00", "Z"),
            }
            for item in audits
        ],
        "approvals": [
            {
                "approval_id": str(item["id"]),
                "state": item["state"],
                "action": dict(item["action"]),
                "action_hash": item["action_hash"],
                "snapshot_hash": item["snapshot_hash"],
                "requester_id": item["requester_id"],
                "approved_by": item["approved_by"],
                "expires_at": item["expires_at"]
                .astimezone(UTC)
                .isoformat()
                .replace("+00:00", "Z"),
            }
            for item in approvals
        ],
    }


def _audit(
    session: Session,
    *,
    run_id: str,
    tenant: str,
    site: str,
    actor: str,
    event: str,
    details: dict[str, Any],
) -> None:
    session.execute(
        text(
            """INSERT INTO simulation_audit(run_id,tenant_id,site_id,actor_id,event_type,details)
        VALUES (:run,:tenant,:site,:actor,:event,CAST(:details AS jsonb))"""
        ),
        {
            "run": run_id,
            "tenant": tenant,
            "site": site,
            "actor": actor,
            "event": event,
            "details": json.dumps(details, sort_keys=True, separators=(",", ":")),
        },
    )


@router.post("/scenarios", status_code=201)
def create_scenario(
    payload: ScenarioCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    graph, role = _current_graph(session, payload.tenant_id, payload.site_id, actor)
    if not can_operate_simulator(role):
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Viewer memberships cannot create simulation scenarios.",
        )
    snapshot = {
        "fixture_id": FIXTURE_ID,
        "graph_version": graph,
        "solver_id": SOLVER_ID,
        "seed": 20261115,
        "network": NETWORK,
        "classification": "synthetic_fixture",
    }
    snapshot_hash = canonical_digest(snapshot)
    existing = session.execute(
        text(
            "SELECT id,input_hash FROM simulation_runs WHERE tenant_id=:tenant AND site_id=:site AND idempotency_key=:key"
        ),
        {
            "tenant": payload.tenant_id,
            "site": payload.site_id,
            "key": payload.idempotency_key,
        },
    ).first()
    if existing:
        if existing.input_hash != snapshot_hash:
            raise APIError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Idempotency key is already bound to a different topology snapshot.",
            )
        return (
            _run_view(session, payload.tenant_id, payload.site_id, str(existing.id))
            or {}
        )
    run_id = str(uuid4())
    session.execute(
        text(
            """INSERT INTO simulation_runs(id,tenant_id,site_id,actor_id,idempotency_key,state,fixture_id,
        graph_version,input_hash,input_snapshot,seed) VALUES (:id,:tenant,:site,:actor,:key,'queued',:fixture,:graph,:hash,CAST(:snapshot AS jsonb),:seed)"""
        ),
        {
            "id": run_id,
            "tenant": payload.tenant_id,
            "site": payload.site_id,
            "actor": actor.uid,
            "key": payload.idempotency_key,
            "fixture": FIXTURE_ID,
            "graph": graph,
            "hash": snapshot_hash,
            "snapshot": json.dumps(snapshot, sort_keys=True, separators=(",", ":")),
            "seed": snapshot["seed"],
        },
    )
    _audit(
        session,
        run_id=run_id,
        tenant=payload.tenant_id,
        site=payload.site_id,
        actor=actor.uid,
        event="queued",
        details={"input_hash": snapshot_hash, "solver_version": SOLVER_ID},
    )
    session.commit()
    return _run_view(session, payload.tenant_id, payload.site_id, run_id) or {}


def _require_run(
    session: Session, tenant: str, site: str, run_id: str, *, lock: bool = False
):
    row = _run_row(session, tenant, site, run_id, lock=lock)
    if row is None:
        raise APIError(
            "SIMULATION_NOT_FOUND",
            404,
            "Simulation was not found in the authorized site.",
        )
    return row


@router.post("/scenarios/{run_id}/execute")
def execute_scenario(
    run_id: UUID,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    graph, role = _current_graph(session, tenant_id, site_id, actor)
    if not can_operate_simulator(role):
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Viewer memberships cannot execute simulation scenarios.",
        )
    row = _require_run(session, tenant_id, site_id, str(run_id), lock=True)
    if row["state"] == "completed":
        return _run_view(session, tenant_id, site_id, str(run_id)) or {}
    if row["state"] != "queued":
        raise APIError(
            "SIMULATION_NOT_EXECUTABLE",
            409,
            "Only a queued simulation can be executed.",
        )
    snapshot = dict(row["input_snapshot"])
    if graph != row["graph_version"]:
        raise APIError(
            "SIMULATION_SNAPSHOT_STALE",
            409,
            "World topology changed after the scenario snapshot was created.",
        )
    if (
        canonical_digest(snapshot) != row["input_hash"]
        or snapshot.get("solver_id") != SOLVER_ID
    ):
        raise APIError(
            "SIMULATION_SNAPSHOT_INVALID",
            409,
            "Stored scenario snapshot hash or solver version failed validation.",
        )
    result = compare_scenarios(
        input_snapshot_hash=row["input_hash"],
        seed=int(row["seed"]),
        network=snapshot["network"],
    )
    output_hash = canonical_digest(result)
    session.execute(
        text(
            "UPDATE simulation_runs SET state='completed',result=CAST(:result AS jsonb),output_hash=:hash,completed_at=now() WHERE id=:id"
        ),
        {
            "result": json.dumps(result, sort_keys=True, separators=(",", ":")),
            "hash": output_hash,
            "id": str(run_id),
        },
    )
    _audit(
        session,
        run_id=str(run_id),
        tenant=tenant_id,
        site=site_id,
        actor=actor.uid,
        event="executed",
        details={
            "output_hash": output_hash,
            "scenario_count": len(result["scenarios"]),
        },
    )
    session.commit()
    return _run_view(session, tenant_id, site_id, str(run_id)) or {}


@router.post("/scenarios/{run_id}/cancel")
def cancel_scenario(
    run_id: UUID,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    role, _classifications = _authorize_site(session, tenant_id, actor, site_id)
    if not can_operate_simulator(role):
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Viewer memberships cannot cancel simulation scenarios.",
        )
    row = _require_run(session, tenant_id, site_id, str(run_id), lock=True)
    if row["state"] != "queued":
        raise APIError(
            "SIMULATION_NOT_CANCELLABLE",
            409,
            "Only a queued simulation can be cancelled.",
        )
    session.execute(
        text("UPDATE simulation_runs SET state='cancelled' WHERE id=:id"),
        {"id": str(run_id)},
    )
    _audit(
        session,
        run_id=str(run_id),
        tenant=tenant_id,
        site=site_id,
        actor=actor.uid,
        event="cancelled",
        details={},
    )
    session.commit()
    return _run_view(session, tenant_id, site_id, str(run_id)) or {}


@router.get("/scenarios")
def list_scenarios(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _authorize_site(session, tenant_id, actor, site_id)
    ids = (
        session.execute(
            text(
                "SELECT id FROM simulation_runs WHERE tenant_id=:tenant AND site_id=:site ORDER BY created_at DESC LIMIT 100"
            ),
            {"tenant": tenant_id, "site": site_id},
        )
        .scalars()
        .all()
    )
    return {
        "scenarios": [
            result
            for item in ids
            if (result := _run_view(session, tenant_id, site_id, str(item)))
        ]
    }


@router.get("/scenarios/{run_id}")
def get_scenario(
    run_id: UUID,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _authorize_site(session, tenant_id, actor, site_id)
    value = _run_view(session, tenant_id, site_id, str(run_id))
    if value is None:
        raise APIError(
            "SIMULATION_NOT_FOUND",
            404,
            "Simulation was not found in the authorized site.",
        )
    return value


@router.post("/scenarios/{run_id}/replay")
def replay_scenario(
    run_id: UUID,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _authorize_site(session, tenant_id, actor, site_id)
    row = _require_run(session, tenant_id, site_id, str(run_id))
    if row["state"] != "completed" or row["result"] is None:
        raise APIError(
            "SIMULATION_NOT_REPLAYABLE", 409, "Only completed runs can be replayed."
        )
    snapshot = dict(row["input_snapshot"])
    if (
        canonical_digest(snapshot) != row["input_hash"]
        or snapshot.get("solver_id") != SOLVER_ID
    ):
        raise APIError(
            "SIMULATION_SNAPSHOT_INVALID",
            409,
            "Stored scenario snapshot hash or solver version failed validation.",
        )
    replay = compare_scenarios(
        input_snapshot_hash=row["input_hash"],
        seed=int(row["seed"]),
        network=snapshot["network"],
    )
    replay_hash = canonical_digest(replay)
    return {
        "simulation_id": str(run_id),
        "replayed": True,
        "reproducible": replay_hash == row["output_hash"],
        "stored_output_hash": row["output_hash"],
        "replay_output_hash": replay_hash,
        "result": replay,
    }


@router.post("/scenarios/{run_id}/approvals", status_code=201)
def request_intervention_approval(
    run_id: UUID,
    payload: InterventionProposal,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _graph, role = _current_graph(session, tenant_id, site_id, actor)
    if not can_operate_simulator(role):
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Viewer memberships cannot propose simulation interventions.",
        )
    run = _require_run(session, tenant_id, site_id, str(run_id))
    if run["state"] != "completed":
        raise APIError(
            "SIMULATION_NOT_READY",
            409,
            "Complete the comparison before proposing an intervention.",
        )
    proposal = propose_intervention(
        payload.intervention, input_snapshot_hash=run["input_hash"]
    )
    existing = (
        session.execute(
            text(
                "SELECT id,action_hash,snapshot_hash,state,expires_at FROM simulation_approvals WHERE tenant_id=:tenant AND idempotency_key=:key"
            ),
            {"tenant": tenant_id, "key": payload.idempotency_key},
        )
        .mappings()
        .first()
    )
    if existing:
        if (
            existing["action_hash"] != proposal["action_hash"]
            or existing["snapshot_hash"] != proposal["snapshot_hash"]
        ):
            raise APIError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Approval key is already bound to a different action or snapshot.",
            )
        return {
            "approval_id": str(existing["id"]),
            "state": existing["state"],
            "expires_at": existing["expires_at"].isoformat(),
            **proposal,
        }
    approval_id = str(uuid4())
    expires = datetime.now(UTC) + timedelta(minutes=payload.expires_minutes)
    session.execute(
        text(
            """INSERT INTO simulation_approvals(id,run_id,tenant_id,site_id,requester_id,requester_role,action,
        action_hash,snapshot_hash,state,idempotency_key,expires_at) VALUES (:id,:run,:tenant,:site,:actor,:role,CAST(:action AS jsonb),
        :action_hash,:snapshot,'pending',:key,:expires)"""
        ),
        {
            "id": approval_id,
            "run": str(run_id),
            "tenant": tenant_id,
            "site": site_id,
            "actor": actor.uid,
            "role": role,
            "action": json.dumps(proposal["action"], sort_keys=True),
            "action_hash": proposal["action_hash"],
            "snapshot": proposal["snapshot_hash"],
            "key": payload.idempotency_key,
            "expires": expires,
        },
    )
    _audit(
        session,
        run_id=str(run_id),
        tenant=tenant_id,
        site=site_id,
        actor=actor.uid,
        event="proposal",
        details={
            "approval_id": approval_id,
            "action_hash": proposal["action_hash"],
            "snapshot_hash": proposal["snapshot_hash"],
        },
    )
    session.commit()
    return {
        "approval_id": approval_id,
        "state": "pending",
        "expires_at": expires.isoformat(),
        **proposal,
    }


@router.post("/scenarios/{run_id}/approvals/{approval_id}/approve")
def approve_intervention(
    run_id: UUID,
    approval_id: UUID,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    graph, role = _current_graph(session, tenant_id, site_id, actor)
    approval = (
        session.execute(
            text(
                "SELECT * FROM simulation_approvals WHERE id=:id AND run_id=:run AND tenant_id=:tenant AND site_id=:site FOR UPDATE"
            ),
            {
                "id": str(approval_id),
                "run": str(run_id),
                "tenant": tenant_id,
                "site": site_id,
            },
        )
        .mappings()
        .first()
    )
    if not approval:
        raise APIError(
            "SIMULATION_APPROVAL_NOT_FOUND",
            404,
            "Approval was not found in the authorized run.",
        )
    proposal = {
        "action": dict(approval["action"]),
        "action_hash": approval["action_hash"],
        "snapshot_hash": approval["snapshot_hash"],
    }
    try:
        validate_approval(
            proposed=proposal,
            action=dict(approval["action"]),
            snapshot_hash=approval["snapshot_hash"],
            expires_at=approval["expires_at"].isoformat(),
            now=datetime.now(UTC).isoformat(),
            actor_id=approval["requester_id"],
            approver_id=actor.uid,
            role=role,
            state=approval["state"],
        )
    except ValueError as error:
        raise APIError(
            str(error),
            409,
            "Approval is expired, replayed, self-approved, or unauthorized.",
        ) from error
    run = _require_run(session, tenant_id, site_id, str(run_id), lock=True)
    if run["input_hash"] != approval["snapshot_hash"] or graph != run["graph_version"]:
        raise APIError(
            "SIMULATION_SNAPSHOT_STALE",
            409,
            "The scenario topology changed since the intervention was proposed.",
        )
    session.execute(
        text(
            "UPDATE simulation_approvals SET state='approved',approved_by=:actor,approved_at=now() WHERE id=:id"
        ),
        {"actor": actor.uid, "id": str(approval_id)},
    )
    _audit(
        session,
        run_id=str(run_id),
        tenant=tenant_id,
        site=site_id,
        actor=actor.uid,
        event="approved",
        details={
            "approval_id": str(approval_id),
            "action_hash": approval["action_hash"],
            "snapshot_hash": approval["snapshot_hash"],
        },
    )
    session.commit()
    return {
        "approval_id": str(approval_id),
        "state": "approved",
        "approved_by": actor.uid,
        "no_actuator_path": True,
    }


@router.post("/scenarios/{run_id}/approvals/{approval_id}/apply")
def apply_approved_intervention(
    run_id: UUID,
    approval_id: UUID,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    graph, role = _current_graph(session, tenant_id, site_id, actor)
    approval = (
        session.execute(
            text(
                "SELECT * FROM simulation_approvals WHERE id=:id AND run_id=:run AND tenant_id=:tenant AND site_id=:site FOR UPDATE"
            ),
            {
                "id": str(approval_id),
                "run": str(run_id),
                "tenant": tenant_id,
                "site": site_id,
            },
        )
        .mappings()
        .first()
    )
    if not approval:
        raise APIError(
            "SIMULATION_APPROVAL_NOT_FOUND",
            404,
            "Approval was not found in the authorized run.",
        )
    run = _require_run(session, tenant_id, site_id, str(run_id), lock=True)
    if approval["state"] != "approved" or approval["expires_at"] <= datetime.now(UTC):
        raise APIError(
            "SIMULATION_APPROVAL_INVALID",
            409,
            "Only a live approved intervention can be applied to a simulation.",
        )
    if approval["requester_id"] != actor.uid or approval["requester_role"] != role:
        raise APIError(
            "SIMULATION_ACTOR_MISMATCH",
            403,
            "The original requesting actor must apply the approved simulation change.",
        )
    if graph != run["graph_version"] or approval["snapshot_hash"] != run["input_hash"]:
        raise APIError(
            "SIMULATION_SNAPSHOT_STALE",
            409,
            "The world or scenario snapshot changed after approval.",
        )
    snapshot = dict(run["input_snapshot"])
    if (
        canonical_digest(snapshot) != run["input_hash"]
        or snapshot.get("solver_id") != SOLVER_ID
    ):
        raise APIError(
            "SIMULATION_SNAPSHOT_INVALID",
            409,
            "Stored scenario snapshot hash or solver version failed validation.",
        )
    action = dict(approval["action"])
    if (
        canonical_digest(action) != approval["action_hash"]
        or action.get("simulator_only") is not True
        or action.get("no_actuator_path") is not True
    ):
        raise APIError(
            "SIMULATION_ACTION_INVALID",
            409,
            "Approved action binding is invalid or outside the simulator reducer.",
        )
    result = solve(
        snapshot["network"],
        input_snapshot_hash=run["input_hash"],
        seed=int(run["seed"]),
        intervention=action["intervention"],
    )
    session.execute(
        text(
            "UPDATE simulation_approvals SET state='consumed',consumed_at=now() WHERE id=:id"
        ),
        {"id": str(approval_id)},
    )
    _audit(
        session,
        run_id=str(run_id),
        tenant=tenant_id,
        site=site_id,
        actor=actor.uid,
        event="applied",
        details={
            "approval_id": str(approval_id),
            "action_hash": approval["action_hash"],
            "snapshot_hash": approval["snapshot_hash"],
            "output_hash": result["output_hash"],
            "applied_to": "simulator_only",
            "result": result,
        },
    )
    session.commit()
    return {
        "simulation_id": str(run_id),
        "approval_id": str(approval_id),
        "state": "simulated",
        "applied_to": "simulator_only",
        "no_actuator_path": True,
        "result": result,
    }
