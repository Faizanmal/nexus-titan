from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from uuid import uuid4

from jsonschema import Draft202012Validator

from nexus_titan_api.contracts import ROOT_SCHEMA, validate_contract
from nexus_titan_api.errors import APIError
from nexus_titan_api.identity import Actor
from nexus_titan_api.models import Membership
from nexus_titan_api.world_routes import _authorize_site

ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = ROOT / "tests/fixtures/world/TITAN-WTP-01"
GENERATOR_PATH = ROOT / "scripts/generate-world-fixture.py"
SPEC = importlib.util.spec_from_file_location("world_fixture_generator", GENERATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)
RUN_SPEC = importlib.util.spec_from_file_location(
    "world_run_fixture", ROOT / "scripts/world-run-fixture.py"
)
assert RUN_SPEC is not None and RUN_SPEC.loader is not None
world_runs = importlib.util.module_from_spec(RUN_SPEC)
RUN_SPEC.loader.exec_module(world_runs)


def test_titan_wtp_fixture_has_120_valid_assets_and_safe_critical_topology() -> None:
    world = json.loads((FIXTURE_ROOT / "world.json").read_text(encoding="utf-8"))
    generator.validate_world(world)
    assert world["asset_counts"]["total"] == 120
    assert {asset["asset_type"] for asset in world["assets"]} >= {
        "pump",
        "tank",
        "filter",
        "valve",
        "sensor",
        "subsystem",
    }
    assert all(not validate_contract("WorldAsset", asset) for asset in world["assets"])
    assert len({edge["relation_id"] for edge in world["relations"]}) == len(
        world["relations"]
    )


def test_world_fixture_generation_is_deterministic_for_fixed_seed() -> None:
    first = generator.build_world(20261115)
    second = generator.build_world(20261115)
    assert generator.canonical(first) == generator.canonical(second)
    assert generator.canonical(generator.fixture_events(first)) == generator.canonical(
        generator.fixture_events(second)
    )
    events = generator.fixture_events(first)
    assert len({event["event_id"] for event in events}) == len(events)
    assert all(not validate_contract("Event", event) for event in events)


def test_scene_manifest_matches_world_ids_and_uses_explicit_units_and_geometry() -> (
    None
):
    world = json.loads((FIXTURE_ROOT / "world.json").read_text(encoding="utf-8"))
    scene = json.loads((FIXTURE_ROOT / "scene.json").read_text(encoding="utf-8"))
    assert world["coordinate_system"]["units"] == scene["units"] == "m"
    assert {asset["asset_id"] for asset in world["assets"]} == {
        item["asset_id"] for item in scene["entities"]
    }
    assert all(
        item["geometry_ref"].startswith("procedural://geometry/")
        for item in scene["entities"]
    )
    ids = {asset["asset_id"] for asset in world["assets"]}
    assert {marker["asset_id"] for marker in scene["markers"]} == ids
    assert all(marker["physical_tag_printed"] is False for marker in scene["markers"])
    assert all(
        pipe["source_asset_id"] in ids and pipe["target_asset_id"] in ids
        for pipe in scene["pipe_paths"]
    )
    assert all(pipe["not_engineering_pipe_routing"] for pipe in scene["pipe_paths"])
    assert (
        world["asset_licenses"]["assets"]
        and {record["asset_id"] for record in world["asset_licenses"]["assets"]} == ids
    )
    assert all(
        record["third_party_asset"] is False
        for record in world["asset_licenses"]["assets"]
    )
    assert (
        scene["coordinate_transform"]["mapping"]
        == "[east,north,up] -> [east,up,-north]"
    )
    assert scene["render_budget"]["textures"] == 0 and scene["render_budget"][
        "mesh_instances"
    ] == len(ids)


def test_hidden_truth_is_separate_from_public_scenario_and_browser_preview() -> None:
    public = json.loads(
        (FIXTURE_ROOT / "scenarios/pump-degradation/public.json").read_text(
            encoding="utf-8"
        )
    )
    hidden = json.loads(
        (FIXTURE_ROOT / "scenarios/pump-degradation/hidden_truth.json").read_text(
            encoding="utf-8"
        )
    )
    web = json.loads(
        (ROOT / "apps/web/public/fixtures/TITAN-WTP-01/world.json").read_text(
            encoding="utf-8"
        )
    )
    assert "hidden_truth" not in public
    assert "hidden_truth" in hidden
    assert "synthetic_impeller_wear" not in json.dumps(web)
    assert "hidden_truth" not in json.dumps(web)
    dockerfile = (ROOT / "services/api/Dockerfile").read_text(encoding="utf-8")
    assert "scenarios/pump-degradation/hidden_truth.json" not in dockerfile


