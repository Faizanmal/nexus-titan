from __future__ import annotations

import base64
import json
import logging
from datetime import UTC, timedelta
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from .database import get_session
from .errors import APIError
from .event_store import EventStoreUnavailable, append_event, canonical_json
from .identity import Actor, current_actor
from .identity_routes import ADMIN_ROLES, get_scoped_site_ids, require_membership
from .identity_services import enforce_rate_limit
from .models import Device, Site
from .privacy_policy import evaluate_privacy

router = APIRouter(tags=["sync"])
logger = logging.getLogger("nexus_titan_api.events")
MAX_SYNC_BYTES = 1_048_576
MAX_EVENT_BYTES = 131_072


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate object key")
        result[key] = value
    return result


def _verify_device_signature(
    public_key_pem: str, body: bytes, signature_b64: str
) -> None:
    try:
        public_key = serialization.load_pem_public_key(public_key_pem.encode("ascii"))
        signature = base64.b64decode(signature_b64, validate=True)
        if isinstance(public_key, ed25519.Ed25519PublicKey):
            public_key.verify(signature, body)
        elif isinstance(public_key, ec.EllipticCurvePublicKey) and isinstance(
            public_key.curve, ec.SECP256R1
        ):
            if len(signature) == 64:
                signature = encode_dss_signature(
                    int.from_bytes(signature[:32], "big"),
                    int.from_bytes(signature[32:], "big"),
                )
            public_key.verify(signature, body, ec.ECDSA(hashes.SHA256()))
        else:
            raise TypeError("unsupported device key")
    except (ValueError, TypeError, InvalidSignature) as error:
        raise APIError(
            "DEVICE_PROOF_INVALID",
            403,
            "The signed event batch could not be verified for this device.",
        ) from error


def _readable_sites(
    session: Session, organization_id: str, user_id: str, role: str
) -> set[str]:
    if role in ADMIN_ROLES:
        return set(
            session.scalars(
                select(Site.id).where(Site.organization_id == organization_id)
            ).all()
        )
    return get_scoped_site_ids(session, organization_id, user_id)


def event_policy_denial(
    event: dict[str, object], *, role: str, tenant_id: str, allowed_sites: set[str]
) -> str | None:
    if event.get("source") != "device":
        return "SOURCE_FORBIDDEN"
    if event.get("site_id") not in allowed_sites:
        return "SITE_SCOPE_VIOLATION"
    aggregate_type = event.get("aggregate_type")
    event_type = event.get("event_type")
    if not isinstance(aggregate_type, str) or not isinstance(event_type, str):
        return "EVENT_POLICY_DENIED"
    if not event_type.startswith(f"{aggregate_type}.") or event_type.rsplit(".", 1)[
        -1
    ] not in {"created", "updated", "deleted"}:
        return "EVENT_POLICY_DENIED"
    decision = evaluate_privacy(
        role=role,
        purpose="state_sync",
        destination="sync",
        classification=event.get("classification"),
        tenant_match=event.get("tenant_id") == tenant_id,
        device_trusted=True,
    )
    if not decision["allow"]:
        return {
            "ROLE_FORBIDDEN": "ROLE_FORBIDDEN",
            "CLASSIFICATION_CEILING": "CLASSIFICATION_FORBIDDEN",
            "TENANT_SCOPE_VIOLATION": "TENANT_SCOPE_VIOLATION",
        }.get(decision["reason"], "POLICY_DENIED")
    return None


