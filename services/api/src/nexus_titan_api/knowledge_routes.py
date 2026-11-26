"""Tenant-scoped approved knowledge, citation, graph, and human-reviewed memory APIs."""

from __future__ import annotations

import json
from datetime import UTC
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .identity_routes import ADMIN_ROLES, require_membership
from .knowledge import (
    EMBEDDING_PROVIDER,
    assemble_context,
    citation_ref,
    cosine,
    fixture_embedding,
    lexical_score,
    rank_candidates,
)
from .world_graph import query_graph
from .world_routes import _authorize_site

router = APIRouter(prefix="/v1/knowledge", tags=["knowledge"])


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


@router.get("/documents")
def list_documents(
    tenant_id: str,
    site_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    rows = (
        session.execute(
            text(
                """SELECT document_id,source_version,title,classification,license,source,fixture_id,content_sha256,created_at
        FROM knowledge_document_versions WHERE tenant_id=:tenant AND site_id=:site AND classification=ANY(:classes)
        AND is_current AND revoked_at IS NULL ORDER BY title,document_id"""
            ),
            {"tenant": tenant_id, "site": site_id, "classes": classifications},
        )
        .mappings()
        .all()
    )
    return {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "documents": [dict(row) for row in rows],
    }


@router.get("/documents/{document_id}")
def get_document(
    document_id: str,
    tenant_id: str,
    site_id: str,
    source_version: str | None = None,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    row = (
        session.execute(
            text(
                """SELECT d.document_id,d.source_version,d.title,d.license,d.source,d.fixture_id,d.classification,d.content_sha256,d.is_current,d.revoked_at,
        string_agg(c.content,chr(10)||chr(10) ORDER BY c.chunk_index) AS content
        FROM knowledge_document_versions d JOIN knowledge_chunks c USING(tenant_id,site_id,document_id,source_version)
        WHERE d.tenant_id=:tenant AND d.site_id=:site AND d.document_id=:document AND d.classification=ANY(:classes)
        AND d.is_current AND d.revoked_at IS NULL AND (:version IS NULL OR d.source_version=:version)
        GROUP BY d.document_id,d.source_version,d.title,d.license,d.source,d.fixture_id,d.classification,d.content_sha256,d.is_current,d.revoked_at"""
            ),
            {
                "tenant": tenant_id,
                "site": site_id,
                "document": document_id,
                "classes": classifications,
                "version": source_version,
            },
        )
        .mappings()
        .first()
    )
    if not row:
        raise APIError(
            "DOCUMENT_NOT_FOUND", 404, "Current approved document was not found."
        )
    return {**dict(row), "tenant_id": tenant_id, "site_id": site_id, "stale": False}


@router.get("/search")
def search_knowledge(
    tenant_id: str,
    site_id: str,
    q: str = Query(min_length=2, max_length=512),
    top_k: int = Query(default=5, ge=1, le=20),
    document_id: str | None = Query(default=None, max_length=128),
    asset_id: str | None = Query(default=None, max_length=128),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    query_vector = _vector_literal(fixture_embedding(q))
    conditions = "d.tenant_id=:tenant AND d.site_id=:site AND d.classification=ANY(:classes) AND d.is_current AND d.revoked_at IS NULL"
    params: dict = {
        "tenant": tenant_id,
        "site": site_id,
        "classes": classifications,
        "query": q,
        "query_vector": query_vector,
        "limit": 100,
    }
    if document_id:
        conditions += " AND d.document_id=:document"
        params["document"] = document_id
    lexical = (
        session.execute(
            text(
                f"""SELECT d.document_id,d.source_version,d.title,d.license,d.source,d.fixture_id,d.metadata,
        c.chunk_index,c.start_offset,c.end_offset,c.content,c.content_sha256,e.embedding::text AS embedding,e.provider AS embedding_provider,
        ts_rank_cd(to_tsvector('english',c.content),websearch_to_tsquery('english',:query)) AS db_lexical
        FROM knowledge_document_versions d JOIN knowledge_chunks c USING(tenant_id,site_id,document_id,source_version)
        JOIN knowledge_embeddings e USING(tenant_id,site_id,document_id,source_version,chunk_index)
        WHERE {conditions} ORDER BY db_lexical DESC,c.document_id,c.chunk_index LIMIT :limit"""
            ),
            params,
        )
        .mappings()
        .all()
    )
    vector_rows = (
        session.execute(
            text(
                f"""SELECT d.document_id,d.source_version,d.title,d.license,d.source,d.fixture_id,d.metadata,
        c.chunk_index,c.start_offset,c.end_offset,c.content,c.content_sha256,e.embedding::text AS embedding,e.provider AS embedding_provider
        FROM knowledge_document_versions d JOIN knowledge_chunks c USING(tenant_id,site_id,document_id,source_version)
        JOIN knowledge_embeddings e USING(tenant_id,site_id,document_id,source_version,chunk_index)
        WHERE {conditions} ORDER BY e.embedding <=> CAST(:query_vector AS vector) LIMIT :limit"""
            ),
            params,
        )
        .mappings()
        .all()
    )
    candidates: dict[tuple[str, str, int], dict] = {}
    for row in [*lexical, *vector_rows]:
        item = dict(row)
        item["embedding"] = [float(x) for x in item["embedding"].strip("[]").split(",")]
        item["embedding_provider"] = str(item["embedding_provider"])
        item["db_lexical_score"] = float(item.get("db_lexical", 0.0))
        candidates[
            (item["document_id"], item["source_version"], item["chunk_index"])
        ] = item
    related: set[str] = set()
    graph_status = "not_requested"
    if asset_id:
        try:
            graph = query_graph(
                tenant_id, site_id, "dependencies", asset_id, depth=2, limit=100
            )
            related = {
                node["asset_id"] for node in graph["nodes"] if node.get("asset_id")
            }
            related.add(asset_id)
            graph_status = "available"
        except Exception as error:  # noqa: BLE001
            # Text/vector retrieval remains useful, but the missing graph relation is explicit.
            graph_status = f"unavailable:{type(error).__name__}"
    rows = list(candidates.values())
    for row in rows:
        asset_ids = set((row.get("metadata") or {}).get("asset_ids", []))
        row["graph_score"] = 1.0 if related and asset_ids.intersection(related) else 0.0
    ranked = rank_candidates(q, rows, top_k=top_k)
    results = []
    for row in ranked:
        cite = citation_ref(row)
        results.append(
            {
                "title": row["title"],
                "license": row["license"],
                "source": row["source"],
                "fixture_id": row["fixture_id"],
                "snippet": row["content"],
                "score": row["score"],
                "lexical_score": row["lexical_score"],
                "vector_score": row["vector_score"],
                "graph_score": row["graph_score"],
                "embedding_provider": row["embedding_provider"],
                "citation": cite,
                "citation_url": f"/v1/knowledge/citations/{cite['document_id']}/{cite['source_version']}/{cite['chunk_index']}?sha256={cite['content_sha256']}&tenant_id={tenant_id}&site_id={site_id}",
            }
        )
    event_rows = (
        session.execute(
            text(
                """SELECT event_id,event_type,aggregate_id,sequence,occurred_at,classification,payload::text AS content
        FROM events WHERE tenant_id=:tenant AND site_id=:site AND classification=ANY(:classes)
        ORDER BY sequence DESC LIMIT 200"""
            ),
            {"tenant": tenant_id, "site": site_id, "classes": classifications},
        )
        .mappings()
        .all()
    )
    query_vec = fixture_embedding(q)
    event_results = []
    for event in event_rows:
        item = dict(event)
        lexical = lexical_score(
            q, item["content"] + " " + item["event_type"] + " " + item["aggregate_id"]
        )
        if lexical <= 0:
            continue
        vector_score = cosine(query_vec, fixture_embedding(item["content"]))
        graph_score = 1.0 if related and item["aggregate_id"] in related else 0.0
        score = 0.65 * lexical + 0.25 * max(vector_score, 0) + 0.10 * graph_score
        item.update(
            {
                "kind": "event",
                "score": round(score, 6),
                "lexical_score": round(lexical, 6),
                "vector_score": round(vector_score, 6),
                "graph_score": graph_score,
                "embedding_provider": EMBEDDING_PROVIDER,
            }
        )
        event_results.append(item)
    event_results.sort(
        key=lambda item: (-item["score"], -item["sequence"], str(item["event_id"]))
    )
    event_results = event_results[:top_k]
    memory_rows = (
        session.execute(
            text(
                """SELECT id,subject,fact,conflict_group,revision,state,verified_by,provenance,created_at
        FROM knowledge_memory_facts WHERE tenant_id=:tenant AND site_id=:site AND classification=ANY(:classes)
        AND state IN ('current','disputed') ORDER BY revision DESC LIMIT 200"""
            ),
            {"tenant": tenant_id, "site": site_id, "classes": classifications},
        )
        .mappings()
        .all()
    )
    memory_results = []
    for memory in memory_rows:
        item = dict(memory)
        item["content"] = f"{item['subject']}: {item['fact']}"
        lexical = lexical_score(q, item["content"])
        if lexical <= 0:
            continue
        item.update(
            {
                "kind": "memory",
                "score": round(lexical, 6),
                "lexical_score": round(lexical, 6),
            }
        )
        memory_results.append(item)
    memory_results.sort(
        key=lambda item: (-item["score"], -item["revision"], str(item["id"]))
    )
    memory_results = memory_results[:top_k]
    context_rows = sorted(
        [*ranked, *event_results, *memory_results],
        key=lambda item: (
            -item["score"],
            str(item.get("document_id", item.get("event_id", item.get("id")))),
        ),
    )
    return {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "query": q,
        "results": results,
        "event_results": [
            {
                "event_id": str(item["event_id"]),
                "event_type": item["event_type"],
                "aggregate_id": item["aggregate_id"],
                "sequence": item["sequence"],
                "occurred_at": item["occurred_at"],
                "snippet": item["content"][:1600],
                "score": item["score"],
                "embedding_provider": item["embedding_provider"],
                "citation_url": f"/v1/knowledge/events/{item['event_id']}?tenant_id={tenant_id}&site_id={site_id}",
            }
            for item in event_results
        ],
        "memory_results": [
            {
                "fact_id": str(item["id"]),
                "subject": item["subject"],
                "fact": item["fact"],
                "revision": item["revision"],
                "state": item["state"],
                "verified_by": item["verified_by"],
                "provenance": item["provenance"],
                "score": item["score"],
                "citation_url": f"/v1/knowledge/memory/{item['id']}?tenant_id={tenant_id}&site_id={site_id}",
            }
            for item in memory_results
        ],
        "context": assemble_context(q, context_rows),
        "graph_status": graph_status,
        "embedding_mode": EMBEDDING_PROVIDER,
        "embedding_is_fixture": True,
    }


@router.get("/events/{event_id}")
def resolve_event_citation(
    event_id: UUID,
    tenant_id: str,
    site_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    row = (
        session.execute(
            text(
                """SELECT event_id,event_type,aggregate_type,aggregate_id,sequence,occurred_at,classification,payload
        FROM events WHERE tenant_id=:tenant AND site_id=:site AND event_id=:id AND classification=ANY(:classes)"""
            ),
            {
                "tenant": tenant_id,
                "site": site_id,
                "id": event_id,
                "classes": classifications,
            },
        )
        .mappings()
        .first()
    )
    if not row:
        raise APIError(
            "EVENT_CITATION_NOT_FOUND", 404, "Accepted event citation was not found."
        )
    return dict(row)


@router.get("/citations/{document_id}/{source_version}/{chunk_index}")
def resolve_citation(
    document_id: str,
    source_version: str,
    chunk_index: int,
    sha256: str,
    tenant_id: str,
    site_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    row = (
        session.execute(
            text(
                """SELECT d.title,d.license,d.source,d.is_current,d.revoked_at,d.classification,d.content_sha256,
        c.content,c.content_sha256 AS chunk_sha256,c.start_offset,c.end_offset
        FROM knowledge_document_versions d JOIN knowledge_chunks c USING(tenant_id,site_id,document_id,source_version)
        WHERE d.tenant_id=:tenant AND d.site_id=:site AND d.document_id=:doc AND d.source_version=:version AND c.chunk_index=:chunk"""
            ),
            {
                "tenant": tenant_id,
                "site": site_id,
                "doc": document_id,
                "version": source_version,
                "chunk": chunk_index,
            },
        )
        .mappings()
        .first()
    )
    if row is None or row["classification"] not in classifications:
        raise APIError("CITATION_NOT_FOUND", 404, "Citation was not found.")
    if not row["is_current"] or row["revoked_at"] is not None:
        raise APIError(
            "CITATION_STALE", 410, "This source version is stale or revoked."
        )
    if row["chunk_sha256"] != sha256:
        raise APIError(
            "CITATION_HASH_MISMATCH", 409, "Citation content hash does not match."
        )
    return {
        "document_id": document_id,
        "source_version": source_version,
        "chunk_index": chunk_index,
        "start_offset": row["start_offset"],
        "end_offset": row["end_offset"],
        "title": row["title"],
        "license": row["license"],
        "source": row["source"],
        "content": row["content"],
        "content_sha256": row["chunk_sha256"],
    }


@router.post("/documents/{document_id}/{source_version}/revoke")
def revoke_document(
    document_id: str,
    source_version: str,
    tenant_id: str,
    site_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    member = require_membership(session, tenant_id, actor)
    if member.role not in ADMIN_ROLES:
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Only tenant administrators can revoke a knowledge source.",
        )
    _authorize_site(session, tenant_id, actor, site_id)
    result = session.execute(
        text(
            """UPDATE knowledge_document_versions SET revoked_at=COALESCE(revoked_at,now()),is_current=false
        WHERE tenant_id=:tenant AND site_id=:site AND document_id=:doc AND source_version=:version"""
        ),
        {
            "tenant": tenant_id,
            "site": site_id,
            "doc": document_id,
            "version": source_version,
        },
    )
    if not result.rowcount:
        raise APIError(
            "DOCUMENT_NOT_FOUND", 404, "Knowledge source version was not found."
        )
    session.execute(
        text(
            "INSERT INTO knowledge_source_audit(tenant_id,site_id,document_id,source_version,actor_id,action) VALUES(:tenant,:site,:doc,:version,:actor,'revoked')"
        ),
        {
            "tenant": tenant_id,
            "site": site_id,
            "doc": document_id,
            "version": source_version,
            "actor": actor.uid,
        },
    )
    session.commit()
    return {
        "document_id": document_id,
        "source_version": source_version,
        "revoked": True,
        "revoked_by": actor.uid,
    }


@router.get("/graph")
def read_knowledge_graph(
    tenant_id: str,
    site_id: str,
    mode: str = Query(pattern="^(asset|dependencies|incident)$"),
    identifier: str = Query(min_length=1, max_length=128),
    depth: int = Query(default=1, ge=1, le=3),
    limit: int = Query(default=40, ge=1, le=100),
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _authorize_site(session, tenant_id, actor, site_id)
    incident_assets: list[str] = []
    if mode == "incident":
        incident = (
            session.execute(
                text(
                    "SELECT state,classification FROM aggregate_projections WHERE tenant_id=:tenant AND site_id=:site AND aggregate_type='incident' AND aggregate_id=:id"
                ),
                {"tenant": tenant_id, "site": site_id, "id": identifier},
            )
            .mappings()
            .first()
        )
        if (
            not incident
            or incident["classification"] not in {"PUBLIC", "INTERNAL"}
            or incident["state"].get("_deleted") is True
        ):
            raise APIError("GRAPH_NODE_NOT_FOUND", 404, "Incident was not found.")
        incident_assets = incident["state"].get("affected_asset_ids", [])
    try:
        result = query_graph(
            tenant_id,
            site_id,
            mode,
            identifier,
            depth=depth,
            limit=limit,
            incident_assets=incident_assets,
        )
    except Exception as error:
        raise APIError(
            "GRAPH_UNAVAILABLE", 503, "Operational graph query is unavailable."
        ) from error
    return {"tenant_id": tenant_id, "site_id": site_id, **result}


class MemoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(min_length=3, max_length=63)
    site_id: str = Field(min_length=2, max_length=63)
    subject: str = Field(min_length=1, max_length=256)
    fact: str = Field(min_length=1, max_length=4000)
    provenance: list[dict] = Field(min_length=1, max_length=10)


@router.post("/memory", status_code=201)
def verify_memory_fact(
    payload: MemoryCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    member = require_membership(session, payload.tenant_id, actor)
    if member.role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN", 403, "This membership cannot verify resolution facts."
        )
    _, allowed_classifications = _authorize_site(
        session, payload.tenant_id, actor, payload.site_id
    )
    clean_sources = []
    source_classifications = []
    for source in payload.provenance:
        kind = source.get("kind")
        if kind == "document":
            row = session.execute(
                text(
                    """SELECT c.content_sha256,d.classification FROM knowledge_chunks c JOIN knowledge_document_versions d USING(tenant_id,site_id,document_id,source_version)
                WHERE c.tenant_id=:tenant AND c.site_id=:site AND c.document_id=:doc AND c.source_version=:version AND c.chunk_index=:chunk
                AND d.is_current AND d.revoked_at IS NULL AND d.classification IN ('PUBLIC','INTERNAL')"""
                ),
                {
                    "tenant": payload.tenant_id,
                    "site": payload.site_id,
                    "doc": source.get("document_id"),
                    "version": source.get("source_version"),
                    "chunk": source.get("chunk_index"),
                },
            ).first()
            if not row or row[0] != source.get("content_sha256"):
                raise APIError(
                    "PROVENANCE_INVALID",
                    422,
                    "Memory fact has a missing, stale, revoked, or mismatched document citation.",
                )
            source_classifications.append(row[1])
            clean_sources.append(
                {
                    key: source[key]
                    for key in (
                        "kind",
                        "document_id",
                        "source_version",
                        "chunk_index",
                        "content_sha256",
                    )
                }
            )
        elif kind == "event":
            try:
                event_id = UUID(str(source.get("event_id")))
            except ValueError as error:
                raise APIError(
                    "PROVENANCE_INVALID", 422, "Event provenance ID is invalid."
                ) from error
            event = (
                session.execute(
                    text(
                        "SELECT event_id,occurred_at,classification FROM events WHERE tenant_id=:tenant AND site_id=:site AND event_id=:id AND classification=ANY(:classes)"
                    ),
                    {
                        "tenant": payload.tenant_id,
                        "site": payload.site_id,
                        "id": event_id,
                        "classes": allowed_classifications,
                    },
                )
                .mappings()
                .first()
            )
            if not event:
                raise APIError(
                    "PROVENANCE_INVALID",
                    422,
                    "Event provenance is not an accepted visible event.",
                )
            source_classifications.append(event["classification"])
            clean_sources.append(
                {
                    "kind": "event",
                    "event_id": str(event["event_id"]),
                    "occurred_at": event["occurred_at"].astimezone(UTC).isoformat(),
                }
            )
        else:
            raise APIError(
                "PROVENANCE_INVALID",
                422,
                "Only current document citations or accepted event IDs can support memory.",
            )
    lock_key = (
        f"{payload.tenant_id}:{payload.site_id}:{payload.subject.strip().casefold()}"
    )
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:scope,0))"),
        {"scope": lock_key},
    )
    current = (
        session.execute(
            text(
                "SELECT id,fact,conflict_group,revision FROM knowledge_memory_facts WHERE tenant_id=:tenant AND site_id=:site AND subject=:subject AND state IN ('current','disputed') ORDER BY revision DESC"
            ),
            {
                "tenant": payload.tenant_id,
                "site": payload.site_id,
                "subject": payload.subject,
            },
        )
        .mappings()
        .all()
    )
    group = current[0]["conflict_group"] if current else uuid4()
    revision = max((row["revision"] for row in current), default=0) + 1
    state = "current"
    if current:
        if any(
            row["fact"].strip().casefold() != payload.fact.strip().casefold()
            for row in current
        ):
            state = "disputed"
            session.execute(
                text(
                    "UPDATE knowledge_memory_facts SET state='disputed' WHERE tenant_id=:tenant AND site_id=:site AND conflict_group=:group"
                ),
                {"tenant": payload.tenant_id, "site": payload.site_id, "group": group},
            )
        else:
            session.execute(
                text(
                    "UPDATE knowledge_memory_facts SET state='superseded' WHERE tenant_id=:tenant AND site_id=:site AND conflict_group=:group AND state='current'"
                ),
                {"tenant": payload.tenant_id, "site": payload.site_id, "group": group},
            )
    fact_id = uuid4()
    classification = "INTERNAL" if "INTERNAL" in source_classifications else "PUBLIC"
    session.execute(
        text(
            """INSERT INTO knowledge_memory_facts(id,tenant_id,site_id,subject,fact,classification,conflict_group,revision,state,verified_by,provenance)
        VALUES(:id,:tenant,:site,:subject,:fact,:classification,:group,:revision,:state,:actor,CAST(:provenance AS jsonb))"""
        ),
        {
            "id": fact_id,
            "tenant": payload.tenant_id,
            "site": payload.site_id,
            "subject": payload.subject,
            "fact": payload.fact,
            "classification": classification,
            "group": group,
            "revision": revision,
            "state": state,
            "actor": actor.uid,
            "provenance": json.dumps(clean_sources, sort_keys=True),
        },
    )
    session.commit()
    return {
        "fact_id": str(fact_id),
        "conflict_group": str(group),
        "revision": revision,
        "state": state,
        "verified_by": actor.uid,
        "provenance": clean_sources,
    }


@router.get("/memory")
def list_memory(
    tenant_id: str,
    site_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    rows = (
        session.execute(
            text(
                "SELECT id,subject,fact,classification,conflict_group,revision,state,verified_by,provenance,created_at FROM knowledge_memory_facts WHERE tenant_id=:tenant AND site_id=:site AND classification=ANY(:classes) ORDER BY subject,revision DESC LIMIT 200"
            ),
            {"tenant": tenant_id, "site": site_id, "classes": classifications},
        )
        .mappings()
        .all()
    )
    return {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "facts": [dict(row) for row in rows],
    }


@router.get("/memory/{fact_id}")
def resolve_memory_citation(
    fact_id: UUID,
    tenant_id: str,
    site_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict:
    _, classifications = _authorize_site(session, tenant_id, actor, site_id)
    row = (
        session.execute(
            text(
                "SELECT id,subject,fact,classification,conflict_group,revision,state,verified_by,provenance,created_at FROM knowledge_memory_facts WHERE tenant_id=:tenant AND site_id=:site AND id=:id AND classification=ANY(:classes)"
            ),
            {
                "tenant": tenant_id,
                "site": site_id,
                "id": fact_id,
                "classes": classifications,
            },
        )
        .mappings()
        .first()
    )
    if not row:
        raise APIError(
            "MEMORY_CITATION_NOT_FOUND", 404, "Verified memory citation was not found."
        )
    return dict(row)