def test_world_contract_schema_definitions_are_valid_and_reject_invalid_ids() -> None:
    Draft202012Validator.check_schema(ROOT_SCHEMA)
    asset = json.loads((FIXTURE_ROOT / "world.json").read_text(encoding="utf-8"))[
        "assets"
    ][0]
    asset["asset_id"] = "../other-tenant"
    assert validate_contract("WorldAsset", asset)


def test_run_reset_is_isolated_and_never_copies_hidden_truth() -> None:
    first, second = str(uuid4()), str(uuid4())
    first_path = world_runs.create(first)
    second_path = world_runs.create(second)
    try:
        assert not (first_path / "hidden_truth.json").exists()
        assert not (
            first_path / "scenarios/pump-degradation/hidden_truth.json"
        ).exists()
        world_runs.reset(first, first)
        assert not first_path.exists()
        assert second_path.is_dir()
    finally:
        if first_path.exists():
            world_runs.reset(first, first)
        if second_path.exists():
            world_runs.reset(second, second)


def test_world_read_rejects_a_site_outside_the_membership_tenant_scope() -> None:
    class Rows:
        def all(self):
            return ["demo-site"]

    class Session:
        def get(self, model, key):
            if model is Membership and key == ("demo-nexus", "operator-1"):
                return Membership(
                    organization_id="demo-nexus",
                    user_id="operator-1",
                    role="operator",
                    status="active",
                )
            return None

        def scalars(self, _query):
            return Rows()

    actor = Actor("operator-1", "operator@example.test", True)
    try:
        _authorize_site(Session(), "demo-nexus", actor, "titan-wtp-01")
    except APIError as error:
        assert error.code == "SITE_SCOPE_VIOLATION" and error.status == 403
    else:
        raise AssertionError("out-of-scope sites must be denied")


def test_spatial_marker_listing_and_resolution() -> None:
    from nexus_titan_api.world_routes import (
        SpatialResolveRequest,
        list_spatial_markers,
        resolve_spatial_asset,
    )

    class Rows:
        def all(self):
            return ["titan-wtp-01"]

    class Session:
        def get(self, model, key):
            if model is Membership and key == ("demo-nexus", "operator-1"):
                return Membership(
                    organization_id="demo-nexus",
                    user_id="operator-1",
                    role="operator",
                    status="active",
                )
            return None

        def scalars(self, _query):
            return Rows()

        def execute(self, _query, _params=None):
            class Mappings:
                def mappings(self):
                    return self

                def all(self):
                    return []

            return Mappings()

    actor = Actor("operator-1", "operator@example.test", True)
    session = Session()

    markers_resp = list_spatial_markers(
        "demo-nexus", "titan-wtp-01", actor=actor, session=session
    )
    assert markers_resp["count"] == 120
    assert len(markers_resp["markers"]) == 120
    assert markers_resp["coordinate_system"] == "TITAN_LOCAL_PLANT_GRID_V1"
    assert (
        markers_resp["coordinate_transform"]["mapping"]
        == "[east,north,up] -> [east,up,-north]"
    )

    res_marker = resolve_spatial_asset(
        SpatialResolveRequest(
            tenant_id="demo-nexus",
            site_id="titan-wtp-01",
            marker_id="QR-TITAN-WTP-01-WTP01-PMP-001",
        ),
        actor=actor,
        session=session,
    )
    assert res_marker["resolved"] is True
    assert res_marker["asset_id"] == "WTP01-PMP-001"
    assert res_marker["confidence_tier"] == "fixture_registry_exact_id"
    assert res_marker["environment_reconstruction_claimed"] is False
    assert res_marker["position_three_rhs"][0] == res_marker["position_plant_grid"][0]
    assert res_marker["position_three_rhs"][1] == res_marker["position_plant_grid"][2]
    assert res_marker["position_three_rhs"][2] == -res_marker["position_plant_grid"][1]

    res_asset = resolve_spatial_asset(
        SpatialResolveRequest(
            tenant_id="demo-nexus",
            site_id="titan-wtp-01",
            asset_id="WTP01-TNK-001",
            observed_confidence=0.95,
        ),
        actor=actor,
        session=session,
    )
    assert res_asset["resolved"] is True
    assert res_asset["asset_id"] == "WTP01-TNK-001"
    assert res_asset["confidence_score"] == 0.95

    try:
        resolve_spatial_asset(
            SpatialResolveRequest(
                tenant_id="demo-nexus",
                site_id="titan-wtp-01",
                marker_id="QR-UNKNOWN-999",
            ),
            actor=actor,
            session=session,
        )
    except APIError as err:
        assert err.code == "MARKER_NOT_FOUND" and err.status == 404
    else:
        raise AssertionError("unknown marker must raise 404")
