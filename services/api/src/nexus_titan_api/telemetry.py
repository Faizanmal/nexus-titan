"""Deterministic synthetic telemetry and explainable baseline anomaly scoring."""

from __future__ import annotations

import math
import random
import statistics
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from typing import Any

FIXTURE_ID = "TITAN-WTP-01"
METRICS = {
    "pressure": ("kPa", 450.0, 12.0),
    "flow": ("m3/h", 36.0, 2.5),
    "vibration": ("mm/s", 2.2, 0.18),
    "temperature": ("degC", 42.0, 1.5),
}
QUALITY = {"good", "suspect", "missing"}


def generate_series(
    world: dict[str, Any],
    *,
    seed: int = 20261115,
    start: datetime | None = None,
    steps: int = 240,
    interval_seconds: int = 15,
    missing_rate: float = 0.015,
    inject_faults: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return public samples and a separately held-out fault-label set."""
    if steps < 40 or steps > 2_000 or interval_seconds < 1 or interval_seconds > 3600:
        raise ValueError("steps or interval is outside the supported bounded range")
    if not 0 <= missing_rate < 0.25:
        raise ValueError("missing_rate must be in [0, 0.25)")
    started = start or datetime(2026, 1, 1, tzinfo=UTC)
    if started.tzinfo is None:
        raise ValueError("start timestamp must include a timezone")
    rng = random.Random(seed)
    quality_rng = random.Random(seed ^ 0x2A7F1D39)
    pumps = sorted(a["asset_id"] for a in world["assets"] if a["asset_type"] == "pump")
    if len(pumps) < 3:
        raise ValueError("world fixture must contain at least three synthetic pumps")
    faults = (
        {
            (pumps[0], "pressure"): (0.68, "sustained_high"),
            (pumps[1], "vibration"): (0.76, "spike"),
            (pumps[2], "flow"): (0.72, "sustained_low"),
            (pumps[0], "temperature"): (0.80, "drift"),
        }
        if inject_faults
        else {}
    )
    public: list[dict[str, Any]] = []
    truth: list[dict[str, Any]] = []
    sequence = 0
    for asset_index, asset_id in enumerate(pumps):
        for metric_index, (metric, (unit, center, noise)) in enumerate(METRICS.items()):
            phase = asset_index * 0.37 + metric_index * 0.53
            fault = faults.get((asset_id, metric))
            fault_start = int(steps * fault[0]) if fault and inject_faults else steps
            for index in range(steps):
                sequence += 1
                stamp = started + timedelta(seconds=index * interval_seconds)
                expected = center + math.sin(index / 17 + phase) * noise * 0.65
                value = expected + rng.gauss(0, noise * 0.45)
                labeled = False
                if fault and inject_faults and index >= fault_start:
                    kind = fault[1]
                    if kind == "sustained_high":
                        value += noise * 9
                        labeled = True
                    elif kind == "sustained_low":
                        value -= noise * 9
                        labeled = True
                    elif kind == "spike" and index == fault_start + 3:
                        value += noise * 18
                        labeled = True
                    elif kind == "drift":
                        value += noise * min(10, 0.25 + (index - fault_start) * 0.24)
                        labeled = (index - fault_start) >= 12
                missing = rng.random() < missing_rate
                # Quality is a data-integrity flag only; anomaly truth stays in the isolated holdout labels.
                quality = (
                    "missing"
                    if missing
                    else ("suspect" if quality_rng.random() < 0.002 else "good")
                )
                sample = {
                    "fixture_id": FIXTURE_ID,
                    "asset_id": asset_id,
                    "metric": metric,
                    "sample_sequence": sequence,
                    "sampled_at": stamp.isoformat().replace("+00:00", "Z"),
                    "value": None if missing else round(value, 4),
                    "unit": unit,
                    "quality": quality,
                }
                public.append(sample)
                if labeled:
                    truth.append(
                        {
                            "asset_id": asset_id,
                            "metric": metric,
                            "sample_sequence": sequence,
                            "fault_type": fault[1],
                            "label": True,
                        }
                    )
    return public, truth


def score_samples(
    samples: list[dict[str, Any]], *, baseline_size: int = 30, threshold: float = 6.0
) -> list[dict[str, Any]]:
    """Score against a frozen initial baseline using robust median/MAD z-scores."""
    if baseline_size < 10 or baseline_size > 1000 or threshold <= 0:
        raise ValueError("invalid detector baseline or threshold")
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in samples:
        grouped[(item["asset_id"], item["metric"])].append(item)
    results: list[dict[str, Any]] = []
    for rows in grouped.values():
        rows.sort(key=lambda row: (row["sampled_at"], row["sample_sequence"]))
        baseline = [
            row["value"] for row in rows[:baseline_size] if row["value"] is not None
        ]
        if len(baseline) < 10:
            raise ValueError("series has insufficient valid baseline samples")
        center = statistics.median(baseline)
        mad = statistics.median(abs(value - center) for value in baseline)
        # 1.4826 makes MAD comparable to standard deviation for normal noise.
        scale = max(mad * 1.4826, abs(center) * 1e-6, 1e-9)
        for row in rows:
            value = row["value"]
            score = None if value is None else (float(value) - center) / scale
            results.append(
                {
                    **row,
                    "robust_z": None if score is None else round(score, 3),
                    "anomaly": bool(score is not None and abs(score) >= threshold),
                }
            )
    results.sort(key=lambda row: (row["sampled_at"], row["sample_sequence"]))
    return results


def holdout_metrics(
    scored: list[dict[str, Any]], labels: list[dict[str, Any]]
) -> dict[str, int | float]:
    truth_ids = {row["sample_sequence"] for row in labels}
    tp = fp = fn = tn = 0
    for row in scored:
        actual = row["sample_sequence"] in truth_ids
        predicted = bool(row["anomaly"])
        if predicted and actual:
            tp += 1
        elif predicted:
            fp += 1
        elif actual:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "true_positive": tp,
        "false_positive": fp,
        "false_negative": fn,
        "true_negative": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
    }


def sustained_alerts(
    scored: list[dict[str, Any]],
    *,
    min_hits: int = 3,
    window: int = 5,
    cooldown_seconds: int = 900,
) -> list[dict[str, Any]]:
    """Require repeated anomaly evidence; cooldown is maintained per asset+metric."""
    if min_hits < 1 or window < min_hits or cooldown_seconds < 1:
        raise ValueError("invalid alert policy")
    series: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in scored:
        if row["quality"] != "missing":
            series[(row["asset_id"], row["metric"])].append(row)
    alerts: list[dict[str, Any]] = []
    for key, rows in series.items():
        rows.sort(key=lambda row: (row["sampled_at"], row["sample_sequence"]))
        recent: deque[dict[str, Any]] = deque(maxlen=window)
        last_alert: datetime | None = None
        for row in rows:
            recent.append(row)
            if sum(bool(item["anomaly"]) for item in recent) < min_hits:
                continue
            stamp = datetime.fromisoformat(row["sampled_at"].replace("Z", "+00:00"))
            if (
                last_alert is not None
                and (stamp - last_alert).total_seconds() < cooldown_seconds
            ):
                continue
            alerts.append(
                {
                    "asset_id": key[0],
                    "metric": key[1],
                    "sampled_at": row["sampled_at"],
                    "evidence_samples": [
                        item["sample_sequence"] for item in recent if item["anomaly"]
                    ],
                }
            )
            last_alert = stamp
    return alerts
