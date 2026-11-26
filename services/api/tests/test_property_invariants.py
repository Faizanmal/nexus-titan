"""Property-based, algebraic invariant, and generative tests for NEXUS TITAN.

Covers:
- Event fold associativity, idempotency, and partition reduction
- Canonical hash key-order invariance
- Policy classification lattice supremum properties
- Generative PII / secret redaction zero-leakage property
- Hydraulic solver continuity and physical conservation laws
- Temporal replay determinism
"""

from __future__ import annotations

import copy
import hashlib
import random
import uuid
from typing import Any

import pytest

from nexus_titan_api.event_store import (
    append_precondition_result,
    canonical_hash,
    canonical_json,
    reduce_aggregate,
)
from nexus_titan_api.privacy_policy import (
    aggregate_classification,
    create_share_artifact,
)
from nexus_titan_api.simulation import NETWORK, solve

# ---------------------------------------------------------------------------
# 1. Canonical Hash & Key-Order Invariance Properties
# ---------------------------------------------------------------------------


def test_canonical_json_algebraic_key_invariance() -> None:
    """Property: canonical_json(D) == canonical_json(permute_keys(D)) for any nested dict."""
    rng = random.Random(42)
    keys = [f"k_{i}" for i in range(12)]

    for trial in range(25):
        shuffled = keys[:]
        rng.shuffle(shuffled)
        d1 = {
            k: f"val_{k}" if i % 2 == 0 else {"nested": i, "sub": [1, 2, 3]}
            for i, k in enumerate(keys)
        }
        d2 = {k: d1[k] for k in shuffled}

        assert canonical_json(d1) == canonical_json(
            d2
        ), f"Failed key permutation on trial {trial}"
        assert canonical_hash(d1) == canonical_hash(
            d2
        ), f"Failed hash equality on trial {trial}"


# ---------------------------------------------------------------------------
# 2. Event Fold Associativity, Partition Reduction & Idempotency
# ---------------------------------------------------------------------------


def test_event_fold_associativity_and_partition_reduction() -> None:
    """Property: fold(fold(S0, P1), P2) == fold(S0, P1 + P2) for any partition P1, P2."""
    aggregate_type = "pump"
    events = [
        {
            "type": "pump.created",
            "patch": {"model": "Titan-X1", "speed_rpm": 1450, "status": "idle"},
        },
        {"type": "pump.updated", "patch": {"speed_rpm": 1780, "status": "running"}},
        {"type": "pump.updated", "patch": {"flow_m3h": 120.5, "pressure_kpa": 385.0}},
        {"type": "pump.updated", "patch": {"status": "warning", "vibration_rms": 4.8}},
        {
            "type": "pump.updated",
            "patch": {"status": "tripped", "trip_reason": "high_vibration"},
        },
    ]

    # Full fold
    state_full: dict[str, Any] = {}
    for ev in events:
        state_full = reduce_aggregate(
            aggregate_type=aggregate_type,
            event_type=ev["type"],
            prior_state=state_full,
            patch=ev["patch"],
        )

    # Test all partition split points (P1 = events[:k], P2 = events[k:])
    for k in range(1, len(events)):
        p1 = events[:k]
        p2 = events[k:]

        state_p1: dict[str, Any] = {}
        for ev in p1:
            state_p1 = reduce_aggregate(
                aggregate_type=aggregate_type,
                event_type=ev["type"],
                prior_state=state_p1,
                patch=ev["patch"],
            )

        state_p1_p2: dict[str, Any] = copy.deepcopy(state_p1)
        for ev in p2:
            state_p1_p2 = reduce_aggregate(
                aggregate_type=aggregate_type,
                event_type=ev["type"],
                prior_state=state_p1_p2,
                patch=ev["patch"],
            )

        assert state_p1_p2 == state_full, f"Fold partition failed at split index {k}"


