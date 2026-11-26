"""Neo4j derived-graph projection rebuilt only from accepted Postgres asset state."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from collections import defaultdict
from typing import Any

import neo4j
import psycopg
from psycopg.rows import dict_row

from .contracts import validate_contract
from .event_store import canonical_json
from .event_worker import database_dsn

FIXTURE_ID = "TITAN-WTP-01"
SITE_ID = "titan-wtp-01"
ALLOWED_RELATIONS = {"PART_OF", "DEPENDS_ON", "FEEDS", "MONITORS", "CONTROLLED_BY"}
LOG = logging.getLogger("nexus_titan.world_graph")

NODE_UPSERT = """UNWIND $assets AS asset
MERGE (n:WorldAsset {tenant_id:$tenant_id, site_id:$site_id, asset_id:asset.asset_id})
SET n.fixture_id=$fixture_id, n.fixture_version=$fixture_version, n.graph_version=$graph_version,
    n.label=asset.label, n.asset_type=asset.asset_type, n.subsystem_id=asset.subsystem_id,
    n.critical=asset.critical, n.serial_number=asset.serial_number,
    n.measurement_unit=asset.measurement_unit, n.capacity_min=asset.capacity_constraint.minimum,
    n.capacity_max=asset.capacity_constraint.maximum, n.capacity_metric=asset.capacity_constraint.metric,
    n.capacity_unit=asset.capacity_constraint.unit, n.x=asset.position[0], n.y=asset.position[1], n.z=asset.position[2],
    n.coordinate_system=asset.coordinate_system
