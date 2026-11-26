from __future__ import annotations

import copy
import json
from pathlib import Path

from nexus_titan_api.event_routes import event_policy_denial
from nexus_titan_api.event_store import (
    append_precondition_result,
    canonical_hash,
    reduce_aggregate,
)
from nexus_titan_api.event_worker import (
    projection_sequence_action,
    publish_firestore_once,
)

ROOT = Path(__file__).resolve().parents[3]
SYNC_FIXTURE = ROOT / "tests/fixtures/contracts/v1.1.0/sync-event-batch.json"


def sample_event() -> dict:
    return json.loads(SYNC_FIXTURE.read_text(encoding="utf-8"))["events"][0]


def test_canonical_payload_hash_is_independent_of_object_key_order() -> None:
    first = {"event_id": "event", "payload": {"name": "x", "state": "active"}}
    second = {"payload": {"state": "active", "name": "x"}, "event_id": "event"}
    assert canonical_hash(first) == canonical_hash(second)


def test_append_preconditions_cover_duplicate_idempotency_sequence_and_revision() -> (
    None
):
    event = sample_event()
    digest = canonical_hash(event)
    duplicate = append_precondition_result(
        event_id=event["event_id"],
        payload_hash=digest,
        existing_hash=digest,
        existing_sequence=7,
        last_sequence=9,
        event_sequence=8,
        expected_revision=0,
        actual_revision=4,
    )
    assert duplicate == {
        "event_id": event["event_id"],
        "status": "duplicate",
        "sequence": 7,
    }

    reused = append_precondition_result(
        event_id=event["event_id"],
        payload_hash=digest,
        existing_hash=b"different",
        existing_sequence=7,
        last_sequence=9,
        event_sequence=10,
        expected_revision=4,
        actual_revision=4,
    )
    assert reused["code"] == "EVENT_ID_REUSED"

    out_of_order = append_precondition_result(
        event_id=event["event_id"],
        payload_hash=digest,
        existing_hash=None,
        existing_sequence=None,
        last_sequence=9,
        event_sequence=11,
        expected_revision=0,
        actual_revision=0,
    )
    assert out_of_order == {
        "event_id": event["event_id"],
        "status": "conflict",
        "code": "SEQUENCE_CONFLICT",
        "expected_sequence": 10,
    }

    stale_revision = append_precondition_result(
        event_id=event["event_id"],
        payload_hash=digest,
        existing_hash=None,
        existing_sequence=None,
        last_sequence=9,
        event_sequence=10,
        expected_revision=2,
        actual_revision=3,
    )
    assert stale_revision["code"] == "REVISION_CONFLICT"
    assert (
        append_precondition_result(
            event_id=event["event_id"],
            payload_hash=digest,
            existing_hash=None,
            existing_sequence=None,
            last_sequence=9,
            event_sequence=10,
            expected_revision=3,
            actual_revision=3,
        )
        is None
    )


def test_asset_and_incident_reducers_are_deterministic_and_conflict_instead_of_lww() -> (
    None
):
    created = reduce_aggregate(
        aggregate_type="asset",
        event_type="asset.created",
        prior_state={},
        patch={"name": "pump", "status": "active"},
    )
    updated = reduce_aggregate(
        aggregate_type="asset",
        event_type="asset.updated",
        prior_state=created,
        patch={"status": "offline"},
    )
    assert updated == {"name": "pump", "status": "offline", "_deleted": False}
    deleted = reduce_aggregate(
        aggregate_type="asset",
        event_type="asset.deleted",
        prior_state=updated,
        patch={},
    )
    assert deleted == {"_deleted": True}

    incident = reduce_aggregate(
        aggregate_type="incident",
        event_type="incident.created",
        prior_state={},
        patch={"severity": "medium"},
    )
    assert incident == {"severity": "medium", "_deleted": False}

    try:
        reduce_aggregate(
            aggregate_type="asset",
            event_type="asset.updated",
            prior_state=deleted,
            patch={"status": "active"},
        )
    except ValueError as error:
        assert "resurrect" in str(error)
    else:
        raise AssertionError("updates after delete must not silently recreate state")


def test_event_policy_denies_roles_sources_classification_and_cross_scope() -> None:
    event = sample_event()
    assert (
        event_policy_denial(
            event, role="owner", tenant_id="tenant-demo", allowed_sites={"site-demo"}
        )
        is None
    )

    for changed, expected in [
        ({"source": "worker"}, "SOURCE_FORBIDDEN"),
        ({"classification": "restricted"}, "CLASSIFICATION_FORBIDDEN"),
        ({"tenant_id": "tenant-other"}, "TENANT_SCOPE_VIOLATION"),
        ({"site_id": "site-other"}, "SITE_SCOPE_VIOLATION"),
        ({"event_type": "incident.created"}, "EVENT_POLICY_DENIED"),
    ]:
        candidate = copy.deepcopy(event)
        candidate.update(changed)
        assert (
            event_policy_denial(
                candidate,
                role="operator",
                tenant_id="tenant-demo",
                allowed_sites={"site-demo"},
            )
            == expected
        )
    assert (
        event_policy_denial(
            event, role="viewer", tenant_id="tenant-demo", allowed_sites={"site-demo"}
        )
        == "ROLE_FORBIDDEN"
    )


def test_projection_consumer_accepts_rebuild_ahead_of_queued_delivery_and_detects_gaps() -> (
    None
):
    assert (
        projection_sequence_action(
            inbox_inserted=True, incoming_sequence=5, last_sequence=8
        )
        == "rebuild_skip"
    )
    assert (
        projection_sequence_action(
            inbox_inserted=True, incoming_sequence=9, last_sequence=8
        )
        == "apply"
    )
    assert (
        projection_sequence_action(
            inbox_inserted=True, incoming_sequence=10, last_sequence=8
        )
        == "gap"
    )
    assert (
        projection_sequence_action(
            inbox_inserted=False, incoming_sequence=5, last_sequence=8
        )
        == "duplicate"
    )


def test_firestore_delivery_is_inert_when_the_optional_adapter_is_disabled(
    monkeypatch,
) -> None:
    monkeypatch.setenv("FIRESTORE_PROJECTIONS_ENABLED", "false")
    monkeypatch.setattr(
        "nexus_titan_api.event_worker.pending_projection_outbox",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("disabled projection must not query")
        ),
    )
    assert publish_firestore_once() == 0
