"""Deterministic causal hypothesis ranking for the synthetic fixture; never a diagnosis."""

from __future__ import annotations

import itertools
import math
from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any

RELATION_RULES = {"FEEDS": "source_to_target", "DEPENDS_ON": "target_to_source"}
MAX_ASSETS = 512
MAX_OBSERVATIONS = 20_000
MAX_DEPTH = 8
ANOMALY_THRESHOLD = 6.0
EVIDENCE_WEIGHTS = {
    "sustained_anomaly_sample": 6,
    "independent_metric": 6,
    "causal_path_to_incident_scope": 15,
    "upstream_anomaly_after_downstream": -20,
    "suspect_quality_sample": -4,
    "isolated_spike": -15,
    "sensor_drift_isolation": -8,
}
ASSUMPTIONS = {
    "ranking": "relative support points, not probability or calibrated confidence",
    "threshold": "robust-z absolute value >= 6 from the frozen initial 30 valid samples",
    "propagation": "FEEDS propagates source to target; DEPENDS_ON propagates target to dependent source",
    "time_order": "a candidate root should not begin after an observed downstream anomaly",
    "scope": "synthetic TITAN-WTP-01 topology and telemetry only; not operating guidance",
}


def _stamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("causal timestamps must be timezone-aware")
    return parsed.astimezone(UTC)


def directed_edges(
    assets: list[dict[str, Any]], relations: list[dict[str, Any]]
) -> dict[str, list[tuple[str, str]]]:
    if len(assets) > MAX_ASSETS:
        raise ValueError("causal asset graph exceeds bound")
    ids = {item["asset_id"] for item in assets}
    adjacency: dict[str, list[tuple[str, str]]] = {asset_id: [] for asset_id in ids}
    for relation in relations:
        relation_type = relation.get("relation_type")
        if relation_type not in RELATION_RULES:
            continue
        source, target = relation.get("source_asset_id"), relation.get(
            "target_asset_id"
        )
        if source not in ids or target not in ids:
            raise ValueError(
                "causal graph contains a dangling or cross-scope asset relation"
            )
        if relation_type == "FEEDS":
            adjacency[source].append((target, relation_type))
        else:  # target is a prerequisite of source; a target fault can affect source.
            adjacency[target].append((source, relation_type))
    return adjacency


def impact_path(
    adjacency: dict[str, list[tuple[str, str]]],
    root: str,
    target: str,
    *,
    max_depth: int = MAX_DEPTH,
) -> list[str] | None:
    if not 0 <= max_depth <= MAX_DEPTH:
        raise ValueError("causal graph depth exceeds bound")
    if root == target:
        return [root]
    queue = deque([(root, [root], 0)])
    visited = {root}
    while queue:
        current, path, depth = queue.popleft()
        if depth >= max_depth:
            continue
        for neighbor, _relation in sorted(adjacency.get(current, [])):
            if neighbor in visited:
                continue
            next_path = path + [neighbor]
            if neighbor == target:
                return next_path
            visited.add(neighbor)
            queue.append((neighbor, next_path, depth + 1))
    return None


def _sensor_mode(rows: list[dict[str, Any]]) -> str:
    if len(rows) == 1:
        return "isolated_spike_or_false_positive"
    values = [abs(float(row["robust_z"])) for row in rows]
    increasing = sum(right >= left for left, right in itertools.pairwise(values))
    if len(rows) >= 3 and increasing >= len(rows) - 2 and values[-1] > values[0] * 1.15:
        return "sensor_drift"
    return "sustained_sensor_fault"


