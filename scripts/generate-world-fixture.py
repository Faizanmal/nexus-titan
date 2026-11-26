#!/usr/bin/env python3
"""Generate the deterministic, fully synthetic TITAN-WTP-01 world bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ID = "TITAN-WTP-01"
SITE_ID = "titan-wtp-01"
NAMESPACE = UUID("8d4585fe-1ed4-4ee3-a33a-9d2b2f215001")
COUNTS = {"pump": 24, "tank": 12, "filter": 16, "valve": 30, "sensor": 28}
SUBSYSTEMS = (
    "raw-water-intake",
    "screening",
    "chemical-dosing",
    "clarification",
    "filtration",
    "clear-water-storage",
    "distribution",
    "residuals",
    "utilities",
    "instrumentation",
)
RELATIONS = {"PART_OF", "DEPENDS_ON", "FEEDS", "MONITORS", "CONTROLLED_BY"}
ID_PATTERN = re.compile(r"^WTP01-(SYS|PMP|TNK|FLT|VLV|SNS)-\d{3}$")
TYPE_PREFIX = {
    "subsystem": "SYS",
    "pump": "PMP",
    "tank": "TNK",
    "filter": "FLT",
    "valve": "VLV",
    "sensor": "SNS",
}
UNITS = {
    "subsystem": "load-index",
    "pump": "L/s",
    "tank": "m3",
    "filter": "L/s",
    "valve": "L/s",
    "sensor": "bar",
}
GEOMETRIES = {
    "subsystem": "procedural://geometry/subsystem-block-v1",
    "pump": "procedural://geometry/pump-centrifugal-v1",
    "tank": "procedural://geometry/tank-cylinder-v1",
    "filter": "procedural://geometry/filter-vessel-v1",
    "valve": "procedural://geometry/valve-gate-v1",
    "sensor": "procedural://geometry/sensor-instrument-v1",
}


def canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _capacity(asset_type: str, ordinal: int, rng: random.Random) -> dict[str, Any]:
    if asset_type == "subsystem":
        return {
            "metric": "design_load",
            "minimum": 0,
            "maximum": 100,
            "unit": "load-index",
        }
    unit = UNITS[asset_type]
    bases = {"pump": 12, "tank": 40, "filter": 9, "valve": 15, "sensor": 10}
    width = {"pump": 9, "tank": 30, "filter": 7, "valve": 14, "sensor": 2}[asset_type]
    maximum = bases[asset_type] + (ordinal % width) + rng.randint(0, 2)
    metric = {
        "pump": "flow",
        "tank": "volume",
        "filter": "flow",
        "valve": "flow",
        "sensor": "measurement_range",
    }[asset_type]
    return {"metric": metric, "minimum": 0, "maximum": maximum, "unit": unit}


def build_world(seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    subsystems: list[dict[str, Any]] = []
    for index, name in enumerate(SUBSYSTEMS, start=1):
        asset_id = f"WTP01-SYS-{index:03d}"
        dependencies = (
            []
            if name == "utilities"
            else [{"relation": "DEPENDS_ON", "target_asset_id": "WTP01-SYS-009"}]
        )
        # Utilities is the synthetic root; instrumentation also depends on it by explicit fixture assumption.
        if index == 9:
            dependencies = []
        subsystems.append(
            {
                "asset_id": asset_id,
                "fixture_id": FIXTURE_ID,
                "label": f"{name.replace('-', ' ').title()} subsystem",
                "asset_type": "subsystem",
                "site_id": SITE_ID,
                "subsystem_id": asset_id,
                "critical": index in {1, 5, 6, 7, 9},
                "serial_number": f"SYN-{asset_id}",
                "measurement_unit": UNITS["subsystem"],
                "capacity_constraint": {
                    "metric": "design_load",
                    "minimum": 0,
                    "maximum": 100,
                    "unit": "load-index",
                },
                "position": [float((index - 1) * 14), 0.0, 0.0],
                "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
                "dependencies": dependencies,
            }
        )

    assets = list(subsystems)
    names = {
        "pump": ["Centrifugal transfer pump", "Booster pump", "Recirculation pump"],
        "tank": ["Clear-water tank", "Chemical day tank", "Backwash tank"],
        "filter": ["Media filter vessel", "Cartridge filter", "Polishing filter"],
        "valve": ["Gate valve", "Check valve", "Isolation valve"],
        "sensor": [
            "Pressure transmitter",
            "Flow sensor",
            "Level sensor",
            "Turbidity sensor",
        ],
    }
    ordinals: dict[str, int] = {key: 0 for key in COUNTS}
    for asset_type, count in COUNTS.items():
        prefix = TYPE_PREFIX[asset_type]
        for ordinal in range(1, count + 1):
            ordinals[asset_type] += 1
            subsystem_index = ((ordinal - 1) % len(SUBSYSTEMS)) + 1
            subsystem_id = f"WTP01-SYS-{subsystem_index:03d}"
            asset_id = f"WTP01-{prefix}-{ordinal:03d}"
            x = float((subsystem_index - 1) * 14 + rng.randint(-5, 5))
            y = float((ordinal % 7) * 4 + rng.randint(-1, 1))
            z = float((ordinal % 3) * 1.5)
            critical = ordinal % 4 == 1 or asset_type == "pump" and ordinal <= 8
            dependencies = [{"relation": "PART_OF", "target_asset_id": subsystem_id}]
            if asset_type in {"pump", "filter"}:
                dependencies.append(
                    {"relation": "FEEDS", "target_asset_id": subsystem_id}
                )
            if asset_type == "sensor":
                dependencies.append(
                    {"relation": "MONITORS", "target_asset_id": subsystem_id}
                )
            if asset_type == "valve":
                dependencies.append(
                    {"relation": "CONTROLLED_BY", "target_asset_id": "WTP01-SYS-010"}
                )
            assets.append(
                {
                    "asset_id": asset_id,
                    "fixture_id": FIXTURE_ID,
                    "label": f"{rng.choice(names[asset_type])} {ordinal:02d}",
                    "asset_type": asset_type,
                    "site_id": SITE_ID,
                    "subsystem_id": subsystem_id,
                    "critical": critical,
                    "serial_number": f"SYN-{asset_id}",
                    "measurement_unit": UNITS[asset_type],
                    "capacity_constraint": _capacity(asset_type, ordinal, rng),
                    "position": [x, y, z],
                    "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
                    "dependencies": dependencies,
                }
            )

    relations = []
    for asset in assets:
        for index, dependency in enumerate(asset["dependencies"]):
            relations.append(
                {
                    "relation_id": f"{asset['asset_id']}:{dependency['relation']}:{index:02d}",
                    "source_asset_id": asset["asset_id"],
                    "target_asset_id": dependency["target_asset_id"],
                    "relation_type": dependency["relation"],
                    "fixture_id": FIXTURE_ID,
                }
            )
    scene_entities = [
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
    asset_by_id = {asset["asset_id"]: asset for asset in assets}
    # These are schematic connector paths derived only from the fixture's FEEDS relations.
    pipe_paths = [
        {
            "path_id": relation["relation_id"],
            "source_asset_id": relation["source_asset_id"],
            "target_asset_id": relation["target_asset_id"],
            "relation_type": "FEEDS",
            "points": [
                asset_by_id[relation["source_asset_id"]]["position"],
                asset_by_id[relation["target_asset_id"]]["position"],
            ],
            "routing": "straight_schematic_connector",
            "not_engineering_pipe_routing": True,
        }
        for relation in relations
        if relation["relation_type"] == "FEEDS"
    ]
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
        for asset in sorted(assets, key=lambda item: item["asset_id"])
    ]
    scene = {
        "fixture_id": FIXTURE_ID,
        "scene_version": "scene-v2",
        "coordinate_system": "TITAN_LOCAL_PLANT_GRID_V1",
        "units": "m",
        "render_coordinate_system": "THREE_RHS_Y_UP",
        "coordinate_transform": {
            "from": "TITAN_LOCAL_PLANT_GRID_V1",
            "to": "THREE_RHS_Y_UP",
            "matrix_3x3_row_major": [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
            "mapping": "[east,north,up] -> [east,up,-north]",
            "units_preserved": True,
        },
        "entities": sorted(scene_entities, key=lambda item: item["asset_id"]),
        "pipe_paths": sorted(pipe_paths, key=lambda item: item["path_id"]),
        "markers": markers,
        "render_budget": {
            "textures": 0,
            "asset_models": 0,
            "mesh_instances": len(scene_entities),
            "lod": {"high_radial_segments": 16, "low_radial_segments": 8},
        },
        "provenance": "Original synthetic fixture; procedural primitives; schematic FEEDS connectors only. Not a surveyed plant model.",
    }
    return {
        "fixture_id": FIXTURE_ID,
        "schema_version": "1.2.0",
        "seed": seed,
        "site_id": SITE_ID,
        "coordinate_system": {
            "id": "TITAN_LOCAL_PLANT_GRID_V1",
            "units": "m",
            "axis": {"x": "east", "y": "north", "z": "up"},
            "origin": "synthetic local plant origin",
        },
        "asset_counts": {**COUNTS, "subsystem": len(SUBSYSTEMS), "total": len(assets)},
        "relation_types": sorted(RELATIONS),
        "assets": sorted(assets, key=lambda item: item["asset_id"]),
        "relations": sorted(relations, key=lambda item: item["relation_id"]),
        "scene": scene,
        "asset_licenses": {
            "fixture_id": FIXTURE_ID,
            "assets": [
                {
                    "asset_id": asset["asset_id"],
                    "geometry_ref": GEOMETRIES[asset["asset_type"]],
                    "geometry_origin": "original procedural primitive composition",
                    "geometry_license": "Apache-2.0",
                    "asset_data_origin": "original generated synthetic fixture",
                    "asset_data_license": "CC0-1.0",
                    "third_party_asset": False,
                }
                for asset in sorted(assets, key=lambda item: item["asset_id"])
            ],
        },
        "licensing": {
            "content_origin": "original synthetic content generated for NEXUS TITAN",
            "license": "CC0-1.0",
            "third_party_material": False,
            "engineering_assumptions": "Illustrative topology and capacities only; not operating guidance or a real treatment plant design.",
        },
    }


def validate_world(world: dict[str, Any]) -> None:
    assets = world["assets"]
    ids = [asset["asset_id"] for asset in assets]
    assert len(ids) == len(set(ids)) and len(ids) >= 100
    by_id = {asset["asset_id"]: asset for asset in assets}
    assert all(
        ID_PATTERN.fullmatch(asset_id) for asset_id in ids
    ), "impossible asset ID"
    assert all(
        asset["site_id"] == SITE_ID and asset["fixture_id"] == FIXTURE_ID
        for asset in assets
    )
    assert all(
        asset["capacity_constraint"]["minimum"]
        <= asset["capacity_constraint"]["maximum"]
        for asset in assets
    )
    for relation in world["relations"]:
        assert (
            relation["source_asset_id"] in by_id
            and relation["target_asset_id"] in by_id
        ), "dangling relation"
        assert relation["source_asset_id"] != relation["target_asset_id"]
        assert relation["relation_type"] in RELATIONS
    adjacency: dict[str, set[str]] = {asset_id: set() for asset_id in ids}
    for relation in world["relations"]:
        adjacency[relation["source_asset_id"]].add(relation["target_asset_id"])
    root = "WTP01-SYS-009"
    for asset in assets:
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
        assert (
            root in visited
        ), f"critical asset disconnected from utility root: {asset['asset_id']}"
    scene_ids = [entity["asset_id"] for entity in world["scene"]["entities"]]
    assert len(scene_ids) == len(set(scene_ids)) and set(scene_ids) == set(
        ids
    ), "scene IDs do not match asset IDs"
    scene = world["scene"]
    assert {marker["asset_id"] for marker in scene["markers"]} == set(
        ids
    ), "marker registration IDs do not match asset IDs"
    assert all(
        path["source_asset_id"] in by_id and path["target_asset_id"] in by_id
        for path in scene["pipe_paths"]
    ), "dangling schematic connector"
    assert len(world["asset_licenses"]["assets"]) == len(ids)


def fixture_events(world: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for sequence, asset in enumerate(world["assets"], start=1):
        event_id = str(uuid5(NAMESPACE, f"{FIXTURE_ID}:{asset['asset_id']}:created"))
        result.append(
            {
                "event_id": event_id,
                "tenant_id": "demo-nexus",
                "schema_version": "1.2.0",
                "event_type": "asset.created",
                "source": "api",
                "sequence": sequence,
                "occurred_at": "2026-01-01T00:00:00Z",
                "classification": "public",
                "site_id": SITE_ID,
                "aggregate_type": "asset",
                "aggregate_id": asset["asset_id"],
                "expected_revision": 0,
                "payload": asset,
            }
        )
    return result


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
        + b"\n"
    )


def write_bundle(world: dict[str, Any], output: Path) -> dict[str, Any]:
    validate_world(world)
    output.mkdir(parents=True, exist_ok=True)
    dataset_path = output / "world.json"
    _write_json(dataset_path, world)
    digest = hashlib.sha256(canonical(world)).hexdigest()
    manifest = {
        "fixture_id": FIXTURE_ID,
        "fixture_version": "1.0.0",
        "schema_version": "1.2.0",
        "seed": world["seed"],
        "asset_count": len(world["assets"]),
        "relation_count": len(world["relations"]),
        "scene_entity_count": len(world["scene"]["entities"]),
        "dataset_sha256": digest,
        "fixture_data_path": "world.json",
        "generated_deterministically": True,
        "licensing": world["licensing"],
    }
    _write_json(output / "manifest.json", manifest)
    _write_json(output / "events.json", fixture_events(world))
    _write_json(output / "scene.json", world["scene"])
    _write_json(output / "asset-licenses.json", world["asset_licenses"])
    _write_json(
        output / "scenarios/pump-degradation/public.json",
        {
            "scenario_id": "TITAN-WTP-01-PUMP-DEGRADATION-01",
            "fixture_id": FIXTURE_ID,
            "fixture_only": True,
            "observations": [
                {
                    "observation_id": "OBS-001",
                    "asset_id": "WTP01-SNS-001",
                    "metric": "discharge_pressure",
                    "value": 1.8,
                    "unit": "bar",
                    "note": "Synthetic reading; compare against the asset's recent fixture baseline.",
                }
            ],
            "evidence_refs": [
                "inspection-images/WTP01-PMP-001.svg",
                "manuals/manual-synthetic-pumps.md",
            ],
            "prompt_context_notice": "Public synthetic scenario input. Ground truth is stored separately and must not be passed to a model.",
        },
    )
    _write_json(
        output / "scenarios/pump-degradation/hidden_truth.json",
        {
            "scenario_id": "TITAN-WTP-01-PUMP-DEGRADATION-01",
            "fixture_id": FIXTURE_ID,
            "hidden_truth": {
                "target_asset_id": "WTP01-PMP-001",
                "condition": "synthetic_impeller_wear",
                "severity": "moderate",
                "degradation_factor": 0.72,
                "expected_diagnostic": "Reduced flow capacity is consistent with a synthetic pump efficiency loss; confirm with additional measurements.",
            },
            "handling": "Evaluation ground truth only; exclude from model prompt context and user-facing retrieval.",
        },
    )
    manuals = {
        "manual-synthetic-pumps.md": (
            "Synthetic Pump Operations Note",
            "This original synthetic handout describes a fictional centrifugal transfer pump fixture. Fixture values do not specify safe operating procedures. Check the fictional pressure, flow, and status fields for consistency only.",
        ),
        "manual-synthetic-filtration.md": (
            "Synthetic Filtration Note",
            "This original synthetic handout describes fictional filter assets. No thresholds in this fixture are validated or suitable for plant operation.",
        ),
        "manual-synthetic-storage.md": (
            "Synthetic Storage Note",
            "This original synthetic handout describes fictional tanks and storage subsystems. All labels, units, capacities, and relationships are generated examples.",
        ),
    }
    for filename, (title, content) in manuals.items():
        (output / "manuals" / filename).parent.mkdir(parents=True, exist_ok=True)
        (output / "manuals" / filename).write_text(
            f"# {title}\n\n{content}\n\nFixture: {FIXTURE_ID}. License: CC0-1.0.\n",
            encoding="utf-8",
        )
    for asset_type in TYPE_PREFIX:
        if asset_type == "subsystem":
            continue
        asset = next(
            item for item in world["assets"] if item["asset_type"] == asset_type
        )
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-labelledby="title desc">
<title id="title">Synthetic inspection illustration for {asset["asset_id"]}</title><desc id="desc">Original schematic illustration, not a photograph, for fixture QA.</desc>
<rect width="640" height="360" fill="#e8eef2"/><rect x="24" y="24" width="592" height="312" rx="18" fill="#fff" stroke="#5b7083" stroke-width="4"/>
<path d="M250 90h140v180H250z" fill="#9db9c9" stroke="#234" stroke-width="7"/><circle cx="320" cy="180" r="48" fill="#5c879e" stroke="#234" stroke-width="7"/>
<text x="48" y="62" font-size="24" font-family="sans-serif">SYNTHETIC INSPECTION ILLUSTRATION</text><text x="48" y="310" font-size="21" font-family="sans-serif">{asset["asset_id"]} · {asset["serial_number"]}</text></svg>"""
        (output / "inspection-images").mkdir(parents=True, exist_ok=True)
        (output / "inspection-images" / f"{asset['asset_id']}.svg").write_text(
            svg, encoding="utf-8"
        )

    # The browser preview is generated from the exact same bundle; no hand-maintained copy.
    web_copy = ROOT / "apps/web/public/fixtures" / FIXTURE_ID
    web_copy.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(dataset_path, web_copy / "world.json")
    shutil.copyfile(output / "manifest.json", web_copy / "manifest.json")
    shutil.copyfile(output / "scene.json", web_copy / "scene.json")
    shutil.copyfile(output / "asset-licenses.json", web_copy / "asset-licenses.json")
    shutil.copyfile(output / "events.json", web_copy / "events.json")
    return manifest


def verify_determinism(seed: int) -> bool:
    first = build_world(seed)
    second = build_world(seed)
    return canonical(first) == canonical(second) and canonical(
        fixture_events(first)
    ) == canonical(fixture_events(second))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "tests/fixtures/world" / FIXTURE_ID
    )
    parser.add_argument("--check-deterministic", action="store_true")
    args = parser.parse_args()
    if args.check_deterministic and not verify_determinism(args.seed):
        raise SystemExit("fixture generation was not deterministic")
    manifest = write_bundle(build_world(args.seed), args.output)
    print(
        json.dumps(
            {
                "fixture_id": FIXTURE_ID,
                "assets": manifest["asset_count"],
                "relations": manifest["relation_count"],
                "sha256": manifest["dataset_sha256"],
                "deterministic": True,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
