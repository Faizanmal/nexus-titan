"""Deterministic synthetic hydraulic network; not an engineering solver."""

from __future__ import annotations

import json
import math
from typing import Any

from .privacy_policy import canonical_digest

SOLVER_ID = "nexus-linear-hydraulic-fixture-v1"
DT_SECONDS = 60
HORIZON_SECONDS = 3600
TOLERANCE_M3H = 1e-9
EFFICIENCY = 0.70


def can_operate_simulator(role: str) -> bool:
    return role in {"owner", "admin", "operator"}


def can_supervise_simulator(role: str) -> bool:
    return role in {"owner", "admin"}


# Fictional compact network used for solver behavior/equation tests. Values are
# explicitly synthetic and independent from any field asset's operating data.
NETWORK = {
    "unit_system": {
        "pressure": "kPa_gauge",
        "flow": "m3/h",
        "resistance": "kPa/(m3/h)",
        "energy": "kWh_proxy",
    },
    "nodes": ["source_main", "junction", "consumer"],
    "fixed_heads_kpa": {"source_main": 450.0},
    "demands_m3h": {"consumer": 4.0},
    "links": [
        {
            "link_id": "main_to_junction",
            "from": "source_main",
            "to": "junction",
            "resistance": 20.0,
        },
        {
            "link_id": "junction_to_consumer",
            "from": "junction",
            "to": "consumer",
            "resistance": 30.0,
        },
    ],
    "max_capacity_m3h": 6.0,
    "minimum_service_pressure_kpa": 200.0,
}


def _validate_network(network: dict[str, Any]) -> None:
    nodes = network.get("nodes")
    if (
        not isinstance(nodes, list)
        or not 2 <= len(nodes) <= 32
        or len(nodes) != len(set(nodes))
    ):
        raise ValueError("invalid bounded network node set")
    ids = set(nodes)
    fixed, demands, links = (
        network.get("fixed_heads_kpa"),
        network.get("demands_m3h"),
        network.get("links"),
    )
    if (
        not isinstance(fixed, dict)
        or not fixed
        or not set(fixed).issubset(ids)
        or not isinstance(demands, dict)
        or not demands
        or not set(demands).issubset(ids)
    ):
        raise ValueError("network must have fixed source heads and demand nodes")
    if (
        set(fixed) & set(demands)
        or not isinstance(links, list)
        or not 1 <= len(links) <= 64
    ):
        raise ValueError("invalid source/demand overlap or bounded link list")
    for mapping in (fixed, demands):
        if any(
            not math.isfinite(float(value)) or float(value) < 0
            for value in mapping.values()
        ):
            raise ValueError("heads and demands must be finite and nonnegative")
    link_ids: set[str] = set()
    for link in links:
        if (
            not isinstance(link, dict)
            or link.get("from") not in ids
            or link.get("to") not in ids
            or link.get("from") == link.get("to")
        ):
            raise ValueError("link endpoint is invalid")
        if not isinstance(link.get("link_id"), str) or link["link_id"] in link_ids:
            raise ValueError("link ID is missing or duplicated")
        link_ids.add(link["link_id"])
        resistance = float(link.get("resistance", 0))
        if not math.isfinite(resistance) or resistance <= 0 or resistance > 1e6:
            raise ValueError("link resistance must be finite, positive and bounded")
    if any(
        not math.isfinite(float(network.get(key, 0))) or float(network[key]) <= 0
        for key in ("max_capacity_m3h", "minimum_service_pressure_kpa")
    ):
        raise ValueError(
            "capacity and service pressure limits must be finite and positive"
        )
    # Connectedness prevents silently floating disconnected sub-networks.
    graph = {node: set() for node in nodes}
    for link in links:
        graph[link["from"]].add(link["to"])
        graph[link["to"]].add(link["from"])
    visited = set()
    stack = [next(iter(ids))]
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        stack.extend(graph[node] - visited)
    if visited != ids:
        raise ValueError("network contains disconnected nodes")