def investigate(
    *,
    assets: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    affected_asset_ids: list[str],
    incident_event_id: str,
    incident_at: str,
    expected_sensor_assets: list[str] | None = None,
    max_hypotheses: int = 10,
) -> dict[str, Any]:
    if len(observations) > MAX_OBSERVATIONS or not 1 <= max_hypotheses <= 20:
        raise ValueError("causal observation or hypothesis limit exceeded")
    adjacency = directed_edges(assets, relations)
    asset_ids = set(adjacency)
    affected = sorted(set(affected_asset_ids))
    if not affected or not set(affected).issubset(asset_ids):
        raise ValueError("incident impact scope must contain visible graph assets")
    incident_time = _stamp(incident_at)
    seen_samples: dict[str, dict[str, Any]] = {}
    conflicts: list[dict[str, Any]] = []
    valid: list[dict[str, Any]] = []
    for row in observations:
        try:
            asset_id = row["asset_id"]
            metric = row["metric"]
            source_id = str(row["source_id"])
            robust_z = float(row["robust_z"])
            stamp = _stamp(row["sampled_at"])
            quality = row.get("quality", "good")
            value = float(row["value"])
        except (KeyError, TypeError, ValueError, OverflowError):
            conflicts.append(
                {
                    "code": "invalid_observation",
                    "detail": "An observation failed the typed evidence checks.",
                }
            )
            continue
        if (
            asset_id not in asset_ids
            or not 1 <= len(metric) <= 64
            or not source_id
            or len(source_id) > 192
        ):
            conflicts.append(
                {
                    "code": "invalid_observation_scope",
                    "detail": "An observation refers outside the investigation scope.",
                }
            )
            continue
        if (
            not math.isfinite(value)
            or not math.isfinite(robust_z)
            or abs(robust_z) > 100
            or quality not in {"good", "suspect", "missing"}
        ):
            conflicts.append(
                {
                    "code": "invalid_observation_value",
                    "detail": "An observation has an invalid value, score, or quality flag.",
                }
            )
            continue
        if quality == "missing":
            continue
        normalized = {
            **row,
            "asset_id": asset_id,
            "metric": metric,
            "source_id": source_id,
            "sampled_at": stamp.isoformat().replace("+00:00", "Z"),
            "robust_z": robust_z,
            "value": value,
            "quality": quality,
        }
        prior = seen_samples.get(source_id)
        if prior and (
            prior["value"] != value
            or prior["asset_id"] != asset_id
            or prior["metric"] != metric
        ):
            conflicts.append(
                {
                    "code": "conflicting_sample_citation",
                    "source_id": source_id,
                    "detail": "The same sample reference has contradictory values.",
                }
            )
            prior["contradictory"] = normalized["contradictory"] = True
        else:
            seen_samples[source_id] = normalized
        valid.append(normalized)

    anomaly_by_series: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in valid:
        if abs(item["robust_z"]) >= ANOMALY_THRESHOLD:
            anomaly_by_series[(item["asset_id"], item["metric"])].append(item)
    for rows in anomaly_by_series.values():
        rows.sort(key=lambda item: (item["sampled_at"], item["source_id"]))

    hypotheses: list[dict[str, Any]] = []
    for (asset_id, metric), rows in sorted(anomaly_by_series.items()):
        mode = _sensor_mode(rows)
        root_time = _stamp(rows[0]["sampled_at"])
        path_map = {
            target: impact_path(adjacency, asset_id, target) for target in affected
        }
        relevant_paths = [path for path in path_map.values() if path]
        corroborating_metrics = {
            other_metric
            for (other_asset, other_metric), other_rows in anomaly_by_series.items()
            if other_asset == asset_id
            and other_metric != metric
            and len(other_rows) >= 2
        }
        downstream_before = []
        for target in affected:
            if target == asset_id:
                continue
            path = path_map[target]
            if not path:
                continue
            target_rows = [
                row
                for row in valid
                if row["asset_id"] == target
                and row["metric"] != metric
                and abs(row["robust_z"]) >= ANOMALY_THRESHOLD
            ]
            if (
                target_rows
                and min(_stamp(row["sampled_at"]) for row in target_rows) < root_time
            ):
                downstream_before.extend(target_rows)
        score = min(len(rows), 5) * EVIDENCE_WEIGHTS["sustained_anomaly_sample"]
        score += (
            min(len(corroborating_metrics), 2) * EVIDENCE_WEIGHTS["independent_metric"]
        )
        if relevant_paths:
            score += EVIDENCE_WEIGHTS["causal_path_to_incident_scope"]
        if downstream_before:
            score += EVIDENCE_WEIGHTS["upstream_anomaly_after_downstream"]
        if any(row["quality"] == "suspect" for row in rows):
            score += EVIDENCE_WEIGHTS["suspect_quality_sample"]
        counter: list[dict[str, Any]] = []
        if downstream_before:
            counter.append(
                {
                    "code": "time_order_violation",
                    "message": "Affected-scope anomalies precede this candidate in the permitted propagation direction.",
                    "evidence_refs": [
                        row["source_id"] for row in downstream_before[:5]
                    ],
                }
            )
        if not relevant_paths:
            counter.append(
                {
                    "code": "no_graph_path",
                    "message": "No allowed directed dependency path connects this candidate to the incident scope.",
                }
            )
        if mode == "isolated_spike_or_false_positive":
            score += EVIDENCE_WEIGHTS["isolated_spike"]
            counter.append(
                {
                    "code": "single_sample",
                    "message": "One abnormal sample is insufficient to distinguish a fault from noise or sensor error.",
                    "evidence_refs": [rows[0]["source_id"]],
                }
            )
        if mode == "sensor_drift":
            score += EVIDENCE_WEIGHTS["sensor_drift_isolation"]
            counter.append(
                {
                    "code": "single_sensor_drift",
                    "message": "A monotone single-channel trend may be sensor drift; no independent channel confirms a physical cause.",
                    "evidence_refs": [row["source_id"] for row in rows[:5]],
                }
            )
        if any(row.get("contradictory") for row in rows):
            counter.append(
                {
                    "code": "contradictory_citation",
                    "message": "Conflicting records share a telemetry citation.",
                }
            )
        score = max(0, min(100, int(score)))
        candidate_path = next((path for path in relevant_paths), [asset_id])
        uncertainty_reasons = []
        if len(rows) < 3:
            uncertainty_reasons.append("fewer than three anomalous samples")
        if downstream_before:
            uncertainty_reasons.append("temporal contradiction")
        if conflicts:
            uncertainty_reasons.append("one or more evidence conflicts")
        if mode in {"sensor_drift", "isolated_spike_or_false_positive"}:
            uncertainty_reasons.append("sensor artifact remains plausible")
        hypotheses.append(
            {
                "hypothesis_id": f"{asset_id}:{metric}:{mode}",
                "root_asset_id": asset_id,
                "metric": metric,
                "cause_type": mode,
                "status": "hypothesis",
                "relative_support_score": score,
                "supporting_evidence": [
                    {
                        "kind": "telemetry_sample",
                        "source_id": row["source_id"],
                        "asset_id": asset_id,
                        "metric": metric,
                        "sampled_at": row["sampled_at"],
                        "value": row["value"],
                        "robust_z": row["robust_z"],
                        "quality": row["quality"],
                    }
                    for row in rows[:20]
                ],
                "counterevidence": counter,
                "assumptions": dict(ASSUMPTIONS),
                "impact_path": candidate_path,
                "affected_asset_ids": affected,
                "uncertainty": {
                    "level": "high" if uncertainty_reasons else "moderate",
                    "reasons": uncertainty_reasons
                    or ["fixture ranking weights are not calibrated probabilities"],
                },
                "first_observed_at": rows[0]["sampled_at"],
                "last_observed_at": rows[-1]["sampled_at"],
                "incident_event_id": incident_event_id,
            }
        )
    hypotheses.sort(
        key=lambda item: (
            -item["relative_support_score"],
            item["root_asset_id"],
            item["metric"],
            item["cause_type"],
        )
    )
    hypotheses = hypotheses[:max_hypotheses]

    expected = sorted(set(expected_sensor_assets or []))
    if not set(expected).issubset(asset_ids):
        raise ValueError("expected observation scope contains an invisible asset")
    observed_assets = {row["asset_id"] for row in valid}
    missing = [asset_id for asset_id in expected if asset_id not in observed_assets]
    contradiction_flags = list(conflicts)
    if any(
        item["code"] == "time_order_violation"
        for hypothesis in hypotheses
        for item in hypothesis["counterevidence"]
    ):
        contradiction_flags.append(
            {
                "code": "causal_time_order_conflict",
                "detail": "At least one proposed path conflicts with observed event timing.",
            }
        )
    if not hypotheses:
        status = "insufficient_evidence"
    elif contradiction_flags:
        status = "ambiguous"
    elif missing:
        status = "needs_observation"
    elif (
        len(hypotheses) > 1
        and hypotheses[0]["relative_support_score"]
        - hypotheses[1]["relative_support_score"]
        < 10
    ):
        status = "ambiguous"
    else:
        status = "hypotheses"
    additional = [
        {
            "asset_id": asset_id,
            "request": "Collect a fresh approved observation for this sensor.",
            "operational_action": False,
        }
        for asset_id in missing[:10]
    ]
    timeline = [
        {
            "at": row["sampled_at"],
            "asset_id": row["asset_id"],
            "metric": row["metric"],
            "robust_z": row["robust_z"],
            "source_id": row["source_id"],
        }
        for row in sorted(
            valid, key=lambda item: (item["sampled_at"], item["source_id"])
        )
        if abs(row["robust_z"]) >= ANOMALY_THRESHOLD
    ][:100]
    return {
        "status": status,
        "claim_scope": "ranked_hypotheses_only",
        "incident_event_id": incident_event_id,
        "incident_at": incident_time.isoformat().replace("+00:00", "Z"),
        "affected_asset_ids": affected,
        "hypotheses": hypotheses,
        "contradiction_flags": contradiction_flags,
        "additional_observations_requested": additional,
        "timeline": timeline,
        "ranking_assumptions": dict(ASSUMPTIONS),
        "ranking_weights": dict(EVIDENCE_WEIGHTS),
        "model_calls": {
            "attempted": False,
            "reason": "No entitled local/cloud structured causal provider is wired; no model confidence was used.",
        },
        "operational_advice": [],
    }


def validate_evidence_references(
    result: dict[str, Any], known_source_ids: set[str], incident_event_id: str
) -> None:
    if result.get("incident_event_id") != incident_event_id:
        raise ValueError("result incident citation is invalid")
    for hypothesis in result.get("hypotheses", []):
        if hypothesis.get("status") != "hypothesis":
            raise ValueError("causal findings must remain hypotheses")
        for ref in hypothesis.get("supporting_evidence", []):
            if ref.get("source_id") not in known_source_ids:
                raise ValueError("hypothesis contains an invalid telemetry citation")
        for item in hypothesis.get("counterevidence", []):
            if any(
                ref not in known_source_ids for ref in item.get("evidence_refs", [])
            ):
                raise ValueError(
                    "counterevidence contains an invalid telemetry citation"
                )
