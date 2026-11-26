"""Tenant- and site-scoped world APIs over canonical event projections."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from .contracts import validate_contract
from .database import get_session
from .errors import APIError
from .event_store import canonical_json
from .identity import Actor, current_actor
from .identity_routes import ADMIN_ROLES, get_scoped_site_ids, require_membership
from .identity_services import enforce_rate_limit
from .models import Site

router = APIRouter(prefix="/v1/world", tags=["world"])
FIXTURE_ID = "TITAN-WTP-01"
ROOT = next(
    (
        parent
        for parent in Path(__file__).resolve().parents
        if (parent / "tests/fixtures/world/TITAN-WTP-01/world.json").is_file()
    ),
    Path("/app"),
)


def _fixture_world() -> dict[str, Any]:
    path = ROOT / "tests/fixtures/world/TITAN-WTP-01/world.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


GEOMETRIES = {
    "subsystem": "procedural://geometry/subsystem-block-v1",
    "pump": "procedural://geometry/pump-centrifugal-v1",
    "tank": "procedural://geometry/tank-cylinder-v1",
    "filter": "procedural://geometry/filter-vessel-v1",
    "valve": "procedural://geometry/valve-gate-v1",
    "sensor": "procedural://geometry/sensor-instrument-v1",
}


def _visible_sites(
    session: Session, tenant_id: str, actor: Actor, role: str
) -> set[str]:
    if role in ADMIN_ROLES:
        return set(
            session.scalars(
                select(Site.id).where(Site.organization_id == tenant_id)
            ).all()
        )
    return get_scoped_site_ids(session, tenant_id, actor.uid)


def _authorize_site(
    session: Session, tenant_id: str, actor: Actor, site_id: str
) -> tuple[str, list[str]]:
    membership = require_membership(session, tenant_id, actor)
    sites = _visible_sites(session, tenant_id, actor, membership.role)
    if site_id not in sites:
        raise APIError(
            "SITE_SCOPE_VIOLATION",
            403,
            "The requested site is outside the membership scope.",
        )
    classifications = (
        ["PUBLIC"] if membership.role == "viewer" else ["PUBLIC", "INTERNAL"]
    )
    return membership.role, classifications


def _validate_output(name: str, value: dict[str, Any]) -> dict[str, Any]:
    if validate_contract(name, value):
        raise APIError(
            "INTERNAL_ERROR",
            500,
            "Stored projection does not match its published response contract.",
        )
    return value


def _assets(
    session: Session, tenant_id: str, site_id: str, classifications: list[str]
) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            text("""SELECT aggregate_id,classification,state FROM aggregate_projections
        WHERE tenant_id=:tenant_id AND site_id=:site_id AND aggregate_type='asset'
        AND classification IN :classifications ORDER BY aggregate_id""").bindparams(
                bindparam("classifications", expanding=True)
            ),
            {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "classifications": classifications,
            },
        )
        .mappings()
        .all()
    )
    result = []
    for row in rows:
        state = dict(row["state"])
        if state.get("fixture_id") != FIXTURE_ID or state.get("_deleted") is True:
            continue
        state.pop("_deleted", None)
        state.setdefault("asset_id", row["aggregate_id"])
        _validate_output("WorldAsset", state)
        result.append(state)
    return result


def _relations(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    visible = {asset["asset_id"] for asset in assets}
    relations = []
    for asset in assets:
        for index, dependency in enumerate(asset.get("dependencies", [])):
            target = dependency["target_asset_id"]
            if target not in visible:
                continue
            relations.append(
                {
                    "relation_id": f"{asset['asset_id']}:{dependency['relation']}:{index:02d}",
                    "source_asset_id": asset["asset_id"],
                    "target_asset_id": target,
                    "relation_type": dependency["relation"],
                    "fixture_id": FIXTURE_ID,
                }
            )
    return sorted(relations, key=lambda item: item["relation_id"])


def _incidents(
    session: Session, tenant_id: str, site_id: str, classifications: list[str]
) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            text("""SELECT aggregate_id,classification,state FROM aggregate_projections
        WHERE tenant_id=:tenant_id AND site_id=:site_id AND aggregate_type='incident'
        AND classification IN :classifications ORDER BY aggregate_id""").bindparams(
                bindparam("classifications", expanding=True)
            ),
            {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "classifications": classifications,
            },
        )
        .mappings()
        .all()
    )
    incidents = []
    for row in rows:
        state = dict(row["state"])
        if state.get("_deleted") is True:
            continue
        incident = {
            "incident_id": row["aggregate_id"],
            "site_id": site_id,
            "label": state.get("label", row["aggregate_id"]),
            "status": state.get("status", "open"),
            "classification": row["classification"].lower(),
            "affected_asset_ids": state.get("affected_asset_ids", []),
            "state": {key: value for key, value in state.items() if key != "_deleted"},
        }
        incidents.append(_validate_output("WorldIncident", incident))
    return incidents


def _scene(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "asset_id": asset["asset_id"],
            "geometry_ref": GEOMETRIES[asset["asset_type"]],
            "transform": {
                "position": asset["position"],
                "rotation_degrees": [0.0, 0.0, 0.0],
                "scale": [1.0, 1.0, 1.0],
            },
        }
        for asset in assets
    ]


def _cursor(session: Session, tenant_id: str) -> int:
    result = session.execute(
        text("SELECT last_sequence FROM projection_cursors WHERE tenant_id=:tenant_id"),
        {"tenant_id": tenant_id},
    ).scalar_one_or_none()
    return int(result or 0)


def _graph_version(
    assets: list[dict[str, Any]], relations: list[dict[str, Any]]
) -> str:
    content_hash = hashlib.sha256(
        canonical_json({"assets": assets, "relations": relations}).encode("utf-8")
    ).hexdigest()
    return f"{FIXTURE_ID}:1.0.0:{content_hash}"


@router.get("/assets")
def list_assets(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    assets = _assets(session, tenant_id, site_id, classifications)
    return _validate_output(
        "WorldAssetPage",
        {
            "fixture_id": FIXTURE_ID,
            "cursor": _cursor(session, tenant_id),
            "items": assets,
        },
    )


@router.get("/topology")
def get_topology(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    assets = _assets(session, tenant_id, site_id, classifications)
    relations = _relations(assets)
    return _validate_output(
        "WorldTopology",
        {
            "fixture_id": FIXTURE_ID,
            "graph_version": _graph_version(assets, relations),
            "assets": assets,
            "relations": relations,
        },
    )


@router.get("/incidents")
def list_incidents(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    return _validate_output(
        "WorldIncidentPage",
        {
            "cursor": _cursor(session, tenant_id),
            "items": _incidents(session, tenant_id, site_id, classifications),
        },
    )


@router.get("/snapshot")
def world_snapshot(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    assets = _assets(session, tenant_id, site_id, classifications)
    relations = _relations(assets)
    incidents = _incidents(session, tenant_id, site_id, classifications)
    result = {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "fixture_id": FIXTURE_ID,
        "graph_version": _graph_version(assets, relations),
        "cursor": _cursor(session, tenant_id),
        "assets": assets,
        "relations": relations,
        "incidents": incidents,
        "scene_entities": _scene(assets),
    }
    return _validate_output("WorldSnapshot", result)


@router.get("/telemetry")
def read_telemetry(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    asset_id: str = Query(pattern=r"^WTP01-PMP-\d{3}$"),
    metric: str = Query(pattern=r"^(pressure|flow|vibration|temperature)$"),
    start: datetime = Query(),
    end: datetime = Query(),
    interval_seconds: int = Query(default=60, ge=1, le=3600),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _authorize_site(session, tenant_id, actor, site_id)
    if (
        start.tzinfo is None
        or end.tzinfo is None
        or end <= start
        or end - start > timedelta(days=30)
    ):
        raise APIError(
            "VALIDATION_ERROR",
            422,
            "Telemetry window must be timezone-aware, increasing, and at most 30 days.",
        )
    if int((end - start).total_seconds() / interval_seconds) > 9999:
        raise APIError(
            "VALIDATION_ERROR",
            422,
            "Telemetry downsample interval would exceed 10,000 points.",
        )
    enforce_rate_limit(
        session,
        scope=f"telemetry:{tenant_id}:{site_id}",
        actor=actor.uid,
        limit=120,
        window=timedelta(minutes=1),
    )
    unit = {
        "pressure": "kPa",
        "flow": "m3/h",
        "vibration": "mm/s",
        "temperature": "degC",
    }[metric]
    rows = (
        session.execute(
            text(
                """WITH buckets AS (
          SELECT generate_series(date_bin(make_interval(secs => :interval_seconds), :start, TIMESTAMPTZ 'epoch'),
                                 date_bin(make_interval(secs => :interval_seconds), :end, TIMESTAMPTZ 'epoch'),
                                 make_interval(secs => :interval_seconds)) AS sampled_at
        ), grouped AS (
          SELECT date_bin(make_interval(secs => :interval_seconds), sampled_at, TIMESTAMPTZ 'epoch') AS sampled_at,
                 avg(value) AS value, min(value) AS minimum, max(value) AS maximum,
                 count(value)::integer AS sample_count, bool_or(quality='suspect') AS suspect
          FROM telemetry_samples WHERE tenant_id=:tenant_id AND site_id=:site_id AND fixture_id='TITAN-WTP-01'
            AND asset_id=:asset_id AND metric=:metric AND sampled_at >= :start AND sampled_at <= :end
          GROUP BY 1
        )
        SELECT buckets.sampled_at, grouped.value, grouped.minimum, grouped.maximum,
          COALESCE(grouped.sample_count,0) AS sample_count,
          CASE WHEN grouped.sample_count IS NULL OR grouped.sample_count=0 THEN 'missing'
               WHEN grouped.suspect THEN 'suspect' ELSE 'good' END AS quality
        FROM buckets LEFT JOIN grouped USING (sampled_at) ORDER BY buckets.sampled_at"""
            ),
            {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "asset_id": asset_id,
                "metric": metric,
                "start": start,
                "end": end,
                "interval_seconds": interval_seconds,
            },
        )
        .mappings()
        .all()
    )
    points = [
        {
            "sampled_at": row["sampled_at"]
            .astimezone(UTC)
            .isoformat()
            .replace("+00:00", "Z"),
            "value": row["value"],
            "minimum": row["minimum"],
            "maximum": row["maximum"],
            "sample_count": row["sample_count"],
            "unit": unit,
            "quality": row["quality"],
        }
        for row in rows
    ]
    latest = max(
        (row["sampled_at"] for row in rows if row["sample_count"] > 0), default=None
    )
    now = datetime.now(UTC)
    stale = latest is None or (now - latest.astimezone(UTC)) > max(
        timedelta(seconds=interval_seconds * 3), timedelta(minutes=2)
    )
    response = {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "asset_id": asset_id,
        "metric": metric,
        "unit": unit,
        "start": start.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "end": end.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "interval_seconds": interval_seconds,
        "availability": "available" if latest else "no_data",
        "stale": stale,
        "points": points,
    }
    return _validate_output("TelemetrySeriesPage", response)


class SpatialResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(min_length=3, max_length=63)
    site_id: str = Field(min_length=2, max_length=63)
    marker_id: str | None = Field(default=None, max_length=128)
    asset_id: str | None = Field(default=None, max_length=64)
    observed_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    source: str = Field(default="manual_scan", max_length=64)


@router.get("/spatial/markers")
def list_spatial_markers(
    tenant_id: str = Query(min_length=3, max_length=63),
    site_id: str = Query(min_length=2, max_length=63),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    assets = _assets(session, tenant_id, site_id, classifications)
    if not assets and tenant_id == "demo-nexus" and site_id == "titan-wtp-01":
        assets = _fixture_world().get("assets", [])
    markers = [
        {
            "marker_id": f"QR-{FIXTURE_ID}-{asset['asset_id']}",
            "marker_type": "logical_qr_registration",
            "asset_id": asset["asset_id"],
            "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
            "position": asset["position"],
            "confidence": "fixture_registry_exact_id",
            "physical_tag_printed": False,
        }
        for asset in assets
    ]
    return {
        "fixture_id": FIXTURE_ID,
        "site_id": site_id,
        "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
        "render_coordinate_system": "THREE_RHS_Y_UP",
        "coordinate_transform": {
            "from": "TITAN_LOCAL_PLANT_GRID_V1",
            "to": "THREE_RHS_Y_UP",
            "matrix_3x3_row_major": [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
            "mapping": "[east,north,up] -> [east,up,-north]",
            "units_preserved": True,
        },
        "markers": markers,
        "count": len(markers),
        "disclaimer": "Physical tags not printed; logical marker registration only. No uncalibrated environment reconstruction claimed.",
    }


@router.post("/spatial/resolve")
def resolve_spatial_asset(
    payload: SpatialResolveRequest,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _, classifications = _authorize_site(
        session, payload.tenant_id, actor, payload.site_id
    )
    if not payload.marker_id and not payload.asset_id:
        raise APIError(
            "VALIDATION_ERROR",
            422,
            "Either marker_id or asset_id must be provided for spatial resolution.",
        )
    assets = _assets(session, payload.tenant_id, payload.site_id, classifications)
    if (
        not assets
        and payload.tenant_id == "demo-nexus"
        and payload.site_id == "titan-wtp-01"
    ):
        assets = _fixture_world().get("assets", [])
    target_asset_id = payload.asset_id
    if payload.marker_id:
        prefix = f"QR-{FIXTURE_ID}-"
        if payload.marker_id.startswith(prefix):
            target_asset_id = payload.marker_id[len(prefix) :]
        elif payload.marker_id.startswith("WTP01-"):
            target_asset_id = payload.marker_id
        else:
            target_asset_id = payload.marker_id

    matched = next(
        (asset for asset in assets if asset["asset_id"] == target_asset_id), None
    )
    if not matched:
        raise APIError(
            "MARKER_NOT_FOUND",
            404,
            f"No asset found for marker/asset ID {payload.marker_id or payload.asset_id}.",
        )

    pos = matched["position"]
    three_pos = [pos[0], pos[2], -pos[1]]
    confidence_tier = (
        "fixture_registry_exact_id"
        if payload.marker_id and payload.marker_id.startswith(f"QR-{FIXTURE_ID}-")
        else (
            "manual_operator_confirmation"
            if payload.source == "manual_scan"
            else "field_marker_observation"
        )
    )
    confidence_score = (
        payload.observed_confidence if payload.observed_confidence is not None else 1.0
    )

    return {
        "resolved": True,
        "marker_id": payload.marker_id or f"QR-{FIXTURE_ID}-{matched['asset_id']}",
        "asset_id": matched["asset_id"],
        "label": matched["label"],
        "asset_type": matched["asset_type"],
        "subsystem_id": matched["subsystem_id"],
        "critical": matched["critical"],
        "position_plant_grid": pos,
        "position_three_rhs": three_pos,
        "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
        "render_coordinate_system": "THREE_RHS_Y_UP",
        "coordinate_transform": "[east,north,up] -> [east,up,-north]",
        "source": payload.source,
        "confidence_tier": confidence_tier,
        "confidence_score": confidence_score,
        "environment_reconstruction_claimed": False,
        "disclaimer": "Physical tag not printed; logical marker registration only. No uncalibrated environment reconstruction claimed.",
    }
