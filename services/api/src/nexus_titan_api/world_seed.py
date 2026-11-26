"""Idempotently seed TITAN-WTP-01 as canonical synthetic asset events."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import text
from sqlalchemy.orm import Session

from .contracts import validate_contract
from .database import database_url, engine_for
from .event_store import append_precondition_result, canonical_hash, canonical_json
from .knowledge import EMBEDDING_PROVIDER, fixture_embedding, paragraph_chunks
from .models import Organization, Site

TENANT_ID = "demo-nexus"
FIXTURE_ID = "TITAN-WTP-01"
SITE_ID = "titan-wtp-01"
NAMESPACE = UUID("8d4585fe-1ed4-4ee3-a33a-9d2b2f215001")


def fixture_root() -> Path:
    configured = os.getenv("WORLD_FIXTURE_DIR")
    if configured:
        return Path(configured)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "tests/fixtures/world" / FIXTURE_ID
        if candidate.is_dir():
            return candidate
    raise RuntimeError("TITAN-WTP-01 fixture bundle is not installed")


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_bundle() -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    root = fixture_root()
    world = json.loads((root / "world.json").read_text(encoding="utf-8"))
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if world["fixture_id"] != FIXTURE_ID or manifest["fixture_id"] != FIXTURE_ID:
        raise RuntimeError("Fixture identity mismatch")
    if manifest["dataset_sha256"] != _canonical_hash(world):
        raise RuntimeError("Fixture dataset hash does not match its manifest")
    documents = {}
    for path in sorted((root / "manuals").glob("*.md")):
        documents[path.stem] = path.read_text(encoding="utf-8")
    return world, manifest, documents


def _ensure_local_scope(session: Session) -> None:
    if os.getenv("APP_ENV") != "local":
        raise RuntimeError("Synthetic world seeding is restricted to APP_ENV=local")
    organization = session.get(Organization, TENANT_ID)
    if organization is None:
        raise RuntimeError("Demo organization must exist before world fixture seeding")
    site = session.get(Site, SITE_ID)
    if site is None:
        session.add(
            Site(
                id=SITE_ID,
                organization_id=TENANT_ID,
                name="TITAN-WTP-01 synthetic fixture",
            )
        )
        session.commit()
    elif site.organization_id != TENANT_ID:
        raise RuntimeError("Fixture site ID is already owned by a different tenant")


def _seed_documents(
    session: Session,
    documents: dict[str, str],
    world: dict[str, Any],
    source_version: str,
) -> int:
    ids_by_type: dict[str, list[str]] = {}
    for asset in world["assets"]:
        ids_by_type.setdefault(asset["asset_type"], []).append(asset["asset_id"])
    type_for_doc = {
        "manual-synthetic-pumps": "pump",
        "manual-synthetic-filtration": "filter",
        "manual-synthetic-storage": "tank",
    }
    for document_id, content in documents.items():
        asset_type = type_for_doc.get(document_id)
        if asset_type is None:
            raise RuntimeError("Fixture bundle contains an unregistered document ID")
        title = content.splitlines()[0].removeprefix("# ")[:240]
        metadata = {
            "document_id": document_id,
            "fixture_id": FIXTURE_ID,
            "title": title,
            "license": "CC0-1.0",
            "source": "synthetic_fixture",
            "classification": "public",
            "asset_ids": ids_by_type[asset_type],
            "fixture_only": True,
        }
        if validate_contract("WorldDocumentMetadata", metadata):
            raise RuntimeError(
                "Fixture document metadata failed its v1.2.0 wire contract"
            )
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        existing = (
            session.execute(
                text(
                    "SELECT content_sha256,revoked_at FROM knowledge_document_versions WHERE tenant_id=:tenant AND document_id=:document AND source_version=:version"
                ),
                {
                    "tenant": TENANT_ID,
                    "document": document_id,
                    "version": source_version,
                },
            )
            .mappings()
            .first()
        )
        if existing and (
            existing["content_sha256"] != digest or existing["revoked_at"] is not None
        ):
            raise RuntimeError(
                "A source version is immutable and revoked versions cannot be reactivated"
            )
        session.execute(
            text(
                "UPDATE knowledge_document_versions SET is_current=false WHERE tenant_id=:tenant AND site_id=:site AND document_id=:document AND source_version<>:version AND is_current"
            ),
            {
                "tenant": TENANT_ID,
                "site": SITE_ID,
                "document": document_id,
                "version": source_version,
            },
        )
        session.execute(
            text("""INSERT INTO knowledge_document_versions
            (tenant_id,site_id,document_id,source_version,fixture_id,title,content_sha256,classification,license,source,metadata,is_current)
            VALUES (:tenant,:site,:document,:version,:fixture,:title,:digest,'PUBLIC','CC0-1.0','synthetic_fixture',CAST(:metadata AS jsonb),true)
            ON CONFLICT (tenant_id,document_id,source_version) DO NOTHING"""),
            {
                "tenant": TENANT_ID,
                "site": SITE_ID,
                "document": document_id,
                "version": source_version,
                "fixture": FIXTURE_ID,
                "title": title,
                "digest": digest,
                "metadata": json.dumps(
                    {**metadata, "source_version": source_version},
                    allow_nan=False,
                    sort_keys=True,
                ),
            },
        )
        session.execute(
            text(
                "UPDATE knowledge_document_versions SET is_current=true WHERE tenant_id=:tenant AND document_id=:document AND source_version=:version AND revoked_at IS NULL"
            ),
            {"tenant": TENANT_ID, "document": document_id, "version": source_version},
        )
        session.execute(
            text(
                """INSERT INTO world_documents
            (tenant_id,site_id,document_id,fixture_id,title,content,classification,license,source,content_sha256,metadata)
            VALUES (:tenant,:site,:document,:fixture,:title,:content,'PUBLIC','CC0-1.0','synthetic_fixture',:digest,CAST(:metadata AS jsonb))
            ON CONFLICT (tenant_id,document_id) DO UPDATE SET
            site_id=EXCLUDED.site_id,title=EXCLUDED.title,content=EXCLUDED.content,
            classification=EXCLUDED.classification,license=EXCLUDED.license,source=EXCLUDED.source,
            content_sha256=EXCLUDED.content_sha256,metadata=EXCLUDED.metadata,updated_at=now()"""
            ),
            {
                "tenant": TENANT_ID,
                "site": SITE_ID,
                "document": document_id,
                "fixture": FIXTURE_ID,
                "title": title,
                "content": content,
                "digest": digest,
                "metadata": json.dumps(metadata, allow_nan=False, sort_keys=True),
            },
        )
        chunks = paragraph_chunks(content)
        for index, (start, end, chunk) in enumerate(chunks):
            chunk_meta = {
                "fixture_id": FIXTURE_ID,
                "document_id": document_id,
                "chunk_index": index,
                "asset_type": asset_type,
            }
            session.execute(
                text(
                    """INSERT INTO world_document_chunks(tenant_id,document_id,chunk_index,content,metadata)
                VALUES (:tenant,:document,:index,:content,CAST(:metadata AS jsonb))
                ON CONFLICT (tenant_id,document_id,chunk_index) DO UPDATE SET content=EXCLUDED.content,metadata=EXCLUDED.metadata"""
                ),
                {
                    "tenant": TENANT_ID,
                    "document": document_id,
                    "index": index,
                    "content": chunk,
                    "metadata": json.dumps(chunk_meta, sort_keys=True),
                },
            )
            chunk_digest = hashlib.sha256(chunk.encode("utf-8")).hexdigest()
            session.execute(
                text(
                    """INSERT INTO knowledge_chunks
                (tenant_id,site_id,document_id,source_version,chunk_index,start_offset,end_offset,content,content_sha256)
                VALUES (:tenant,:site,:document,:version,:index,:start,:end,:content,:digest)
                ON CONFLICT (tenant_id,document_id,source_version,chunk_index) DO NOTHING"""
                ),
                {
                    "tenant": TENANT_ID,
                    "site": SITE_ID,
                    "document": document_id,
                    "version": source_version,
                    "index": index,
                    "start": start,
                    "end": end,
                    "content": chunk,
                    "digest": chunk_digest,
                },
            )
            vector = (
                "["
                + ",".join(f"{value:.8f}" for value in fixture_embedding(chunk))
                + "]"
            )
            session.execute(
                text(
                    """INSERT INTO knowledge_embeddings
                (tenant_id,site_id,document_id,source_version,chunk_index,embedding,provider)
                VALUES (:tenant,:site,:document,:version,:index,CAST(:embedding AS vector),:provider)
                ON CONFLICT (tenant_id,document_id,source_version,chunk_index) DO NOTHING"""
                ),
                {
                    "tenant": TENANT_ID,
                    "site": SITE_ID,
                    "document": document_id,
                    "version": source_version,
                    "index": index,
                    "embedding": vector,
                    "provider": EMBEDDING_PROVIDER,
                },
            )
    return len(documents)


def seed_world() -> dict[str, Any]:
    world, manifest, documents = _load_bundle()
    for asset in world["assets"]:
        violations = validate_contract("WorldAsset", asset)
        if violations:
            raise RuntimeError("Fixture asset failed its v1.2.0 wire contract")
    engine = engine_for(database_url())
    inserted = duplicates = 0
    with Session(engine, expire_on_commit=False) as session:
        _ensure_local_scope(session)
        session.execute(
            text(
                "INSERT INTO tenants(tenant_id) VALUES (:tenant) ON CONFLICT DO NOTHING"
            ),
            {"tenant": TENANT_ID},
        )
        session.commit()
        with session.begin():
            head = session.execute(
                text(
                    "SELECT last_sequence FROM tenants WHERE tenant_id=:tenant FOR UPDATE"
                ),
                {"tenant": TENANT_ID},
            ).scalar_one()
            session.execute(
                text(
                    """INSERT INTO world_fixture_seeds(tenant_id,fixture_id,dataset_sha256,seed_sequence_start,asset_count)
                VALUES (:tenant,:fixture,:digest,:start,:count) ON CONFLICT (tenant_id,fixture_id) DO NOTHING"""
                ),
                {
                    "tenant": TENANT_ID,
                    "fixture": FIXTURE_ID,
                    "digest": manifest["dataset_sha256"],
                    "start": int(head),
                    "count": len(world["assets"]),
                },
            )
            state = session.execute(
                text(
                    "SELECT dataset_sha256,seed_sequence_start,asset_count FROM world_fixture_seeds WHERE tenant_id=:tenant AND fixture_id=:fixture FOR UPDATE"
                ),
                {"tenant": TENANT_ID, "fixture": FIXTURE_ID},
            ).one()
            if state.dataset_sha256 != manifest[
                "dataset_sha256"
            ] or state.asset_count != len(world["assets"]):
                raise RuntimeError(
                    "A different TITAN-WTP-01 dataset is already registered for this tenant"
                )
            sequence_start = int(state.seed_sequence_start)
            head_sequence = int(head)
            for index, asset in enumerate(world["assets"]):
                event = {
                    "event_id": str(
                        uuid5(NAMESPACE, f"{FIXTURE_ID}:{asset['asset_id']}:created")
                    ),
                    "tenant_id": TENANT_ID,
                    "schema_version": "1.2.0",
                    "event_type": "asset.created",
                    "source": "api",
                    "sequence": sequence_start + index + 1,
                    "occurred_at": "2026-01-01T00:00:00Z",
                    "classification": "public",
                    "site_id": SITE_ID,
                    "aggregate_type": "asset",
                    "aggregate_id": asset["asset_id"],
                    "expected_revision": 0,
                    "payload": asset,
                }
                if validate_contract("Event", event):
                    raise RuntimeError("Fixture event failed its v1.2.0 wire contract")
                event["sequence"] = sequence_start + index + 1
                payload_hash = canonical_hash(event)
                prior = session.execute(
                    text(
                        "SELECT sequence,payload_hash FROM events WHERE tenant_id=:tenant AND event_id=:event_id"
                    ),
                    {
                        "tenant": TENANT_ID,
                        "event_id": UUID(event["event_id"]),
                    },
                ).first()
                aggregate = session.execute(
                    text(
                        """SELECT revision FROM aggregate_heads WHERE tenant_id=:tenant AND site_id=:site
                    AND aggregate_type='asset' AND aggregate_id=:asset_id FOR UPDATE"""
                    ),
                    {
                        "tenant": TENANT_ID,
                        "site": SITE_ID,
                        "asset_id": asset["asset_id"],
                    },
                ).first()
                conflict = append_precondition_result(
                    event_id=event["event_id"],
                    payload_hash=payload_hash,
                    existing_hash=(
                        bytes(prior.payload_hash)
                        if prior and prior.payload_hash is not None
                        else None
                    ),
                    existing_sequence=int(prior.sequence) if prior else None,
                    last_sequence=head_sequence,
                    event_sequence=int(event["sequence"]),
                    expected_revision=0,
                    actual_revision=int(aggregate.revision) if aggregate else 0,
                )
                if conflict:
                    if conflict["status"] == "duplicate":
                        duplicates += 1
                        continue
                    raise RuntimeError(
                        f"World fixture append conflict: {conflict.get('code', 'CONFLICT')}"
                    )
                session.execute(
                    text("""INSERT INTO events
                    (tenant_id,event_id,sequence,schema_version,event_type,source,classification,occurred_at,payload,
                     site_id,aggregate_type,aggregate_id,aggregate_revision,correlation_id,device_id,payload_hash)
                    VALUES (:tenant,:event_id,:sequence,:schema,'asset.created','API','PUBLIC',:occurred_at,CAST(:payload AS jsonb),
                     :site,'asset',:asset_id,1,NULL,NULL,:payload_hash)"""),
                    {
                        "tenant": TENANT_ID,
                        "event_id": UUID(event["event_id"]),
                        "sequence": event["sequence"],
                        "schema": event["schema_version"],
                        "occurred_at": datetime.fromisoformat(
                            event["occurred_at"].replace("Z", "+00:00")
                        ),
                        "payload": canonical_json(event["payload"]),
                        "site": SITE_ID,
                        "asset_id": asset["asset_id"],
                        "payload_hash": payload_hash,
                    },
                )
                session.execute(
                    text(
                        "INSERT INTO event_outbox(tenant_id,event_id) VALUES (:tenant,:event_id)"
                    ),
                    {
                        "tenant": TENANT_ID,
                        "event_id": UUID(event["event_id"]),
                    },
                )
                session.execute(
                    text(
                        """INSERT INTO aggregate_heads(tenant_id,site_id,aggregate_type,aggregate_id,revision,last_sequence)
                    VALUES (:tenant,:site,'asset',:asset_id,1,:sequence)"""
                    ),
                    {
                        "tenant": TENANT_ID,
                        "site": SITE_ID,
                        "asset_id": asset["asset_id"],
                        "sequence": event["sequence"],
                    },
                )
                head_sequence = int(event["sequence"])
                inserted += 1
            session.execute(
                text(
                    "UPDATE tenants SET last_sequence=:sequence WHERE tenant_id=:tenant"
                ),
                {"sequence": head_sequence, "tenant": TENANT_ID},
            )
            document_count = _seed_documents(
                session, documents, world, manifest["fixture_version"]
            )
            session.execute(
                text(
                    "UPDATE world_fixture_seeds SET complete=true,seeded_at=now() WHERE tenant_id=:tenant AND fixture_id=:fixture"
                ),
                {"tenant": TENANT_ID, "fixture": FIXTURE_ID},
            )
    return {
        "tenant_id": TENANT_ID,
        "fixture_id": FIXTURE_ID,
        "assets": len(world["assets"]),
        "inserted": inserted,
        "duplicates": duplicates,
        "documents": document_count,
        "dataset_sha256": manifest["dataset_sha256"],
    }


if __name__ == "__main__":
    print(json.dumps(seed_world(), sort_keys=True))
