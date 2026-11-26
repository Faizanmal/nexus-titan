from datetime import UTC, datetime, timedelta

import pytest

from nexus_titan_api.causal import (
    directed_edges,
    impact_path,
    investigate,
    validate_evidence_references,
)

START = datetime(2026, 1, 1, tzinfo=UTC)
ASSETS = [{"asset_id": name} for name in ("pump", "filter", "system", "sensor")]
RELATIONS = [
    {"source_asset_id": "pump", "target_asset_id": "system", "relation_type": "FEEDS"},
    {
        "source_asset_id": "filter",
        "target_asset_id": "system",
        "relation_type": "FEEDS",
    },
    {
        "source_asset_id": "system",
        "target_asset_id": "pump",
        "relation_type": "DEPENDS_ON",
    },
]


def samples(asset="pump", metric="pressure", count=4, z=9, start=START):
    return [
        {
            "asset_id": asset,
            "metric": metric,
            "source_id": f"s-{asset}-{metric}-{i}",
            "sampled_at": (start + timedelta(minutes=i)).isoformat(),
            "value": 500 + i,
            "robust_z": z + i * 0.1,
            "quality": "good",
        }
        for i in range(count)
    ]


def run(observations, *, expected=None):
    return investigate(
        assets=ASSETS,
        relations=RELATIONS,
        observations=observations,
        affected_asset_ids=["system"],
        incident_event_id="event-1",
        incident_at=(START + timedelta(hours=1)).isoformat(),
        expected_sensor_assets=expected,
    )


def test_directed_propagation_and_known_root_ranks_with_hypothesis_only():
    graph = directed_edges(ASSETS, RELATIONS)
    assert impact_path(graph, "pump", "system") == ["pump", "system"]
    result = run(samples())
    assert result["hypotheses"][0]["root_asset_id"] == "pump"
    assert result["hypotheses"][0]["status"] == "hypothesis"
    assert result["claim_scope"] == "ranked_hypotheses_only"
    assert result["operational_advice"] == []
    validate_evidence_references(
        result, {row["source_id"] for row in samples()}, "event-1"
    )


def test_alternate_root_and_uncertainty_are_visible():
    result = run(samples("filter", "flow"))
    assert result["hypotheses"][0]["root_asset_id"] == "filter"
    assert (
        "fixture ranking weights are not calibrated probabilities"
        in result["hypotheses"][0]["uncertainty"]["reasons"]
    )


def test_time_order_conflict_and_missing_observation_are_reported():
    early = samples("system", "flow", start=START)
    later = samples("pump", "pressure", start=START + timedelta(hours=1))
    result = run(early + later, expected=["sensor"])
    assert any(
        item["code"] == "causal_time_order_conflict"
        for item in result["contradiction_flags"]
    )
    assert result["status"] == "ambiguous"
    assert result["additional_observations_requested"][0]["asset_id"] == "sensor"


def test_conflicting_observation_with_duplicate_citation_is_flagged():
    rows = samples()
    rows.append({**rows[0], "value": 999, "robust_z": 12})
    result = run(rows)
    assert any(
        item["code"] == "conflicting_sample_citation"
        for item in result["contradiction_flags"]
    )
    assert result["status"] == "ambiguous"


def test_missing_sensor_and_no_anomalies_have_insufficient_state():
    ordinary = [{**item, "robust_z": 1.0} for item in samples()]
    result = run(ordinary, expected=["sensor"])
    assert result["status"] == "insufficient_evidence"
    assert result["additional_observations_requested"]


def test_isolated_spike_and_monotone_drift_remain_alternatives():
    spike = run(samples(count=1))
    assert spike["hypotheses"][0]["cause_type"] == "isolated_spike_or_false_positive"
    drift_rows = samples(count=5, z=6)
    for index, row in enumerate(drift_rows):
        row["robust_z"] = 6 + index * 0.5
    drift = run(drift_rows)
    assert drift["hypotheses"][0]["cause_type"] == "sensor_drift"


def test_invalid_citation_and_cross_scope_relation_rejected():
    result = run(samples())
    with pytest.raises(ValueError, match="invalid telemetry citation"):
        validate_evidence_references(result, set(), "event-1")
    with pytest.raises(ValueError, match="dangling or cross-scope"):
        directed_edges(
            ASSETS,
            [
                {
                    "source_asset_id": "pump",
                    "target_asset_id": "foreign",
                    "relation_type": "FEEDS",
                }
            ],
        )