"""
RELATION_QUERIES = {relation: f"""UNWIND $relations AS edge
MATCH (source:WorldAsset {{tenant_id:$tenant_id,site_id:$site_id,asset_id:edge.source_asset_id}})
MATCH (target:WorldAsset {{tenant_id:$tenant_id,site_id:$site_id,asset_id:edge.target_asset_id}})
MERGE (source)-[r:{relation} {{fixture_id:$fixture_id,relation_id:edge.relation_id}}]->(target)
SET r.graph_version=$graph_version
""" for relation in sorted(ALLOWED_RELATIONS)}


def load_accepted_world(tenant_id: str, site_id: str = SITE_ID) -> dict[str, Any]:
    with psycopg.connect(database_dsn(), row_factory=dict_row) as connection:
        rows = connection.execute(
            """SELECT aggregate_id,state,classification FROM aggregate_projections
            WHERE tenant_id=%s AND site_id=%s AND aggregate_type='asset'
              AND state->>'fixture_id'=%s AND state->>'_deleted' <> 'true'
              AND classification IN ('PUBLIC','INTERNAL')
            ORDER BY aggregate_id""",
            (tenant_id, site_id, FIXTURE_ID),
        ).fetchall()
    assets = []
    for row in rows:
        asset = dict(row["state"])
        asset.pop("_deleted", None)
        if asset.get("asset_id") != row["aggregate_id"] or validate_contract(
            "WorldAsset", asset
        ):
            raise RuntimeError(
                "Accepted world asset projection does not match the published ontology schema"
            )
        # Graph projection has no need to store or inspect evidence/manual contents.
        assets.append(asset)
    visible = {asset["asset_id"] for asset in assets}
    relations = []
    for asset in assets:
        for index, dependency in enumerate(asset["dependencies"]):
            target = dependency["target_asset_id"]
            if target not in visible:
                raise RuntimeError(
                    f"Accepted fixture projection contains a dangling relation from {asset['asset_id']}"
                )
            relation_type = dependency["relation"]
            if relation_type not in ALLOWED_RELATIONS:
                raise RuntimeError(
                    "Accepted fixture projection contains an unsupported relation type"
                )
            relations.append(
                {
                    "relation_id": f"{asset['asset_id']}:{relation_type}:{index:02d}",
                    "source_asset_id": asset["asset_id"],
                    "target_asset_id": target,
                    "relation_type": relation_type,
                    "fixture_id": FIXTURE_ID,
                }
            )
    relations.sort(key=lambda item: item["relation_id"])
    if len(assets) < 100 or len({asset["asset_id"] for asset in assets}) != len(assets):
        raise RuntimeError(
            "Accepted fixture projection has an invalid asset count or duplicate IDs"
        )
    by_id = {asset["asset_id"] for asset in assets}
    adjacency: dict[str, set[str]] = {asset_id: set() for asset_id in by_id}
    for relation in relations:
        if (
            relation["source_asset_id"] not in by_id
            or relation["target_asset_id"] not in by_id
        ):
            raise RuntimeError("Accepted fixture projection has a dangling graph edge")
        adjacency[relation["source_asset_id"]].add(relation["target_asset_id"])
    root = "WTP01-SYS-009"
    for asset in assets:
        capacity = asset["capacity_constraint"]
        if float(capacity["minimum"]) > float(capacity["maximum"]):
            raise RuntimeError(
                "Accepted fixture projection has an impossible capacity constraint"
            )
        if not asset["critical"] or asset["asset_id"] == root:
            continue
        visited: set[str] = set()
        frontier = [asset["asset_id"]]
        while frontier and root not in visited:
            current = frontier.pop()
            if current in visited:
                continue
            visited.add(current)
            frontier.extend(adjacency[current] - visited)
        if root not in visited:
            raise RuntimeError(
                f"Critical topology is disconnected at asset {asset['asset_id']}"
            )
    return {"assets": assets, "relations": relations}


def graph_version(world: dict[str, Any]) -> str:
    checksum = hashlib.sha256(canonical_json(world).encode("utf-8")).hexdigest()
    return f"{FIXTURE_ID}:1.0.0:{checksum}"


def graph_config() -> tuple[str, str, str]:
    uri = os.getenv("NEO4J_URI", "bolt://127.0.0.1:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "")
    if not password:
        raise RuntimeError(
            "NEO4J_PASSWORD is required; set a local development value in ignored .env"
        )
    return uri, user, password


def _write_graph(
    tx: Any,
    tenant_id: str,
    site_id: str,
    fixture_version: str,
    version: str,
    world: dict[str, Any],
) -> None:
    params = {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "fixture_id": FIXTURE_ID,
        "fixture_version": fixture_version,
        "graph_version": version,
    }
    tx.run(
        """MATCH (a:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})-[r]->
        (b:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
        WHERE r.fixture_id=$fixture_id DELETE r""",
        params,
    ).consume()
    tx.run(NODE_UPSERT, {**params, "assets": world["assets"]}).consume()
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for relation in world["relations"]:
        grouped[relation["relation_type"]].append(relation)
    for relation_type, relations in grouped.items():
        tx.run(
            RELATION_QUERIES[relation_type], {**params, "relations": relations}
        ).consume()
    tx.run(
        """MATCH (n:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
        WHERE NOT (n.asset_id IN $asset_ids) DETACH DELETE n""",
        {**params, "asset_ids": [asset["asset_id"] for asset in world["assets"]]},
    ).consume()
    tx.run(
        """MERGE (g:WorldGraph {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
        SET g.fixture_version=$fixture_version,g.graph_version=$graph_version,
            g.asset_count=$asset_count,g.relation_count=$relation_count,g.updated_at=datetime()""",
        {
            **params,
            "asset_count": len(world["assets"]),
            "relation_count": len(world["relations"]),
        },
    ).consume()


def project_world(
    tenant_id: str,
    *,
    site_id: str = SITE_ID,
    confirmed_tenant: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    if os.getenv("APP_ENV") != "local":
        raise RuntimeError("Fixture graph rebuild is restricted to APP_ENV=local")
    if confirmed_tenant != tenant_id:
        raise RuntimeError("Graph rebuild requires explicit tenant confirmation")
    world = load_accepted_world(tenant_id, site_id)
    version = graph_version(world)
    uri, user, password = graph_config()
    with neo4j.GraphDatabase.driver(uri, auth=(user, password)) as driver:
        driver.verify_connectivity()
        driver.execute_query(
            """CREATE CONSTRAINT world_asset_composite_key IF NOT EXISTS
            FOR (n:WorldAsset) REQUIRE (n.tenant_id,n.site_id,n.asset_id) IS UNIQUE"""
        )
        existing = driver.execute_query(
            """MATCH (g:WorldGraph {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
            RETURN g.graph_version AS graph_version,g.asset_count AS asset_count,g.relation_count AS relation_count LIMIT 1""",
            tenant_id=tenant_id,
            site_id=site_id,
            fixture_id=FIXTURE_ID,
        )
        if (
            not force
            and existing.records
            and existing.records[0]["graph_version"] == version
        ):
            return {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "fixture_id": FIXTURE_ID,
                "graph_version": version,
                "assets": len(world["assets"]),
                "relations": len(world["relations"]),
                "changed": False,
            }
        with driver.session() as session:
            session.execute_write(
                _write_graph, tenant_id, site_id, "1.0.0", version, world
            )
    return {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "fixture_id": FIXTURE_ID,
        "graph_version": version,
        "assets": len(world["assets"]),
        "relations": len(world["relations"]),
        "changed": True,
    }


def sync_once() -> list[dict[str, Any]]:
    with psycopg.connect(database_dsn(), row_factory=dict_row) as connection:
        scopes = connection.execute(
            """SELECT DISTINCT tenant_id,site_id FROM aggregate_projections
            WHERE aggregate_type='asset' AND state->>'fixture_id'=%s ORDER BY tenant_id,site_id""",
            (FIXTURE_ID,),
        ).fetchall()
    return [
        project_world(
            scope["tenant_id"],
            site_id=scope["site_id"],
            confirmed_tenant=scope["tenant_id"],
        )
        for scope in scopes
    ]


def verify_world_graph(
    tenant_id: str, *, site_id: str = SITE_ID, confirmed_tenant: str | None = None
) -> dict[str, Any]:
    if os.getenv("APP_ENV") != "local" or confirmed_tenant != tenant_id:
        raise RuntimeError(
            "Graph verification requires local mode and exact tenant confirmation"
        )
    world = load_accepted_world(tenant_id, site_id)
    uri, user, password = graph_config()
    params = {"tenant_id": tenant_id, "site_id": site_id, "fixture_id": FIXTURE_ID}
    with neo4j.GraphDatabase.driver(uri, auth=(user, password)) as driver:
        driver.verify_connectivity()
        asset_result = driver.execute_query(
            """MATCH (n:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
            RETURN count(n) AS asset_count""",
            **params,
        )
        relation_result = driver.execute_query(
            """MATCH (source:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})-[r]->
            (target:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
            WHERE r.fixture_id=$fixture_id RETURN count(r) AS relation_count""",
            **params,
        )
        version_result = driver.execute_query(
            """MATCH (g:WorldGraph {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
            RETURN g.graph_version AS graph_version LIMIT 1""",
            **params,
        )
    actual_assets = (
        int(asset_result.records[0]["asset_count"]) if asset_result.records else 0
    )
    actual_relations = (
        int(relation_result.records[0]["relation_count"])
        if relation_result.records
        else 0
    )
    version = (
        version_result.records[0]["graph_version"] if version_result.records else None
    )
    expected_version = graph_version(world)
    if (
        actual_assets != len(world["assets"])
        or actual_relations != len(world["relations"])
        or version != expected_version
    ):
        raise RuntimeError(
            "Tenant-scoped Neo4j graph does not match the accepted PostgreSQL projection"
        )
    return {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "fixture_id": FIXTURE_ID,
        "graph_version": version,
        "assets": actual_assets,
        "relations": actual_relations,
        "tenant_scoped": True,
    }


def query_graph(
    tenant_id: str,
    site_id: str,
    mode: str,
    identifier: str,
    *,
    depth: int = 1,
    limit: int = 40,
    incident_assets: list[str] | None = None,
) -> dict[str, Any]:
    """Bounded, read-only parameterized operational graph query over derived Neo4j state."""
    if (
        mode not in {"asset", "dependencies", "incident"}
        or not 1 <= depth <= 3
        or not 1 <= limit <= 100
    ):
        raise ValueError("invalid graph query bounds or mode")
    uri, user, password = graph_config()
    params: dict[str, Any] = {
        "tenant_id": tenant_id,
        "site_id": site_id,
        "fixture_id": FIXTURE_ID,
        "identifier": identifier,
        "limit": limit,
    }
    if mode == "incident":
        assets = sorted(set(incident_assets or []))[:100]
        if not assets:
            return {"mode": mode, "nodes": [], "relations": [], "graph_version": None}
        params["asset_ids"] = assets
        query = """MATCH (a:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
            WHERE a.asset_id IN $asset_ids
            OPTIONAL MATCH (a)-[r]-(b:WorldAsset {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id})
            WITH a,b,r LIMIT $limit
            RETURN {asset_id:a.asset_id,label:a.label,asset_type:a.asset_type} AS start,
                   {asset_id:b.asset_id,label:b.label,asset_type:b.asset_type} AS neighbor,
                   {source:a.asset_id,target:b.asset_id,type:type(r)} AS edge"""
    else:
        # `depth` is validated as an integer in [1, 3]; only that fixed bound is interpolated.
        path = f"-[r*1..{depth}]->" if mode == "dependencies" else "-[r*1..1]-"
        query = f"""MATCH (a:WorldAsset {{tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id,asset_id:$identifier}})
            OPTIONAL MATCH p=(a){path}(b:WorldAsset {{tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id}})
            WITH a,b,relationships(p) AS rels LIMIT $limit
            RETURN {{asset_id:a.asset_id,label:a.label,asset_type:a.asset_type}} AS start,
                   {{asset_id:b.asset_id,label:b.label,asset_type:b.asset_type}} AS node,
                   rels"""
    with neo4j.GraphDatabase.driver(uri, auth=(user, password)) as driver:
        driver.verify_connectivity()
        result = driver.execute_query(query, **params)
        if not result.records:
            return {"mode": mode, "nodes": [], "relations": [], "graph_version": None}
        if mode == "incident":
            nodes = []
            edges = []
            for record in result.records:
                if record["start"] and record["start"] not in nodes:
                    nodes.append(record["start"])
                if record["neighbor"] and record["neighbor"] not in nodes:
                    nodes.append(record["neighbor"])
                if record["edge"] and record["edge"]["target"] is not None:
                    edges.append(record["edge"])
        else:
            nodes = []
            edges = []
            for record in result.records:
                if record["start"] and record["start"] not in nodes:
                    nodes.append(record["start"])
                if record["node"] and record["node"] not in nodes:
                    nodes.append(record["node"])
                for rel in record["rels"] or []:
                    edges.append(
                        {
                            "source": rel.start_node.get("asset_id"),
                            "target": rel.end_node.get("asset_id"),
                            "type": rel.type,
                        }
                    )
        version_result = driver.execute_query(
            "MATCH (g:WorldGraph {tenant_id:$tenant_id,site_id:$site_id,fixture_id:$fixture_id}) RETURN g.graph_version AS version LIMIT 1",
            **params,
        )
    version = version_result.records[0]["version"] if version_result.records else None
    return {
        "mode": mode,
        "nodes": nodes[:limit],
        "relations": edges[:limit],
        "graph_version": version,
    }


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant")
    parser.add_argument("--site", default=SITE_ID)
    parser.add_argument("--confirm")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.watch:
        while True:
            try:
                result = sync_once()
                changed = sum(bool(item["changed"]) for item in result)
                if changed:
                    LOG.info("world_graph_sync changed_scopes=%d", changed)
            except Exception as error:  # noqa: BLE001
                LOG.warning(
                    "world_graph_sync_failed error_code=%s", type(error).__name__[:96]
                )
            time.sleep(5)
    else:
        if not args.tenant or not args.confirm:
            parser.error("--tenant and --confirm are required unless --watch is set")
        if args.verify:
            result = verify_world_graph(
                args.tenant, site_id=args.site, confirmed_tenant=args.confirm
            )
        else:
            result = project_world(
                args.tenant,
                site_id=args.site,
                confirmed_tenant=args.confirm,
                force=True,
            )
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
