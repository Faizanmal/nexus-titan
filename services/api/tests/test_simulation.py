from datetime import UTC, datetime, timedelta

import pytest

from nexus_titan_api.simulation import (
    NETWORK,
    SOLVER_ID,
    can_operate_simulator,
    can_supervise_simulator,
    compare_scenarios,
    propose_intervention,
    solve,
    validate_approval,
)

SNAPSHOT = "a" * 64
NOW = datetime.now(UTC)


def test_analytical_small_network_and_continuity_tolerance():
    result = solve(input_snapshot_hash=SNAPSHOT)
    assert result["solver_id"] == SOLVER_ID
    assert result["pressure_by_node_kpa_gauge"]["junction"] == 370
    assert result["pressure_by_node_kpa_gauge"]["consumer"] == 250
    assert [link["flow_m3h"] for link in result["flows"]] == [4, 4]
    assert result["max_continuity_residual_m3h"] <= 1e-9
    assert result["converged"] is True
    assert result["service_pressure_shortfall"] is False
    assert result["model_generated_measurements"] is False
    assert result["verification"]["input_snapshot_hash_matches"] is True


def test_baseline_and_variants_are_reproducible_and_same_input():
    first = compare_scenarios(input_snapshot_hash=SNAPSHOT, seed=12)
    second = compare_scenarios(input_snapshot_hash=SNAPSHOT, seed=12)
    assert first == second
    assert first["same_snapshot_and_seed"] is True
    assert len(first["scenarios"]) == 3
    assert {item["intervention"] for item in first["scenarios"]} == {
        "baseline",
        "virtual_backup",
        "synthetic_resistance",
    }
    assert len({item["output_hash"] for item in first["scenarios"]}) == 3


def test_intervention_tradeoffs_are_bounded_and_honestly_labeled():
    rows = {
        item["intervention"]: item
        for item in compare_scenarios(input_snapshot_hash=SNAPSHOT)["scenarios"]
    }
    assert rows["virtual_backup"]["pressure_by_node_kpa_gauge"]["consumer"] == 300
    assert rows["synthetic_resistance"]["pressure_by_node_kpa_gauge"]["consumer"] == 190
    assert rows["synthetic_resistance"]["service_pressure_shortfall"] is True
    assert rows["synthetic_resistance"]["critic"]["constraints_passed"] is False
    assert (
        rows["virtual_backup"]["solver_tier"]
        == "simplified_deterministic_not_engineering_grade"
    )
    assert rows["baseline"]["energy_kwh_proxy"] > 0


@pytest.mark.parametrize(
    "mutate",
    [
        lambda net: net["links"][0].update(resistance=0),
        lambda net: net["demands_m3h"].update(consumer=-1),
        lambda net: net["links"][0].update(to="missing"),
        lambda net: net["nodes"].append("unconnected"),
    ],
)
def test_impossible_or_malformed_networks_are_rejected(mutate):
    import copy

    net = copy.deepcopy(NETWORK)
    mutate(net)
    with pytest.raises(ValueError):
        solve(net, input_snapshot_hash=SNAPSHOT)


def test_snapshot_hash_and_unapproved_interventions_rejected():
    with pytest.raises(ValueError, match="SHA-256"):
        solve(input_snapshot_hash="short")
    with pytest.raises(ValueError, match="allowlist"):
        solve(input_snapshot_hash=SNAPSHOT, intervention="open_real_valve")
    proposal = propose_intervention("virtual_backup", input_snapshot_hash=SNAPSHOT)
    assert proposal["action"]["no_actuator_path"] is True
    assert can_operate_simulator("operator") is True
    assert can_operate_simulator("viewer") is False
    assert can_supervise_simulator("admin") is True
    assert can_supervise_simulator("operator") is False


def test_approval_binds_snapshot_action_expiry_and_distinct_supervisor():
    proposal = propose_intervention("virtual_backup", input_snapshot_hash=SNAPSHOT)
    common = {
        "proposed": proposal,
        "action": proposal["action"],
        "snapshot_hash": SNAPSHOT,
        "expires_at": (NOW + timedelta(minutes=5)).isoformat(),
        "now": NOW.isoformat(),
        "actor_id": "operator-1",
        "approver_id": "admin-1",
        "role": "admin",
        "state": "pending",
    }
    validate_approval(**common)
    with pytest.raises(ValueError, match="SEPARATION"):
        validate_approval(**{**common, "approver_id": "operator-1"})
    with pytest.raises(ValueError, match="ROLE"):
        validate_approval(**{**common, "role": "operator"})
    with pytest.raises(ValueError, match="BINDING"):
        validate_approval(**{**common, "snapshot_hash": "b" * 64})
    with pytest.raises(ValueError, match="EXPIRED"):
        validate_approval(**{**common, "now": (NOW + timedelta(minutes=6)).isoformat()})
    with pytest.raises(ValueError, match="REPLAY"):
        validate_approval(**{**common, "state": "approved"})
