from __future__ import annotations

import json

from nexus_titan_api import world_graph


def test_graph_cypher_relation_labels_are_allowlisted_and_data_is_parameterized() -> (
    None
):
    assert set(world_graph.RELATION_QUERIES) == world_graph.ALLOWED_RELATIONS
    assert all(
        query.count("$relations") == 1
        for query in world_graph.RELATION_QUERIES.values()
    )
    assert "{relation}" not in "".join(world_graph.RELATION_QUERIES.values())


def test_world_graph_rebuild_uses_accepted_projection_data_and_stable_version(
    monkeypatch,
) -> None:
    asset = {
        "asset_id": "WTP01-SYS-009",
        "fixture_id": "TITAN-WTP-01",
        "label": "Utilities subsystem",
        "asset_type": "subsystem",
        "site_id": "titan-wtp-01",
        "subsystem_id": "WTP01-SYS-009",
        "critical": True,
        "serial_number": "SYN-WTP01-SYS-009",
        "measurement_unit": "load-index",
        "capacity_constraint": {
            "metric": "design_load",
            "minimum": 0,
            "maximum": 100,
            "unit": "load-index",
        },
        "position": [0.0, 0.0, 0.0],
        "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
        "dependencies": [],
    }
    world = {"assets": [asset], "relations": []}
    calls = []

    class Tx:
        def run(self, query, parameters):
            calls.append((query, parameters))
            return self

        def consume(self):
            return None

    class Session:
        def execute_write(self, callback, *args):
            callback(Tx(), *args)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Driver:
        def verify_connectivity(self):
            return None

        def execute_query(self, query, **_parameters):
            calls.append((query, {}))
            return type("Result", (), {"records": []})()

        def session(self):
            return Session()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setattr(world_graph, "load_accepted_world", lambda *_args: world)
    monkeypatch.setattr(
        world_graph, "graph_config", lambda: ("bolt://fake", "user", "not-logged")
    )
    monkeypatch.setattr(
        world_graph.neo4j.GraphDatabase, "driver", lambda *_args, **_kwargs: Driver()
    )
    first = world_graph.project_world("demo-nexus", confirmed_tenant="demo-nexus")
    second = world_graph.project_world("demo-nexus", confirmed_tenant="demo-nexus")
    assert first == second
    assert first["assets"] == 1 and first["relations"] == 0
    node_query, node_params = next((q, p) for q, p in calls if "UNWIND $assets" in q)
    assert "demo-nexus" not in node_query
    assert node_params["tenant_id"] == "demo-nexus"
    assert node_params["assets"][0]["asset_id"] == "WTP01-SYS-009"
    assert "manual" not in json.dumps(node_params).lower()
    assert "inspection" not in json.dumps(node_params).lower()


def test_graph_rebuild_requires_local_mode_and_matching_tenant_confirmation(
    monkeypatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    try:
        world_graph.project_world("demo-nexus", confirmed_tenant="demo-nexus")
    except RuntimeError as error:
        assert "APP_ENV=local" in str(error)
    else:
        raise AssertionError("production graph rebuild must fail closed")
