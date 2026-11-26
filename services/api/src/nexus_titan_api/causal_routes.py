"""Tenant-scoped causal investigation over canonical synthetic telemetry."""

from __future__ import annotations

from datetime import UTC, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .causal import investigate, validate_evidence_references
from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .telemetry import score_samples
from .world_routes import _assets, _authorize_site, _incidents, _relations

router = APIRouter(prefix="/v1/causal", tags=["causal-investigation"])


def _read(
    session: Session, tenant_id: str, site_id: str, investigation_id: str
) -> dict[str, Any] | None:
    row = (
        session.execute(
            text("""SELECT id,incident_id,created_at,result FROM causal_investigations
        WHERE tenant_id=:tenant AND site_id=:site AND id=:id"""),
            {"tenant": tenant_id, "site": site_id, "id": investigation_id},
        )
        .mappings()
        .first()
    )
    if not row:
        return None
    return {
        "investigation_id": str(row["id"]),
        "incident_id": str(row["incident_id"]),
        "created_at": row["created_at"]
        .astimezone(UTC)
        .isoformat()
        .replace("+00:00", "Z"),
        **dict(row["result"]),
    }


@router.post("/investigations")
def start_investigation(
    payload: dict[str, Any],
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    tenant_id, site_id, incident_id = (
        payload.get("tenant_id"),
        payload.get("site_id"),
        payload.get("incident_id"),
    )
    idem = payload.get("idempotency_key")
    if (
        not all(
            isinstance(v, str) and v for v in (tenant_id, site_id, incident_id, idem)
        )
        or len(idem) > 128
    ):
        raise APIError(
            "VALIDATION_ERROR",
            422,
            "Tenant, site, incident, and bounded idempotency key are required.",
        )
    role, classifications = _authorize_site(session, tenant_id, actor, site_id)
    if role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Viewer memberships cannot start causal investigations.",
        )
    previous = session.execute(
        text(
            "SELECT id FROM causal_investigations WHERE tenant_id=:tenant AND site_id=:site AND idempotency_key=:key"
        ),
        {"tenant": tenant_id, "site": site_id, "key": idem},
    ).scalar_one_or_none()
    if previous:
        return _read(session, tenant_id, site_id, str(previous)) or {}
    incident = next(
        (
            item
            for item in _incidents(session, tenant_id, site_id, classifications)
            if item["incident_id"] == incident_id
        ),
        None,
    )
    if not incident or not incident["affected_asset_ids"]:
        raise APIError(
            "INCIDENT_NOT_FOUND",
            404,
            "Incident is not visible or has no affected assets.",
        )
    event = (
        session.execute(
            text(
                "SELECT event_id,occurred_at FROM events WHERE tenant_id=:tenant AND event_id=:event AND event_type='incident.created'"
            ),
            {"tenant": tenant_id, "event": incident_id},
        )
        .mappings()
        .first()
    )
    if not event:
        raise APIError(
            "INCIDENT_EVIDENCE_UNAVAILABLE",
            409,
            "Canonical incident event evidence is unavailable.",
        )
    assets = _assets(session, tenant_id, site_id, classifications)
    relations = _relations(assets)
    asset_ids = {item["asset_id"] for item in assets}
    affected = [item for item in incident["affected_asset_ids"] if item in asset_ids]
    if not affected:
        raise APIError(
            "INCIDENT_SCOPE_UNAVAILABLE",
            409,
            "Affected assets are not visible in the current site scope.",
        )
    incident_at = event["occurred_at"].astimezone(UTC)
    # This fixture API is deliberately bounded and never reads another tenant/site.
    rows = (
        session.execute(
            text("""SELECT asset_id,metric,sample_sequence,sampled_at,value,unit,quality
        FROM telemetry_samples WHERE tenant_id=:tenant AND site_id=:site AND fixture_id='TITAN-WTP-01'
          AND asset_id = ANY(:assets) AND sampled_at <= :incident_at AND sampled_at >= :window_start
        ORDER BY sampled_at,sample_sequence LIMIT 20000"""),
            {
                "tenant": tenant_id,
                "site": site_id,
                "assets": sorted(asset_ids),
                "incident_at": incident_at,
                "window_start": incident_at - timedelta(days=30),
            },
        )
        .mappings()
        .all()
    )
    raw = [
        {
            **dict(row),
            "sampled_at": row["sampled_at"]
            .astimezone(UTC)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        for row in rows
    ]
    if not raw:
        scored: list[dict[str, Any]] = []
    else:
        try:
            scored = score_samples(raw)
        except ValueError as error:
            raise APIError(
                "INSUFFICIENT_BASELINE",
                409,
                "Causal ranking requires at least ten valid baseline samples per series.",
            ) from error
    observations = [
        {
            "asset_id": row["asset_id"],
            "metric": row["metric"],
            "source_id": f"telemetry:{row['sample_sequence']}",
            "sampled_at": row["sampled_at"],
            "value": row["value"],
            "quality": row["quality"],
            "robust_z": row["robust_z"],
        }
        for row in scored
        if row["value"] is not None
    ]
    result = investigate(
        assets=assets,
        relations=relations,
        observations=observations,
        affected_asset_ids=affected,
        incident_event_id=str(event["event_id"]),
        incident_at=incident_at.isoformat(),
        expected_sensor_assets=sorted(
            {row["asset_id"] for row in raw if row["asset_id"] in affected}
        ),
    )
    validate_evidence_references(
        result, {row["source_id"] for row in observations}, str(event["event_id"])
    )
    investigation_id = str(uuid4())
    session.execute(
        text(
            """INSERT INTO causal_investigations
        (id,tenant_id,site_id,incident_id,actor_id,idempotency_key,result,graph_version)
        VALUES (:id,:tenant,:site,:incident,:actor,:key,CAST(:result AS jsonb),:graph)"""
        ),
        {
            "id": investigation_id,
            "tenant": tenant_id,
            "site": site_id,
            "incident": incident_id,
            "actor": actor.uid,
            "key": idem,
            "result": __import__("json").dumps(result),
            "graph": __import__("hashlib")
            .sha256(
                __import__("json")
                .dumps({"assets": assets, "relations": relations}, sort_keys=True)
                .encode()
            )
            .hexdigest(),
        },
    )
    session.commit()
    return _read(session, tenant_id, site_id, investigation_id) or {}


@router.get("/investigations")
def list_investigations(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _authorize_site(session, tenant_id, actor, site_id)
    rows = (
        session.execute(
            text(
                "SELECT id FROM causal_investigations WHERE tenant_id=:tenant AND site_id=:site ORDER BY created_at DESC LIMIT 100"
            ),
            {"tenant": tenant_id, "site": site_id},
        )
        .scalars()
        .all()
    )
    return {
        "investigations": [
            item
            for row in rows
            if (item := _read(session, tenant_id, site_id, str(row)))
        ]
    }


@router.get("/investigations/{investigation_id}")
def get_investigation(
    investigation_id: str,
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _authorize_site(session, tenant_id, actor, site_id)
    result = _read(session, tenant_id, site_id, investigation_id)
    if not result:
        raise APIError(
            "INVESTIGATION_NOT_FOUND",
            404,
            "Investigation was not found in the authorized site.",
        )
    return result
