"""Tenant-scoped Firestore rebuild from canonical PostgreSQL projections."""

from __future__ import annotations

import argparse
import hashlib
import json
from typing import Any

import psycopg
from firebase_admin import firestore
from psycopg.rows import dict_row

from .event_store import canonical_json, reduce_aggregate
from .event_worker import database_dsn, projection_document, sync_firestore_projection
from .identity import firebase_app


def rebuild(tenant_id: str, confirmation: str) -> dict[str, Any]:
    if tenant_id != confirmation:
        raise RuntimeError("Rebuild requires --confirm to exactly match --tenant")
    with psycopg.connect(database_dsn(), row_factory=dict_row) as connection:
        with connection.transaction():
            tenant = connection.execute(
                "SELECT tenant_id FROM tenants WHERE tenant_id=%s FOR UPDATE",
                (tenant_id,),
            ).fetchone()
            if tenant is None:
                raise RuntimeError("The requested tenant does not exist")
            connection.execute(
                "SELECT last_sequence FROM projection_cursors WHERE tenant_id=%s FOR UPDATE",
                (tenant_id,),
            )
            rebuild_cursor = int(
                connection.execute(
                    "SELECT last_sequence FROM tenants WHERE tenant_id=%s", (tenant_id,)
                ).fetchone()[0]
            )
            events = connection.execute(
                """SELECT site_id,aggregate_type,aggregate_id,aggregate_revision,sequence,
                event_type,classification,payload FROM events WHERE tenant_id=%s AND aggregate_type IS NOT NULL
                ORDER BY sequence""",
                (tenant_id,),
            ).fetchall()
            rebuilt: dict[tuple[str, str, str], dict[str, Any]] = {}
            ranks = {"PUBLIC": 0, "INTERNAL": 1, "CONFIDENTIAL": 2, "RESTRICTED": 3}
            for event in events:
                key = (event["site_id"], event["aggregate_type"], event["aggregate_id"])
                prior = rebuilt.get(key)
                actual_revision = int(prior["revision"]) if prior else 0
                if int(event["aggregate_revision"]) != actual_revision + 1:
                    raise RuntimeError(
                        "Canonical aggregate event history has a revision gap"
                    )
                state = reduce_aggregate(
                    aggregate_type=event["aggregate_type"],
                    event_type=event["event_type"],
                    prior_state=prior["state"] if prior else {},
                    patch=event["payload"],
                )
                prior_classification = prior["classification"] if prior else "PUBLIC"
                rebuilt[key] = {
                    "site_id": event["site_id"],
                    "aggregate_type": event["aggregate_type"],
                    "aggregate_id": event["aggregate_id"],
                    "revision": int(event["aggregate_revision"]),
                    "last_sequence": int(event["sequence"]),
                    "classification": max(
                        prior_classification,
                        event["classification"],
                        key=ranks.__getitem__,
                    ),
                    "state": state,
                }
            connection.execute(
                "DELETE FROM aggregate_projections WHERE tenant_id=%s", (tenant_id,)
            )
            connection.executemany(
                """INSERT INTO aggregate_projections
                (tenant_id,site_id,aggregate_type,aggregate_id,revision,last_sequence,classification,state)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                [
                    (
                        tenant_id,
                        row["site_id"],
                        row["aggregate_type"],
                        row["aggregate_id"],
                        row["revision"],
                        row["last_sequence"],
                        row["classification"],
                        json.dumps(row["state"], allow_nan=False),
                    )
                    for row in rebuilt.values()
                ],
            )
            connection.execute(
                """UPDATE projection_cursors SET last_sequence=(SELECT last_sequence FROM tenants WHERE tenant_id=%s),updated_at=now()
                WHERE tenant_id=%s""",
                (tenant_id, tenant_id),
            )
            connection.execute(
                "UPDATE projection_outbox SET published_at=NULL,dead_lettered_at=NULL,attempts=0,next_attempt_at=now(),last_error_code=NULL WHERE tenant_id=%s",
                (tenant_id,),
            )
            sites = connection.execute(
                "SELECT id FROM sites WHERE organization_id=%s ORDER BY id",
                (tenant_id,),
            ).fetchall()
            rows = connection.execute(
                """SELECT tenant_id,site_id,aggregate_type,aggregate_id,revision,last_sequence,classification,state
                FROM aggregate_projections WHERE tenant_id=%s ORDER BY site_id,aggregate_type,aggregate_id""",
                (tenant_id,),
            ).fetchall()

    store = firestore.client(app=firebase_app())
    expected: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if (
            row["classification"] == "PUBLIC"
            and row["state"].get("_deleted") is not True
        ):
            digest = hashlib.sha256(
                f"{row['aggregate_type']}:{row['aggregate_id']}".encode()
            ).hexdigest()
            expected[(row["site_id"], digest)] = projection_document(dict(row))

    stale_references = []
    for site in sites:
        site_id = site["id"]
        collection = (
            store.collection("organizations")
            .document(tenant_id)
            .collection("sites")
            .document(site_id)
            .collection("projections")
        )
        for snapshot in collection.where(
            "projection_kind", "==", "event-state-v1"
        ).stream():
            if (site_id, snapshot.id) not in expected:
                stale_references.append(snapshot.reference)

    for row in rows:
        if (
            row["classification"] == "PUBLIC"
            and row["state"].get("_deleted") is not True
        ):
            sync_firestore_projection(dict(row))
    for reference in stale_references:

        @firestore.transactional
        def delete_only_if_not_newer(transaction: Any, ref: Any = reference) -> None:
            current = ref.get(transaction=transaction)
            current_data = current.to_dict() if current.exists else None
            if (
                current_data
                and int(current_data.get("last_sequence", 0)) <= rebuild_cursor
            ):
                transaction.delete(ref)

        delete_only_if_not_newer(store.transaction())

    canonical_rows = [expected[key] for key in sorted(expected)]
    checksum = hashlib.sha256(
        canonical_json(canonical_rows).encode("utf-8")
    ).hexdigest()
    return {
        "tenant_id": tenant_id,
        "projection_count": len(expected),
        "stale_deleted": len(stale_references),
        "sha256": checksum,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            rebuild(args.tenant, args.confirm), sort_keys=True, separators=(",", ":")
        )
    )


if __name__ == "__main__":
    main()