def _linear_solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Small bounded Gaussian elimination with partial pivoting."""
    n = len(vector)
    a = [list(map(float, row)) + [float(vector[i])] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(a[row][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise ValueError("hydraulic system is singular or nonconvergent")
        a[col], a[pivot] = a[pivot], a[col]
        factor = a[col][col]
        a[col] = [value / factor for value in a[col]]
        for row in range(n):
            if row == col:
                continue
            factor = a[row][col]
            a[row] = [x - factor * y for x, y in zip(a[row], a[col])]
    result = [row[-1] for row in a]
    if any(not math.isfinite(value) for value in result):
        raise ValueError("hydraulic system produced nonfinite heads")
    return result


def apply_intervention(network: dict[str, Any], intervention: str) -> dict[str, Any]:
    """Simulator reducer: only these two virtual, non-actuating actions exist."""
    if intervention not in {"virtual_backup", "synthetic_resistance"}:
        raise ValueError("intervention is not in the simulator allowlist")
    result = json.loads(json.dumps(network))
    if intervention == "virtual_backup":
        result["nodes"].append("source_virtual_backup")
        result["fixed_heads_kpa"]["source_virtual_backup"] = 470.0
        result["links"].append(
            {
                "link_id": "virtual_backup_to_junction",
                "from": "source_virtual_backup",
                "to": "junction",
                "resistance": 20.0,
            }
        )
    else:
        for link in result["links"]:
            if link["link_id"] == "junction_to_consumer":
                link["resistance"] *= 1.5
    _validate_network(result)
    return result


def solve(
    network: dict[str, Any] | None = None,
    *,
    input_snapshot_hash: str,
    seed: int = 20261115,
    intervention: str | None = None,
) -> dict[str, Any]:
    if (
        not isinstance(input_snapshot_hash, str)
        or len(input_snapshot_hash) != 64
        or any(ch not in "0123456789abcdef" for ch in input_snapshot_hash)
    ):
        raise ValueError("input snapshot hash must be a lowercase SHA-256 digest")
    base = json.loads(json.dumps(network or NETWORK))
    if intervention:
        base = apply_intervention(base, intervention)
    _validate_network(base)
    fixed = {key: float(value) for key, value in base["fixed_heads_kpa"].items()}
    demands = {key: float(value) for key, value in base["demands_m3h"].items()}
    unknown = [node for node in base["nodes"] if node not in fixed]
    index = {node: i for i, node in enumerate(unknown)}
    matrix = [[0.0 for _ in unknown] for _ in unknown]
    rhs = [-demands.get(node, 0.0) for node in unknown]
    for link in base["links"]:
        left, right = link["from"], link["to"]
        conductance = 1.0 / float(link["resistance"])
        for node, other in ((left, right), (right, left)):
            if node not in index:
                continue
            i = index[node]
            matrix[i][i] += conductance
            if other in index:
                matrix[i][index[other]] -= conductance
            else:
                rhs[i] += conductance * fixed[other]
    solved = _linear_solve(matrix, rhs)
    heads = {**fixed, **{node: solved[i] for node, i in index.items()}}
    flows = []
    net = {node: 0.0 for node in base["nodes"]}
    source_injection = {node: 0.0 for node in fixed}
    for link in base["links"]:
        flow = (heads[link["from"]] - heads[link["to"]]) / float(link["resistance"])
        flows.append(
            {
                "link_id": link["link_id"],
                "from": link["from"],
                "to": link["to"],
                "flow_m3h": round(flow, 9),
                "resistance_kpa_per_m3h": float(link["resistance"]),
            }
        )
        net[link["from"]] -= flow
        net[link["to"]] += flow
        if link["from"] in fixed:
            source_injection[link["from"]] += flow
        if link["to"] in fixed:
            source_injection[link["to"]] -= flow
    residuals = {node: net[node] - demands.get(node, 0.0) for node in unknown}
    max_residual = max((abs(value) for value in residuals.values()), default=0.0)
    if max_residual > TOLERANCE_M3H:
        raise ValueError("hydraulic solver failed continuity tolerance")
    demand = sum(demands.values())
    service_heads = [heads[node] for node in demands]
    min_pressure = min(service_heads)
    pressure_short = min_pressure < float(base["minimum_service_pressure_kpa"])
    capacity_exceeded = demand > float(base["max_capacity_m3h"])
    steps = HORIZON_SECONDS // DT_SECONDS
    downtime_hours = (
        (HORIZON_SECONDS / 3600.0) if pressure_short or capacity_exceeded else 0.0
    )
    # Static steady state is repeated per timestep; this is an energy proxy only.
    # Fixed source head is treated as a synthetic pump lift from 0 kPa suction.
    pump_power_kw = (
        sum(
            max(0.0, fixed[node]) * max(0.0, flow)
            for node, flow in source_injection.items()
        )
        / 3600.0
        / EFFICIENCY
    )
    energy_kwh = pump_power_kw * (DT_SECONDS / 3600.0) * steps
    output = {
        "solver_id": SOLVER_ID,
        "solver_tier": "simplified_deterministic_not_engineering_grade",
        "input_snapshot_hash": input_snapshot_hash,
        "seed": seed,
        "time_step_seconds": DT_SECONDS,
        "horizon_seconds": HORIZON_SECONDS,
        "steps": steps,
        "converged": True,
        "continuity_tolerance_m3h": TOLERANCE_M3H,
        "max_continuity_residual_m3h": max_residual,
        "residual_by_node_m3h": {
            key: round(value, 12) for key, value in residuals.items()
        },
        "pressure_by_node_kpa_gauge": {
            key: round(value, 6) for key, value in heads.items()
        },
        "flows": flows,
        "demand_m3h": demand,
        "capacity_m3h": float(base["max_capacity_m3h"]),
        "capacity_margin_m3h": round(float(base["max_capacity_m3h"]) - demand, 6),
        "minimum_service_pressure_kpa_gauge": float(
            base["minimum_service_pressure_kpa"]
        ),
        "service_pressure_shortfall": pressure_short,
        "capacity_exceeded": capacity_exceeded,
        "energy_kwh_proxy": round(energy_kwh, 9),
        "downtime_hours_proxy": downtime_hours,
        "intervention": intervention or "baseline",
        "units": {
            "head": "kPa_gauge",
            "flow": "m3/h",
            "resistance": "kPa/(m3/h)",
            "energy": "kWh_proxy",
            "downtime": "hours_proxy",
        },
        "critic": {
            "constraints_passed": not pressure_short and not capacity_exceeded,
            "pressure_constraint_passed": not pressure_short,
            "capacity_constraint_passed": not capacity_exceeded,
            "tradeoff_summary": "Synthetic constraints only; no engineering recommendation.",
        },
        "uncertainty": {
            "class": "structural_unquantified",
            "drivers": [
                "fictional topology",
                "assumed linear resistance",
                "fixed heads without pump curves",
                "no tank state or transient model",
                "proxy efficiency and downtime thresholds",
            ],
        },
        "model_generated_measurements": False,
        "limitations": [
            "fixed-head sources; no pump curves",
            "no tank storage/level dynamics",
            "linear headloss instead of Darcy-Weisbach/Hazen-Williams",
            "steady state repeated over a one-hour synthetic horizon",
            "no water quality or transient analysis",
            "not suitable for engineering decisions",
        ],
    }
    validate_result(output, input_snapshot_hash=input_snapshot_hash)
    output["verification"] = {
        "input_snapshot_hash_matches": True,
        "units_validated": True,
        "finite_measurements": True,
        "continuity_validated": True,
        "no_model_generated_measurements": True,
    }
    output["output_hash"] = canonical_digest(output)
    return output


def validate_result(result: dict[str, Any], *, input_snapshot_hash: str) -> None:
    expected_units = {
        "head": "kPa_gauge",
        "flow": "m3/h",
        "resistance": "kPa/(m3/h)",
        "energy": "kWh_proxy",
        "downtime": "hours_proxy",
    }
    if (
        result.get("solver_id") != SOLVER_ID
        or result.get("input_snapshot_hash") != input_snapshot_hash
    ):
        raise ValueError(
            "simulation source snapshot or solver citation failed validation"
        )
    if (
        result.get("units") != expected_units
        or result.get("model_generated_measurements") is not False
    ):
        raise ValueError("simulation units or measurement provenance failed validation")
    values = [
        result.get("max_continuity_residual_m3h"),
        result.get("energy_kwh_proxy"),
        result.get("downtime_hours_proxy"),
        result.get("demand_m3h"),
        result.get("capacity_m3h"),
        *result.get("pressure_by_node_kpa_gauge", {}).values(),
    ]
    values.extend(flow.get("flow_m3h") for flow in result.get("flows", []))
    if not values or any(
        not isinstance(value, (int, float)) or not math.isfinite(float(value))
        for value in values
    ):
        raise ValueError("simulation contains nonfinite or untyped numerical output")
    if (
        result.get("converged") is not True
        or float(result["max_continuity_residual_m3h"]) > TOLERANCE_M3H
    ):
        raise ValueError("simulation output failed the numerical convergence gate")


def compare_scenarios(
    *,
    input_snapshot_hash: str,
    seed: int = 20261115,
    network: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scenarios = [
        solve(network, input_snapshot_hash=input_snapshot_hash, seed=seed),
        solve(
            network,
            input_snapshot_hash=input_snapshot_hash,
            seed=seed,
            intervention="virtual_backup",
        ),
        solve(
            network,
            input_snapshot_hash=input_snapshot_hash,
            seed=seed,
            intervention="synthetic_resistance",
        ),
    ]
    return {
        "solver_version": SOLVER_ID,
        "input_snapshot_hash": input_snapshot_hash,
        "scenarios": scenarios,
        "same_snapshot_and_seed": len(
            {(row["input_snapshot_hash"], row["seed"]) for row in scenarios}
        )
        == 1,
    }


def propose_intervention(
    intervention: str, *, input_snapshot_hash: str
) -> dict[str, Any]:
    if intervention not in {"virtual_backup", "synthetic_resistance"}:
        raise ValueError("intervention is not in the simulator allowlist")
    action = {
        "intervention": intervention,
        "simulator_only": True,
        "no_actuator_path": True,
    }
    return {
        "action": action,
        "action_hash": canonical_digest(action),
        "snapshot_hash": input_snapshot_hash,
    }


def validate_approval(
    *,
    proposed: dict[str, Any],
    action: dict[str, Any],
    snapshot_hash: str,
    expires_at: str,
    now: str,
    actor_id: str,
    approver_id: str,
    role: str,
    state: str,
) -> None:
    from datetime import UTC, datetime

    expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    current = datetime.fromisoformat(now.replace("Z", "+00:00"))
    if (
        expiry.tzinfo is None
        or current.tzinfo is None
        or current.astimezone(UTC) >= expiry.astimezone(UTC)
    ):
        raise ValueError("APPROVAL_EXPIRED")
    if not can_supervise_simulator(role):
        raise ValueError("APPROVAL_ROLE_FORBIDDEN")
    if approver_id == actor_id:
        raise ValueError("APPROVAL_SEPARATION_REQUIRED")
    if state != "pending":
        raise ValueError("APPROVAL_REPLAY")
    if (
        action != proposed["action"]
        or snapshot_hash != proposed["snapshot_hash"]
        or canonical_digest(action) != proposed["action_hash"]
    ):
        raise ValueError("APPROVAL_BINDING_MISMATCH")