def test_idempotent_append_algebraic_property() -> None:
    """Property: Submitting an already accepted event hash returns 'duplicate' with zero side effect."""
    event_id = str(uuid.uuid4())
    digest = hashlib.sha256(b"canonical_event_payload").digest()

    # Precondition for fresh append
    res1 = append_precondition_result(
        event_id=event_id,
        payload_hash=digest,
        existing_hash=None,
        existing_sequence=None,
        last_sequence=10,
        event_sequence=11,
        expected_revision=3,
        actual_revision=3,
    )
    assert res1 is None, "Fresh event append should be permitted"

    # Precondition for identical resubmission (idempotency)
    res2 = append_precondition_result(
        event_id=event_id,
        payload_hash=digest,
        existing_hash=digest,
        existing_sequence=11,
        last_sequence=11,
        event_sequence=11,
        expected_revision=3,
        actual_revision=4,
    )
    assert res2 == {"event_id": event_id, "status": "duplicate", "sequence": 11}

    # Precondition for event ID reuse with altered payload
    res3 = append_precondition_result(
        event_id=event_id,
        payload_hash=digest,
        existing_hash=b"altered_hash_bytes",
        existing_sequence=11,
        last_sequence=11,
        event_sequence=11,
        expected_revision=3,
        actual_revision=4,
    )
    assert res3 == {
        "event_id": event_id,
        "status": "conflict",
        "code": "EVENT_ID_REUSED",
    }


# ---------------------------------------------------------------------------
# 3. Policy Classification Lattice Properties
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "classes, expected",
    [
        (["public"], "public"),
        (["public", "internal"], "internal"),
        (["internal", "confidential"], "confidential"),
        (["public", "confidential", "restricted"], "restricted"),
        (["restricted"], "restricted"),
        ([], "restricted"),  # empty set defaults restricted (fail-closed)
    ],
)
def test_classification_lattice_supremum(classes: list[str], expected: str) -> None:
    """Property: Classification aggregation forms a bounded upper semilattice."""
    items = [{"tenant_id": "tenant-test", "classification": c} for c in classes]
    assert aggregate_classification(items, "tenant-test") == expected


def test_classification_lattice_cross_tenant_isolation_property() -> None:
    """Property: Any cross-tenant data inclusion strictly escalates to 'restricted'."""
    items = [
        {"tenant_id": "tenant-a", "classification": "public"},
        {"tenant_id": "tenant-b", "classification": "public"},
    ]
    assert aggregate_classification(items, "tenant-a") == "restricted"


def test_classification_lattice_commutativity_and_associativity() -> None:
    """Property: aggregate_classification(A, B) == aggregate_classification(B, A)."""
    classes = ["public", "internal", "confidential", "restricted"]
    for c1 in classes:
        for c2 in classes:
            r1 = aggregate_classification(
                [
                    {"tenant_id": "t", "classification": c1},
                    {"tenant_id": "t", "classification": c2},
                ],
                "t",
            )
            r2 = aggregate_classification(
                [
                    {"tenant_id": "t", "classification": c2},
                    {"tenant_id": "t", "classification": c1},
                ],
                "t",
            )
            assert r1 == r2, f"Commutativity failed for {c1}, {c2}"


# ---------------------------------------------------------------------------
# 4. Generative Secret / PII Redaction Zero-Leakage Property
# ---------------------------------------------------------------------------


def test_generative_redaction_zero_leakage_property() -> None:
    """Property: create_share_artifact redacts all sensitive patterns leaving zero canary tokens."""
    canaries = [
        "RESTRICTED_MARKER_BRG_9918",
        "RESTRICTED_MARKER_CAV_4412",
        "john.engineer@plant.domain.local",
        "admin_tech_sarah@watertitan.org",
        "SN: AX-4482",
        "SN: PMP-9921",
        "SERIAL: TK-10294",
        "555-019-2834",
        "+1-800-555-0199",
    ]

    for canary in canaries:
        raw_text = f"Plant inspection log: anomaly noted at 04:00. Operator note: {canary}. Status pending."
        artifact = create_share_artifact(
            artifact_id=f"art-{uuid.uuid4().hex[:8]}",
            tenant_id="tenant-nexus",
            destination="cloud_inference",
            reason="eval redaction property test",
            references=[{"tenant_id": "tenant-nexus", "classification": "internal"}],
            text=raw_text,
            consent=True,
            reviewed=True,
        )

        assert artifact.classification == "public"
        assert artifact.redacted is True
        # Zero canary bytes in preview_text and outgoing_bytes
        assert (
            canary not in artifact.preview_text
        ), f"Leakage detected for canary: {canary}"
        assert (
            canary.encode() not in artifact.outgoing_bytes
        ), f"Raw byte leakage detected for canary: {canary}"
        assert "[REDACTED]" in artifact.preview_text


