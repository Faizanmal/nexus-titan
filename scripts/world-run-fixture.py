#!/usr/bin/env python3
"""Create/reset one isolated, synthetic simulation input bundle by exact run UUID."""

from __future__ import annotations

import argparse
import json
import shutil
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "data/world-runs"
SOURCE = ROOT / "tests/fixtures/world/TITAN-WTP-01"


def run_path(run_id: str) -> Path:
    parsed = uuid.UUID(run_id)
    if parsed.version != 4 or str(parsed) != run_id.lower():
        raise ValueError("run_id must be a canonical UUIDv4")
    root = RUNS.resolve()
    if RUNS.is_symlink() or not root.is_relative_to(ROOT.resolve()):
        raise ValueError("world-runs directory must stay under the repository")
    path = (RUNS / str(parsed)).resolve()
    if path.parent != root:
        raise ValueError(
            "run path must remain inside the isolated world-runs directory"
        )
    return path


def create(run_id: str) -> Path:
    if not SOURCE.is_dir():
        raise RuntimeError("Run the synthetic world fixture generator first")
    destination = run_path(run_id)
    destination.mkdir(parents=True, exist_ok=False)
    for name in ("world.json", "manifest.json", "scene.json"):
        shutil.copyfile(SOURCE / name, destination / name)
    public_scenario = SOURCE / "scenarios/pump-degradation/public.json"
    (destination / "scenarios").mkdir()
    shutil.copyfile(
        public_scenario, destination / "scenarios/pump-degradation-public.json"
    )
    # The evaluation ground truth is intentionally never copied into a run bundle.
    marker = {
        "run_id": run_id,
        "fixture_id": "TITAN-WTP-01",
        "fixture_only": True,
        "contains_hidden_truth": False,
    }
    (destination / "run.json").write_text(
        json.dumps(marker, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    return destination


def reset(run_id: str, confirmation: str) -> None:
    if run_id != confirmation:
        raise ValueError("reset requires --confirm to exactly match --run-id")
    target = run_path(run_id)
    if target.is_symlink() or not target.is_dir():
        raise ValueError(
            "the exact isolated run directory does not exist or is a symlink"
        )
    marker_path = target / "run.json"
    if (
        not marker_path.is_file()
        or json.loads(marker_path.read_text(encoding="utf-8")).get("run_id") != run_id
    ):
        raise ValueError("run marker does not match the requested run; refusing reset")
    shutil.rmtree(target)


def main() -> None:
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    create_parser = subcommands.add_parser("create")
    create_parser.add_argument("--run-id", required=True)
    reset_parser = subcommands.add_parser("reset")
    reset_parser.add_argument("--run-id", required=True)
    reset_parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    if args.command == "create":
        print(
            json.dumps(
                {"run_id": args.run_id, "path": str(create(args.run_id))},
                sort_keys=True,
            )
        )
    else:
        reset(args.run_id, args.confirm)
        print(json.dumps({"run_id": args.run_id, "status": "reset"}, sort_keys=True))


if __name__ == "__main__":
    main()
