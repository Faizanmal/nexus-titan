#!/usr/bin/env python3
"""Generate deterministic fictional telemetry and a separate hidden holdout label file."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/api/src"))
from nexus_titan_api.telemetry import (
    generate_series,
    holdout_metrics,
    score_samples,
    sustained_alerts,
)

ROOT = Path(__file__).resolve().parents[1]
WORLD = ROOT / "tests/fixtures/world/TITAN-WTP-01/world.json"
OUT = ROOT / "tests/fixtures/telemetry/TITAN-WTP-01"


def canonical(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def generate(seed: int, steps: int) -> dict:
    world = json.loads(WORLD.read_text(encoding="utf-8"))
    samples, labels = generate_series(world, seed=seed, steps=steps)
    scored = score_samples(samples)
    result = {
        "fixture_id": "TITAN-WTP-01",
        "schema_version": "1.3.0",
        "seed": seed,
        "sample_count": len(samples),
        "samples": samples,
    }
    report = {
        "fixture_id": result["fixture_id"],
        "seed": seed,
        "steps": steps,
        "fault_label_count": len(labels),
        "alerts": len(sustained_alerts(scored)),
        "holdout_metrics": holdout_metrics(scored, labels),
        "samples_sha256": hashlib.sha256(canonical(result)).hexdigest(),
        "method": "frozen initial 30-sample baseline; median/MAD robust z-score, threshold 6",
    }
    return {"public": result, "holdout": {"labels": labels}, "report": report}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument("--steps", type=int, default=240)
    parser.add_argument("--check-deterministic", action="store_true")
    args = parser.parse_args()
    first = generate(args.seed, args.steps)
    if args.check_deterministic:
        second = generate(args.seed, args.steps)
        if first != second:
            raise SystemExit("telemetry generator output is not deterministic")
        print(
            json.dumps(
                {
                    "deterministic": True,
                    "samples": first["public"]["sample_count"],
                    "holdout_metrics": first["report"]["holdout_metrics"],
                    "sha256": first["report"]["samples_sha256"],
                },
                sort_keys=True,
            )
        )
        return
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "samples.json").write_bytes(canonical(first["public"]) + b"\n")
    (OUT / "holdout-labels.json").write_bytes(canonical(first["holdout"]) + b"\n")
    (OUT / "detector-report.json").write_bytes(canonical(first["report"]) + b"\n")
    print(json.dumps(first["report"], sort_keys=True))


if __name__ == "__main__":
    main()
