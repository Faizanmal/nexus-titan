"""Offline synthetic causal ranking evaluation; holdout truth is read only here."""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "services/api/src"))
from nexus_titan_api.causal import investigate
from nexus_titan_api.telemetry import generate_series, score_samples

world = json.loads(
    (root / "tests/fixtures/world/TITAN-WTP-01/world.json").read_text(encoding="utf-8")
)
samples, hidden_labels = generate_series(world, seed=20261115)
scored = score_samples(samples)
assets = [{"asset_id": row["asset_id"]} for row in world["assets"]]
relations = [
    {
        "source_asset_id": row["asset_id"],
        "target_asset_id": dep["target_asset_id"],
        "relation_type": dep["relation"],
    }
    for row in world["assets"]
    for dep in row.get("dependencies", [])
]
# Evaluate each held-out root independently against its synthetic downstream subsystem.
expected = {(row["asset_id"], row["metric"]) for row in hidden_labels}
groups = {}
for row in scored:
    if row["value"] is None:
        continue
    groups.setdefault((row["asset_id"], row["metric"]), []).append(
        {
            "asset_id": row["asset_id"],
            "metric": row["metric"],
            "source_id": f"fixture:{row['sample_sequence']}",
            "sampled_at": row["sampled_at"],
            "value": row["value"],
            "quality": row["quality"],
            "robust_z": row["robust_z"],
        }
    )
hits = reciprocal_rank = evaluated = 0
for asset_id, metric in sorted(expected):
    asset = next(row for row in world["assets"] if row["asset_id"] == asset_id)
    targets = [
        dep["target_asset_id"]
        for dep in asset.get("dependencies", [])
        if dep["relation"] == "FEEDS"
    ]
    if not targets:
        continue
    result = investigate(
        assets=assets,
        relations=relations,
        observations=groups[(asset_id, metric)],
        affected_asset_ids=[targets[0]],
        incident_event_id="fixture-eval-event",
        incident_at=groups[(asset_id, metric)][-1]["sampled_at"],
    )
    ranking = [row["root_asset_id"] for row in result["hypotheses"]]
    evaluated += 1
    if asset_id in ranking:
        rank = ranking.index(asset_id) + 1
        hits += 1
        reciprocal_rank += 1 / rank
report = {
    "evaluation": "synthetic_holdout_root_retrieval",
    "fixture_id": "TITAN-WTP-01",
    "seed": 20261115,
    "cases": evaluated,
    "top_1_accuracy": round(hits / evaluated, 4) if evaluated else 0,
    "mean_reciprocal_rank": round(reciprocal_rank / evaluated, 4) if evaluated else 0,
    "note": "Holdout labels are consumed only by this script; this synthetic fixture result is not calibrated causal accuracy.",
}
print(json.dumps(report, sort_keys=True))
