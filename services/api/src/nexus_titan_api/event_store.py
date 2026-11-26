"""Canonical, tenant-serialized event append and deterministic state reducers."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from .errors import APIError


class EventStoreUnavailable(RuntimeError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def canonical_hash(event: dict[str, Any]) -> bytes:
    return hashlib.sha256(canonical_json(event).encode("utf-8")).digest()


def append_precondition_result(
    *,
    event_id: str,
    payload_hash: bytes,
    existing_hash: bytes | None,
    existing_sequence: int | None,
    last_sequence: int,
    event_sequence: int,
    expected_revision: int,
    actual_revision: int,
) -> dict[str, Any] | None:
    """Return a stable idempotency/optimistic-conflict response, or None when append may commit."""
    if existing_sequence is not None:
        if existing_hash is not None and existing_hash == payload_hash:
            return {
                "event_id": event_id,
                "status": "duplicate",
                "sequence": existing_sequence,
            }
        return {"event_id": event_id, "status": "conflict", "code": "EVENT_ID_REUSED"}
    expected_sequence = last_sequence + 1
    if event_sequence != expected_sequence:
        return {
            "event_id": event_id,
            "status": "conflict",
            "code": "SEQUENCE_CONFLICT",
            "expected_sequence": expected_sequence,
        }
    if expected_revision != actual_revision:
        return {
            "event_id": event_id,
            "status": "conflict",
            "code": "REVISION_CONFLICT",
            "expected_revision": actual_revision,
        }
    return None


def append_event(
    session: Session, *, device_id: UUID | None, event: dict[str, Any]
) -> dict[str, Any]:
    """Append one event atomically with tenant sequence, aggregate revision, and outbox."""
    tenant_id = event["tenant_id"]
    event_id = UUID(event["event_id"])
    payload_hash = canonical_hash(event)
    try:
        head = session.execute(
            text(
                "SELECT last_sequence FROM tenants WHERE tenant_id=:tenant_id FOR UPDATE"
            ),
            {"tenant_id": tenant_id},
        ).first()
        if head is None:
            session.rollback()
            raise APIError(
                "NOT_FOUND", 404, "The organization event stream was not found."
            )

        prior = session.execute(
            text(
                "SELECT sequence, payload_hash FROM events WHERE tenant_id=:tenant_id AND event_id=:event_id"
            ),
            {"tenant_id": tenant_id, "event_id": event_id},
        ).first()
        aggregate_key = {
            "tenant_id": tenant_id,
            "site_id": event["site_id"],
            "aggregate_type": event["aggregate_type"],
            "aggregate_id": event["aggregate_id"],
        }
        current = session.execute(
            text("""SELECT revision FROM aggregate_heads
                    WHERE tenant_id=:tenant_id AND site_id=:site_id
                      AND aggregate_type=:aggregate_type AND aggregate_id=:aggregate_id
                    FOR UPDATE"""),
            aggregate_key,
        ).first()
        actual_revision = int(current.revision) if current is not None else 0
        conflict = append_precondition_result(
            event_id=str(event_id),
            payload_hash=payload_hash,
            existing_hash=(
                bytes(prior.payload_hash)
                if prior is not None and prior.payload_hash is not None
                else None
            ),
            existing_sequence=int(prior.sequence) if prior is not None else None,
            last_sequence=int(head.last_sequence),
            event_sequence=int(event["sequence"]),
            expected_revision=int(event["expected_revision"]),
            actual_revision=actual_revision,
        )
        if conflict is not None:
            session.rollback()
            return conflict

        sequence = int(head.last_sequence) + 1
        aggregate_revision = actual_revision + 1
        occurred_at = datetime.fromisoformat(
            event["occurred_at"].replace("Z", "+00:00")
        )
        session.execute(
            text("""INSERT INTO events
                (tenant_id,event_id,sequence,schema_version,event_type,source,classification,occurred_at,payload,
                 site_id,aggregate_type,aggregate_id,aggregate_revision,correlation_id,device_id,payload_hash)
                VALUES (:tenant_id,:event_id,:sequence,:schema_version,:event_type,:source,:classification,
                 :occurred_at,CAST(:payload AS jsonb),:site_id,:aggregate_type,:aggregate_id,:aggregate_revision,
                 :correlation_id,:device_id,:payload_hash)"""),
            {
                **aggregate_key,
                "event_id": event_id,
                "sequence": sequence,
                "schema_version": event["schema_version"],
                "event_type": event["event_type"],
                "source": event["source"].upper(),
                "classification": event["classification"].upper(),
                "occurred_at": occurred_at,
                "payload": canonical_json(event["payload"]),
                "aggregate_revision": aggregate_revision,
                "correlation_id": event.get("correlation_id"),
                "device_id": device_id,
                "payload_hash": payload_hash,
            },
        )
        session.execute(
            text(
                "INSERT INTO event_outbox(tenant_id,event_id) VALUES (:tenant_id,:event_id)"
            ),
            {"tenant_id": tenant_id, "event_id": event_id},
        )
        session.execute(
            text(
                """INSERT INTO aggregate_heads
                (tenant_id,site_id,aggregate_type,aggregate_id,revision,last_sequence)
                VALUES (:tenant_id,:site_id,:aggregate_type,:aggregate_id,:revision,:last_sequence)
                ON CONFLICT (tenant_id,site_id,aggregate_type,aggregate_id)
                DO UPDATE SET revision=EXCLUDED.revision,last_sequence=EXCLUDED.last_sequence"""
            ),
            {
                **aggregate_key,
                "revision": aggregate_revision,
                "last_sequence": sequence,
            },
        )
        session.execute(
            text(
                "UPDATE tenants SET last_sequence=:sequence WHERE tenant_id=:tenant_id"
            ),
            {"sequence": sequence, "tenant_id": tenant_id},
        )
        session.commit()
        return {
            "event_id": str(event_id),
            "status": "accepted",
            "sequence": sequence,
            "revision": aggregate_revision,
        }
    except APIError:
        raise
    except DBAPIError as error:
        session.rollback()
        raise EventStoreUnavailable("canonical event append failed") from error


def reduce_aggregate(
    *,
    aggregate_type: str,
    event_type: str,
    prior_state: dict[str, Any],
    patch: dict[str, Any],
) -> dict[str, Any]:
    """Small deterministic reducer; payloads are patches, deletion creates a tombstone."""
    prefix = f"{aggregate_type}."
    if not event_type.startswith(prefix):
        raise ValueError("event type must match its aggregate type")
    action = event_type[len(prefix) :]
    if action not in {"created", "updated", "deleted"}:
        raise ValueError("unsupported aggregate event action")
    if action == "created":
        if prior_state:
            raise ValueError("created event cannot replace existing aggregate state")
        return {**patch, "_deleted": False}
    if action == "deleted":
        if not prior_state:
            raise ValueError("deleted event requires existing aggregate state")
        return {"_deleted": True}
    if not prior_state:
        raise ValueError("updated event requires existing aggregate state")
    if prior_state.get("_deleted") is True:
        raise ValueError("updated event cannot resurrect a deleted aggregate")
    return {**prior_state, **patch, "_deleted": False}
