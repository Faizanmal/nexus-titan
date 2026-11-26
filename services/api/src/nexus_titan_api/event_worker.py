"""NATS JetStream outbox publisher, durable projection consumer, and Firestore relay."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import nats
import psycopg
from firebase_admin import firestore
from nats.errors import TimeoutError as NatsTimeoutError
from psycopg.rows import dict_row

from .contracts import validate_contract
from .event_store import canonical_json, reduce_aggregate
from .identity import firebase_app

STREAM = "NEXUS_EVENTS"
SUBJECT = "events.*"
CONSUMER = "nexus-event-projections-v1"
LOG = logging.getLogger("nexus_titan.event_worker")
MAX_ATTEMPTS = 10


def database_dsn() -> str:
    value = os.getenv("DATABASE_URL", "")
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    return value


def safe_error_code(error: Exception) -> str:
    return type(error).__name__[:96]


def _next_backoff(attempt: int) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=min(2 ** min(attempt, 10), 900))


def pending_event_outbox(limit: int = 50) -> list[dict[str, Any]]:
    with psycopg.connect(database_dsn(), row_factory=dict_row) as connection:
        rows = connection.execute(
            """SELECT e.tenant_id,e.event_id,e.sequence,e.schema_version,e.event_type,e.source,
            e.classification,e.occurred_at,e.payload,e.site_id,e.aggregate_type,e.aggregate_id,e.aggregate_revision,
            e.correlation_id,o.attempts,o.delivery_generation
            FROM event_outbox o JOIN events e USING (tenant_id,event_id)
            WHERE o.published_at IS NULL AND o.dead_lettered_at IS NULL AND o.next_attempt_at<=now()
            ORDER BY e.tenant_id,e.sequence LIMIT %s""",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def record_publish_failure(tenant_id: str, event_id: UUID, error: Exception) -> None:
    code = safe_error_code(error)
    with psycopg.connect(database_dsn()) as connection:
        attempts = connection.execute(
            """UPDATE event_outbox SET attempts=attempts+1,next_attempt_at=%s,last_error_code=%s
            WHERE tenant_id=%s AND event_id=%s RETURNING attempts""",
            (datetime.now(UTC), code, tenant_id, event_id),
        ).fetchone()[0]
        connection.execute(
            "UPDATE event_outbox SET next_attempt_at=%s WHERE tenant_id=%s AND event_id=%s",
            (_next_backoff(attempts), tenant_id, event_id),
        )
        if attempts >= MAX_ATTEMPTS:
            connection.execute(
                "UPDATE event_outbox SET dead_lettered_at=now() WHERE tenant_id=%s AND event_id=%s",
                (tenant_id, event_id),
            )
            connection.execute(
                """INSERT INTO event_dead_letters(tenant_id,event_id,attempts,error_code)
                VALUES (%s,%s,%s,%s) ON CONFLICT (tenant_id,event_id) DO UPDATE
                SET attempts=EXCLUDED.attempts,error_code=EXCLUDED.error_code,recorded_at=now(),resolved_at=NULL""",
                (tenant_id, event_id, attempts, code),
            )
        connection.commit()


def mark_published(tenant_id: str, event_id: UUID) -> None:
    with psycopg.connect(database_dsn()) as connection:
        connection.execute(
            """UPDATE event_outbox SET published_at=COALESCE(published_at,now()),last_error_code=NULL
            WHERE tenant_id=%s AND event_id=%s""",
            (tenant_id, event_id),
        )
        connection.commit()


def event_message(row: dict[str, Any]) -> dict[str, Any]:
    result = {
        "event_id": str(row["event_id"]),
        "tenant_id": row["tenant_id"],
        "schema_version": row["schema_version"],
        "event_type": row["event_type"],
        "source": row["source"].lower(),
        "sequence": row["sequence"],
        "occurred_at": row["occurred_at"].astimezone(UTC).isoformat(),
        "classification": row["classification"].lower(),
        "payload": row["payload"],
        "site_id": row["site_id"],
        "aggregate_type": row["aggregate_type"],
        "aggregate_id": row["aggregate_id"],
        "expected_revision": row["aggregate_revision"] - 1,
    }
    if row["correlation_id"]:
        result["correlation_id"] = str(row["correlation_id"])
    return result


def projection_sequence_action(
    *, inbox_inserted: bool, incoming_sequence: int, last_sequence: int
) -> str:
    """Return apply, rebuild_skip, or gap for a durable tenant event delivery."""
    if not inbox_inserted:
        return "duplicate"
    if incoming_sequence <= last_sequence:
        return "rebuild_skip"
    if incoming_sequence != last_sequence + 1:
        return "gap"
    return "apply"


async def publish_outbox_once(js: Any, *, limit: int = 50) -> int:
    rows = pending_event_outbox(limit)
    published = 0
    for row in rows:
        event = event_message(row)
        try:
            await js.publish(
                f"events.{row['tenant_id']}",
                canonical_json(event).encode("utf-8"),
                headers={
                    "Nats-Msg-Id": f"{row['tenant_id']}:{row['event_id']}:g{row['delivery_generation']}"
                },
                timeout=5,
            )
            mark_published(row["tenant_id"], row["event_id"])
            published += 1
        except Exception as error:  # noqa: BLE001
            LOG.warning(
                "event_publish_failed tenant=%s event_id=%s error_code=%s",
                row["tenant_id"],
                row["event_id"],
                safe_error_code(error),
            )
            record_publish_failure(row["tenant_id"], row["event_id"], error)
    return published


def apply_projection_message(event: dict[str, Any]) -> None:
    tenant_id = event["tenant_id"]
    event_id = UUID(event["event_id"])
    aggregate_key = (
        tenant_id,
        event["site_id"],
        event["aggregate_type"],
        event["aggregate_id"],
    )
    with psycopg.connect(database_dsn()) as connection:
        with connection.transaction():
            inbox = connection.execute(
                """INSERT INTO event_inbox(consumer,tenant_id,event_id)
                VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING event_id""",
                (CONSUMER, tenant_id, event_id),
            ).fetchone()
            cursor = connection.execute(
                "SELECT last_sequence FROM projection_cursors WHERE tenant_id=%s FOR UPDATE",
                (tenant_id,),
            ).fetchone()
            if cursor is None:
                raise RuntimeError("projection tenant cursor missing")
            last_sequence = int(cursor[0])
            incoming_sequence = int(event["sequence"])
            action = projection_sequence_action(
                inbox_inserted=bool(inbox),
                incoming_sequence=incoming_sequence,
                last_sequence=last_sequence,
            )
            if action in {"duplicate", "rebuild_skip"}:
                # A tenant rebuild may have folded canonical events before their
                # queued JetStream deliveries arrive; inbox insertion makes them ACK-safe.
                return
            if action == "gap":
                raise RuntimeError("projection sequence gap")
            existing = connection.execute(
                """SELECT revision,last_sequence,classification,state FROM aggregate_projections
                WHERE tenant_id=%s AND site_id=%s AND aggregate_type=%s AND aggregate_id=%s FOR UPDATE""",
                aggregate_key,
            ).fetchone()
            if inbox:
                actual_revision = int(existing[0]) if existing else 0
                incoming_revision = int(event["expected_revision"]) + 1
                if actual_revision + 1 != incoming_revision:
                    raise RuntimeError("projection revision gap")
                prior_state = existing[3] if existing else {}
                state = reduce_aggregate(
                    aggregate_type=event["aggregate_type"],
                    event_type=event["event_type"],
                    prior_state=prior_state,
                    patch=event["payload"],
                )
                prior_classification = existing[2] if existing else "PUBLIC"
                ranks = {"PUBLIC": 0, "INTERNAL": 1, "CONFIDENTIAL": 2, "RESTRICTED": 3}
                classification = max(
                    prior_classification,
                    event["classification"].upper(),
                    key=ranks.__getitem__,
                )
                connection.execute(
                    """INSERT INTO aggregate_projections
                    (tenant_id,site_id,aggregate_type,aggregate_id,revision,last_sequence,classification,state)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (tenant_id,site_id,aggregate_type,aggregate_id) DO UPDATE SET
                    revision=EXCLUDED.revision,last_sequence=EXCLUDED.last_sequence,
                    classification=EXCLUDED.classification,state=EXCLUDED.state,updated_at=now()""",
                    (
                        *aggregate_key,
                        incoming_revision,
                        event["sequence"],
                        classification,
                        json.dumps(state, allow_nan=False),
                    ),
                )
                connection.execute(
                    "INSERT INTO projection_outbox(tenant_id,event_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                    (tenant_id, event_id),
                )
                connection.execute(
                    "UPDATE projection_cursors SET last_sequence=%s,updated_at=now() WHERE tenant_id=%s",
                    (incoming_sequence, tenant_id),
                )


def pending_projection_outbox(limit: int = 50) -> list[dict[str, Any]]:
    with psycopg.connect(database_dsn(), row_factory=dict_row) as connection:
        return [
            dict(row)
            for row in connection.execute(
                """SELECT o.tenant_id,o.event_id,p.site_id,p.aggregate_type,p.aggregate_id,
            p.revision,p.last_sequence,p.classification,p.state
            FROM projection_outbox o JOIN events e USING (tenant_id,event_id)
            JOIN aggregate_projections p ON p.tenant_id=e.tenant_id AND p.site_id=e.site_id
                AND p.aggregate_type=e.aggregate_type AND p.aggregate_id=e.aggregate_id
            WHERE o.published_at IS NULL AND o.dead_lettered_at IS NULL AND o.next_attempt_at<=now()
            ORDER BY e.tenant_id,e.sequence LIMIT %s""",
                (limit,),
            ).fetchall()
        ]


def projection_document(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "projection_kind": "event-state-v1",
        "tenant_id": row["tenant_id"],
        "site_id": row["site_id"],
        "aggregate_type": row["aggregate_type"],
        "aggregate_id": row["aggregate_id"],
        "revision": row["revision"],
        "last_sequence": row["last_sequence"],
        "classification": row["classification"],
        "state": row["state"],
    }


def sync_firestore_projection(row: dict[str, Any]) -> None:
    store = firestore.client(app=firebase_app())
    key = hashlib.sha256(
        f"{row['aggregate_type']}:{row['aggregate_id']}".encode()
    ).hexdigest()
    reference = (
        store.collection("organizations")
        .document(row["tenant_id"])
        .collection("sites")
        .document(row["site_id"])
        .collection("projections")
        .document(key)
    )

    @firestore.transactional
    def write_monotonic(transaction: Any) -> None:
        current = reference.get(transaction=transaction)
        current_data = current.to_dict() if current.exists else None
        if current_data and (
            int(current_data.get("last_sequence", 0)) > int(row["last_sequence"])
            or (
                int(current_data.get("last_sequence", 0)) == int(row["last_sequence"])
                and int(current_data.get("revision", 0)) > int(row["revision"])
            )
        ):
            return
        if row["classification"] != "PUBLIC" or row["state"].get("_deleted") is True:
            if current.exists:
                transaction.delete(reference)
            return
        transaction.set(reference, projection_document(row))

    write_monotonic(store.transaction())


def mark_projection_published(tenant_id: str, event_id: UUID) -> None:
    with psycopg.connect(database_dsn()) as connection:
        connection.execute(
            "UPDATE projection_outbox SET published_at=COALESCE(published_at,now()),last_error_code=NULL WHERE tenant_id=%s AND event_id=%s",
            (tenant_id, event_id),
        )
        connection.commit()


def record_projection_failure(tenant_id: str, event_id: UUID, error: Exception) -> None:
    code = safe_error_code(error)
    with psycopg.connect(database_dsn()) as connection:
        attempts = connection.execute(
            "UPDATE projection_outbox SET attempts=attempts+1,last_error_code=%s WHERE tenant_id=%s AND event_id=%s RETURNING attempts",
            (code, tenant_id, event_id),
        ).fetchone()[0]
        connection.execute(
            "UPDATE projection_outbox SET next_attempt_at=%s WHERE tenant_id=%s AND event_id=%s",
            (_next_backoff(attempts), tenant_id, event_id),
        )
        if attempts >= MAX_ATTEMPTS:
            connection.execute(
                "UPDATE projection_outbox SET dead_lettered_at=now() WHERE tenant_id=%s AND event_id=%s",
                (tenant_id, event_id),
            )
            connection.execute(
                "UPDATE event_outbox SET dead_lettered_at=now() WHERE tenant_id=%s AND event_id=%s",
                (tenant_id, event_id),
            )
            connection.execute(
                """INSERT INTO event_dead_letters(tenant_id,event_id,attempts,error_code)
                VALUES (%s,%s,%s,%s) ON CONFLICT (tenant_id,event_id) DO UPDATE
                SET attempts=EXCLUDED.attempts,error_code=EXCLUDED.error_code,recorded_at=now(),resolved_at=NULL""",
                (tenant_id, event_id, attempts, code),
            )
        connection.commit()


def publish_firestore_once(limit: int = 50) -> int:
    if os.getenv("FIRESTORE_PROJECTIONS_ENABLED", "false").lower() not in {
        "1",
        "true",
        "yes",
    }:
        return 0
    rows = pending_projection_outbox(limit)
    published = 0
    for row in rows:
        try:
            sync_firestore_projection(row)
            mark_projection_published(row["tenant_id"], row["event_id"])
            published += 1
        except Exception as error:  # noqa: BLE001
            LOG.warning(
                "firestore_projection_failed tenant=%s event_id=%s error_code=%s",
                row["tenant_id"],
                row["event_id"],
                safe_error_code(error),
            )
            record_projection_failure(row["tenant_id"], row["event_id"], error)
    return published


async def ensure_stream(js: Any) -> None:
    try:
        await js.stream_info(STREAM)
    except Exception:  # noqa: BLE001
        await js.add_stream(name=STREAM, subjects=[SUBJECT])


async def process_message(message: Any) -> None:
    metadata = message.metadata
    try:
        event = json.loads(message.data)
        if not isinstance(event, dict) or validate_contract("SyncEvent", event):
            raise ValueError("invalid event wire contract")
        apply_projection_message(event)
        await message.ack()
    except Exception as error:  # noqa: BLE001
        if metadata.num_delivered >= MAX_ATTEMPTS:
            tenant_id = "unknown"
            event_id = None
            try:
                broken = json.loads(message.data)
                tenant_id = broken["tenant_id"]
                event_id = UUID(broken["event_id"])
            except (KeyError, ValueError, TypeError):
                pass
            if event_id:
                with psycopg.connect(database_dsn()) as connection:
                    connection.execute(
                        "UPDATE event_outbox SET dead_lettered_at=now() WHERE tenant_id=%s AND event_id=%s",
                        (tenant_id, event_id),
                    )
                    connection.execute(
                        "UPDATE projection_outbox SET dead_lettered_at=now() WHERE tenant_id=%s AND event_id=%s",
                        (tenant_id, event_id),
                    )
                    connection.execute(
                        """INSERT INTO event_dead_letters(tenant_id,event_id,attempts,error_code)
                        VALUES (%s,%s,%s,%s) ON CONFLICT (tenant_id,event_id) DO UPDATE
                        SET attempts=EXCLUDED.attempts,error_code=EXCLUDED.error_code,recorded_at=now(),resolved_at=NULL""",
                        (
                            tenant_id,
                            event_id,
                            metadata.num_delivered,
                            safe_error_code(error),
                        ),
                    )
                    connection.commit()
                await message.term()
            else:
                await message.term()
            return
        await message.nak(delay=5)


async def run_worker(*, once: bool = False) -> None:
    connection = await nats.connect(os.getenv("NATS_URL", "nats://127.0.0.1:4222"))
    js = connection.jetstream()
    await ensure_stream(js)
    subscription = await js.pull_subscribe(SUBJECT, durable=CONSUMER, stream=STREAM)
    while True:
        await publish_outbox_once(js)
        await publish_firestore_once()
        try:
            messages = await subscription.fetch(batch=1, timeout=1)
            for message in messages:
                await process_message(message)
        except NatsTimeoutError:
            pass
        if once:
            break
    await connection.drain()


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--once", action="store_true", help="run one bounded relay/consumer cycle"
    )
    args = parser.parse_args()
    asyncio.run(run_worker(once=args.once))


if __name__ == "__main__":
    main()