@router.post("/sync/events")
async def sync_events(
    request: Request,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
    x_nexus_device_signature: str | None = Header(default=None),
) -> dict[str, object]:
    raw_body = await request.body()
    if len(raw_body) > MAX_SYNC_BYTES:
        raise APIError(
            "BATCH_TOO_LARGE",
            413,
            "The event sync batch exceeds the 1 MiB request limit.",
        )
    try:
        payload = json.loads(
            raw_body,
            object_pairs_hook=_strict_object,
            parse_constant=lambda _value: (_ for _ in ()).throw(
                ValueError("non-finite JSON number")
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise APIError(
            "VALIDATION_ERROR", 422, "The event batch is not valid canonical JSON."
        ) from error
    if not isinstance(payload, dict):
        raise APIError(
            "VALIDATION_ERROR", 422, "The event batch must be a JSON object."
        )
    from .main import _validate

    _validate("SyncEventBatch", payload)
    for event in payload["events"]:
        if len(canonical_json(event).encode("utf-8")) > MAX_EVENT_BYTES:
            raise APIError(
                "EVENT_TOO_LARGE", 413, "An individual event exceeds the 128 KiB limit."
            )

    tenant_id = payload["tenant_id"]
    member = require_membership(session, tenant_id, actor)
    if member.role == "viewer":
        enforce_rate_limit(
            session,
            scope=f"event-sync:{tenant_id}",
            actor=actor.uid,
            limit=500,
            window=timedelta(minutes=1),
            cost=len(payload["events"]),
        )
        return {
            "tenant_id": tenant_id,
            "results": [
                {
                    "event_id": event["event_id"],
                    "status": "denied",
                    "code": "ROLE_FORBIDDEN",
                }
                for event in payload["events"]
            ],
        }
    if not x_nexus_device_signature:
        raise APIError(
            "DEVICE_PROOF_REQUIRED",
            403,
            "A device signature is required for event synchronization.",
        )
    device_id = UUID(payload["device_id"])
    device = session.scalar(
        select(Device).where(
            Device.id == device_id,
            Device.organization_id == tenant_id,
            Device.user_id == actor.uid,
            Device.status == "registered",
        )
    )
    if device is None:
        raise APIError(
            "DEVICE_NOT_TRUSTED",
            403,
            "The device is not registered for this tenant and user or has been revoked.",
        )
    _verify_device_signature(device.public_key_pem, raw_body, x_nexus_device_signature)
    enforce_rate_limit(
        session,
        scope=f"event-sync:{tenant_id}",
        actor=actor.uid,
        limit=500,
        window=timedelta(minutes=1),
        cost=len(payload["events"]),
    )
    pending_count = session.scalar(
        text(
            "SELECT count(*) FROM event_outbox WHERE tenant_id=:tenant_id AND published_at IS NULL AND dead_lettered_at IS NULL"
        ),
        {"tenant_id": tenant_id},
    )
    if int(pending_count or 0) >= 10_000:
        raise APIError(
            "EVENT_BACKPRESSURE",
            503,
            "The tenant event delivery backlog is at its safety limit; retry after the outbox drains.",
        )

    allowed_sites = _readable_sites(session, tenant_id, actor.uid, member.role)
    results: list[dict[str, object]] = []
    for event in payload["events"]:
        denial = event_policy_denial(
            event, role=member.role, tenant_id=tenant_id, allowed_sites=allowed_sites
        )
        if denial:
            logger.info(
                json.dumps(
                    {
                        "event": "privacy_policy_denied",
                        "policy_version": "nexus-privacy-v1",
                        "tenant_id": tenant_id,
                        "event_id": event.get("event_id"),
                        "reason": denial,
                    },
                    separators=(",", ":"),
                )
            )
            results.append(
                {"event_id": event["event_id"], "status": "denied", "code": denial}
            )
            continue
        try:
            results.append(append_event(session, device_id=device_id, event=event))
        except EventStoreUnavailable as error:
            raise APIError(
                "EVENT_STORE_UNAVAILABLE",
                503,
                "The canonical event store could not commit the event.",
            ) from error

    accepted = sum(result["status"] == "accepted" for result in results)
    logger.info(
        json.dumps(
            {
                "event": "sync_batch_complete",
                "tenant_id": tenant_id,
                "device_id": str(device_id),
                "event_count": len(results),
                "accepted_count": accepted,
                "denied_count": sum(result["status"] == "denied" for result in results),
                "conflict_count": sum(
                    result["status"] == "conflict" for result in results
                ),
                "duplicate_count": sum(
                    result["status"] == "duplicate" for result in results
                ),
            },
            separators=(",", ":"),
        )
    )
    return {"tenant_id": tenant_id, "results": results}


@router.get("/sync/events")
def read_events(
    tenant_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, tenant_id, actor)
    site_ids = _readable_sites(session, tenant_id, actor.uid, member.role)
    if not site_ids:
        return {
            "tenant_id": tenant_id,
            "events": [],
            "cursor": after_sequence,
            "has_more": False,
        }
    classifications = ["PUBLIC"] if member.role == "viewer" else ["PUBLIC", "INTERNAL"]
    query = text(
        """SELECT tenant_id,event_id,sequence,schema_version,event_type,source,classification,occurred_at,
                    payload,site_id,aggregate_type,aggregate_id,aggregate_revision,correlation_id
                    FROM events WHERE tenant_id=:tenant_id AND sequence>:after_sequence
                    AND site_id IN :site_ids AND classification IN :classifications
                    ORDER BY sequence LIMIT :limit"""
    ).bindparams(
        bindparam("site_ids", expanding=True),
        bindparam("classifications", expanding=True),
    )
    rows = (
        session.execute(
            query,
            {
                "tenant_id": tenant_id,
                "after_sequence": after_sequence,
                "site_ids": sorted(site_ids),
                "classifications": classifications,
                "limit": limit,
            },
        )
        .mappings()
        .all()
    )
    events: list[dict[str, object]] = []
    for row in rows:
        events.append(
            {
                "event_id": str(row["event_id"]),
                "tenant_id": row["tenant_id"],
                "sequence": row["sequence"],
                "schema_version": row["schema_version"],
                "event_type": row["event_type"],
                "source": row["source"].lower(),
                "classification": row["classification"].lower(),
                "occurred_at": row["occurred_at"].astimezone(UTC).isoformat(),
                "payload": row["payload"],
                "site_id": row["site_id"],
                "aggregate_type": row["aggregate_type"],
                "aggregate_id": row["aggregate_id"],
                "expected_revision": (
                    max(0, row["aggregate_revision"] - 1)
                    if row["aggregate_revision"]
                    else 0
                ),
                "correlation_id": (
                    str(row["correlation_id"]) if row["correlation_id"] else None
                ),
            }
        )
    cursor = rows[-1]["sequence"] if rows else after_sequence
    return {
        "tenant_id": tenant_id,
        "events": events,
        "cursor": cursor,
        "has_more": len(rows) == limit,
    }


@router.get("/sync/snapshot/{tenant_id}")
def read_snapshot(
    tenant_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, tenant_id, actor)
    site_ids = _readable_sites(session, tenant_id, actor.uid, member.role)
    classifications = ["PUBLIC"] if member.role == "viewer" else ["PUBLIC", "INTERNAL"]
    rows = []
    if site_ids:
        rows = (
            session.execute(
                text(
                    """SELECT site_id,aggregate_type,aggregate_id,revision,last_sequence,classification,state
            FROM aggregate_projections WHERE tenant_id=:tenant_id AND site_id IN :site_ids
            AND classification IN :classifications ORDER BY site_id,aggregate_type,aggregate_id"""
                ).bindparams(
                    bindparam("site_ids", expanding=True),
                    bindparam("classifications", expanding=True),
                ),
                {
                    "tenant_id": tenant_id,
                    "site_ids": sorted(site_ids),
                    "classifications": classifications,
                },
            )
            .mappings()
            .all()
        )
    cursor = session.execute(
        text("SELECT last_sequence FROM projection_cursors WHERE tenant_id=:tenant_id"),
        {"tenant_id": tenant_id},
    ).scalar_one_or_none()
    event_head = session.execute(
        text("SELECT last_sequence FROM tenants WHERE tenant_id=:tenant_id"),
        {"tenant_id": tenant_id},
    ).scalar_one_or_none()
    return {
        "tenant_id": tenant_id,
        "cursor": int(cursor or 0),
        "event_head": int(event_head or 0),
        "projections": [
            {
                "site_id": row["site_id"],
                "aggregate_type": row["aggregate_type"],
                "aggregate_id": row["aggregate_id"],
                "revision": row["revision"],
                "last_sequence": row["last_sequence"],
                "classification": row["classification"].lower(),
                "state": row["state"],
            }
            for row in rows
        ],
    }


@router.get("/v1/organizations/{organization_id}/events/dead-letters")
def list_dead_letters(
    organization_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, organization_id, actor)
    if member.role not in ADMIN_ROLES:
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Only organization administrators can inspect event delivery failures.",
        )
    rows = (
        session.execute(
            text(
                """SELECT d.event_id,d.attempts,d.error_code,d.recorded_at,d.resolved_at
        FROM event_dead_letters d WHERE d.tenant_id=:tenant_id ORDER BY d.recorded_at DESC LIMIT 100"""
            ),
            {"tenant_id": organization_id},
        )
        .mappings()
        .all()
    )
    return {
        "tenant_id": organization_id,
        "dead_letters": [
            {
                "event_id": str(row["event_id"]),
                "attempts": row["attempts"],
                "error_code": row["error_code"],
                "recorded_at": row["recorded_at"].isoformat(),
                "resolved": row["resolved_at"] is not None,
            }
            for row in rows
        ],
    }


@router.post("/v1/organizations/{organization_id}/events/dead-letters/{event_id}/retry")
def retry_dead_letter(
    organization_id: str,
    event_id: UUID,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    member = require_membership(session, organization_id, actor)
    if member.role not in ADMIN_ROLES:
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Only organization administrators can retry event delivery.",
        )
    row = session.execute(
        text(
            """UPDATE event_outbox SET dead_lettered_at=NULL,attempts=0,next_attempt_at=now(),last_error_code=NULL,
        published_at=NULL,delivery_generation=delivery_generation+1
        WHERE tenant_id=:tenant_id AND event_id=:event_id AND dead_lettered_at IS NOT NULL RETURNING event_id"""
        ),
        {"tenant_id": organization_id, "event_id": event_id},
    ).first()
    if row is None:
        raise APIError(
            "DEAD_LETTER_NOT_FOUND",
            404,
            "No dead-lettered event exists for this organization and ID.",
        )
    session.execute(
        text(
            """UPDATE projection_outbox SET published_at=NULL,dead_lettered_at=NULL,attempts=0,
        next_attempt_at=now(),last_error_code=NULL WHERE tenant_id=:tenant_id AND event_id=:event_id"""
        ),
        {"tenant_id": organization_id, "event_id": event_id},
    )
    session.execute(
        text(
            "UPDATE event_dead_letters SET resolved_at=now() WHERE tenant_id=:tenant_id AND event_id=:event_id"
        ),
        {"tenant_id": organization_id, "event_id": event_id},
    )
    session.commit()
    return {"event_id": str(event_id), "status": "retry_scheduled"}