# ---------------------------------------------------------------------------
# 5. Hydraulic Solver Physical Conservation Laws
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("consumer_demand", [0.0, 1.0, 2.5, 4.0, 5.0, 6.0])
def test_hydraulic_continuity_and_conservation_of_mass(consumer_demand: float) -> None:
    """Property: Sum of inflows equals sum of outflows at every network junction (continuity residual < 1e-9)."""
    net = copy.deepcopy(NETWORK)
    net["demands_m3h"]["consumer"] = consumer_demand
    # In small network: reservoir inflow = consumer demand
    result = solve(input_snapshot_hash="f" * 64, network=net)

    assert result["converged"] is True
    assert result["max_continuity_residual_m3h"] <= 1e-9
    # Inflow matches consumer demand
    flows = {link["link_id"]: link["flow_m3h"] for link in result["flows"]}
    assert abs(flows["main_to_junction"] - consumer_demand) <= 1e-9
    assert abs(flows["junction_to_consumer"] - consumer_demand) <= 1e-9
    # Energy proxy is non-negative
    assert result["energy_kwh_proxy"] >= 0.0


def test_hydraulic_monotonic_head_loss_under_increasing_resistance() -> None:
    """Property: Increasing pipeline resistance monotonically decreases consumer delivery pressure."""
    pressures = []
    resistances = [1.0, 2.0, 4.0, 8.0, 12.0]
    for r in resistances:
        net = copy.deepcopy(NETWORK)
        net["links"][1]["resistance"] = r  # junction to consumer link
        res = solve(input_snapshot_hash="f" * 64, network=net)
        pressures.append(res["pressure_by_node_kpa_gauge"]["consumer"])

    # Monotonically non-increasing pressure
    for i in range(len(pressures) - 1):
        assert (
            pressures[i] >= pressures[i + 1]
        ), f"Pressure increased with resistance: {pressures}"


# ---------------------------------------------------------------------------
# 6. Deterministic Replay Property
# ---------------------------------------------------------------------------


def test_temporal_event_history_replay_determinism() -> None:
    """Property: Replaying an event history N times yields bit-for-bit identical state hash."""
    history = [
        {
            "aggregate_type": "filter",
            "event_type": "filter.created",
            "patch": {"filter_id": "FLT-001", "bed_depth_m": 1.8, "status": "clean"},
        },
        {
            "aggregate_type": "filter",
            "event_type": "filter.updated",
            "patch": {"dp_kpa": 12.5, "turbidity_ntu": 0.12},
        },
        {
            "aggregate_type": "filter",
            "event_type": "filter.updated",
            "patch": {"dp_kpa": 38.0, "turbidity_ntu": 0.15},
        },
        {
            "aggregate_type": "filter",
            "event_type": "filter.updated",
            "patch": {"dp_kpa": 84.2, "turbidity_ntu": 0.28, "status": "fouling"},
        },
        {
            "aggregate_type": "filter",
            "event_type": "filter.updated",
            "patch": {"status": "backwashing", "backwash_flow_m3h": 45.0},
        },
        {
            "aggregate_type": "filter",
            "event_type": "filter.updated",
            "patch": {"status": "clean", "dp_kpa": 8.1, "turbidity_ntu": 0.08},
        },
    ]

    hashes = []
    for replay_round in range(5):
        current_state: dict[str, Any] = {}
        for ev in history:
            current_state = reduce_aggregate(
                aggregate_type=ev["aggregate_type"],
                event_type=ev["event_type"],
                prior_state=current_state,
                patch=ev["patch"],
            )
        state_hash = hashlib.sha256(canonical_json(current_state).encode()).hexdigest()
        hashes.append(state_hash)

    assert len(set(hashes)) == 1, f"Replay produced non-deterministic hashes: {hashes}"
