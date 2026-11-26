import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from nexus_titan_api.privacy_policy import (
    POLICY_VERSION,
    aggregate_classification,
    approve_action,
    canonical_digest,
    consume_approval,
    create_approval,
    create_share_artifact,
    dispatch_share_artifact,
    evaluate_privacy,
    normalize_classification,
)

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads(
    (ROOT / "tests/fixtures/privacy/policy-cases.json").read_text(encoding="utf-8")
)


def test_python_policy_matches_shared_vectors():
    assert VECTORS["policy_version"] == POLICY_VERSION
    for case in VECTORS["cases"]:
        decision = evaluate_privacy(
            role=case["role"],
            purpose=case["purpose"],
            destination=case["destination"],
            classification=case.get("classification"),
            tenant_match=case["tenant_match"],
            device_trusted=case["device_trusted"],
            consent=case["consent"],
            approval=case["approval"],
            remote_config=(
                {"requested_ceiling": case["requested_ceiling"]}
                if "requested_ceiling" in case
                else None
            ),
        )
        assert decision["allow"] is case["allow"], case["id"]
        assert decision["reason"] == case["reason"], case["id"]


def test_unknown_defaults_restricted_and_aggregate_is_tenant_scoped():
    assert normalize_classification(None) == "restricted"
    assert normalize_classification("future-class") == "restricted"
    assert aggregate_classification([], "tenant-a") == "restricted"
    assert (
        aggregate_classification(
            [
                {"tenant_id": "tenant-a", "classification": "public"},
                {"tenant_id": "tenant-a", "classification": "confidential"},
            ],
            "tenant-a",
        )
        == "confidential"
    )
    assert (
        aggregate_classification(
            [
                {"tenant_id": "tenant-a", "classification": "public"},
                {"tenant_id": "tenant-b", "classification": "public"},
            ],
            "tenant-a",
        )
        == "restricted"
    )


def test_share_artifact_redaction_preview_exact_bytes_and_review_requirement():
    artifact = create_share_artifact(
        artifact_id="share-test-1",
        tenant_id="tenant-a",
        destination="cloud_inference",
        reason="operator reviewed",
        references=[{"tenant_id": "tenant-a", "classification": "internal"}],
        text="Synthetic contact jane@example.test serial SN: AX-4482",
        consent=True,
        reviewed=True,
    )
    assert artifact.classification == "public"
    assert artifact.preview_text == "Synthetic contact [REDACTED] serial [REDACTED]"
    assert artifact.outgoing_bytes == artifact.preview_text.encode()
    assert artifact.redacted is True
    with pytest.raises(ValueError, match="SHARE_REVIEW_REQUIRED"):
        create_share_artifact(
            artifact_id="share-test-2",
            tenant_id="tenant-a",
            destination="cloud_inference",
            reason="review",
            references=[{"tenant_id": "tenant-a", "classification": "public"}],
            text="jane@example.test",
            consent=True,
            reviewed=False,
        )
    with pytest.raises(ValueError, match="SHARE_SOURCE_DENIED"):
        create_share_artifact(
            artifact_id="share-denied",
            tenant_id="tenant-a",
            destination="cloud_inference",
            reason="review",
            references=[{"tenant_id": "tenant-a"}],
            text="RESTRICTED_MARKER_CANARY",
            consent=True,
            reviewed=True,
        )
    with pytest.raises(ValueError, match="SHARE_REDACTION_UNCERTAIN"):
        create_share_artifact(
            artifact_id="share-uncertain",
            tenant_id="tenant-a",
            destination="cloud_inference",
            reason="review",
            references=[{"tenant_id": "tenant-a", "classification": "public"}],
            text="REDACTION_UNCERTAIN: hidden",
            consent=True,
            reviewed=True,
        )


def test_restricted_canary_is_not_sent_to_any_remote_sink():
    marker = "RESTRICTED_MARKER_DO_NOT_TRANSMIT"
    sent: list[bytes] = []
    for destination, purpose in [
        ("cloud_inference", "approved_summary"),
        ("upload", "approved_artifact"),
        ("peer", "event_replication"),
        ("rag_index", "approved_retrieval"),
        ("sync", "state_sync"),
        ("telemetry", "synthetic_telemetry"),
    ]:
        decision = evaluate_privacy(
            role="operator",
            purpose=purpose,
            destination=destination,
            classification="restricted",
            tenant_match=True,
            device_trusted=True,
            consent=True,
            approval=True,
        )
        assert decision["allow"] is False
        assert decision["reason"] == "CLASSIFICATION_CEILING"
    try:
        artifact = create_share_artifact(
            artifact_id="share-canary",
            tenant_id="tenant-a",
            destination="cloud_inference",
            reason="test",
            references=[{"tenant_id": "tenant-a", "classification": "restricted"}],
            text=marker,
            consent=True,
            reviewed=True,
        )
        asyncio.run(
            dispatch_share_artifact(
                artifact,
                role="operator",
                purpose="approved_summary",
                tenant_match=True,
                device_trusted=True,
                consent=True,
                approval=True,
                sink=lambda _destination, payload: sent.append(payload),
            )
        )
    except ValueError as error:
        assert str(error) == "SHARE_SOURCE_DENIED"
    assert sent == []
    assert marker.encode() not in b"".join(sent)


def test_approval_binds_actor_role_expiry_payload_and_snapshot_and_blocks_replay():
    now = datetime.now(UTC)
    snapshot = {"asset": "P-004", "revision": 7}
    payload = {"action": "simulate-valve-close", "value": "fictional"}
    approval = create_approval(
        approval_id="approval-1",
        tenant_id="tenant-a",
        site_id="site-a",
        actor_id="operator-a",
        actor_role="operator",
        action="simulated_action",
        payload=payload,
        snapshot=snapshot,
        snapshot_revision=7,
        idempotency_key="idem-1",
        expires_at=now + timedelta(minutes=5),
    )
    assert approval.payload_digest == canonical_digest(payload)
    assert "fictional" not in approval.payload_digest
    with pytest.raises(ValueError, match="APPROVAL_SEPARATION_REQUIRED"):
        approve_action(
            approval,
            approver_id="operator-a",
            approver_role="admin",
            current_snapshot=snapshot,
            current_revision=7,
            now=now,
        )
    with pytest.raises(ValueError, match="APPROVAL_ROLE_FORBIDDEN"):
        approve_action(
            approval,
            approver_id="viewer-b",
            approver_role="viewer",
            current_snapshot=snapshot,
            current_revision=7,
            now=now,
        )
    with pytest.raises(ValueError, match="APPROVAL_SNAPSHOT_STALE"):
        approve_action(
            approval,
            approver_id="admin-b",
            approver_role="admin",
            current_snapshot=snapshot,
            current_revision=8,
            now=now,
        )
    approved = approve_action(
        approval,
        approver_id="admin-b",
        approver_role="admin",
        current_snapshot=snapshot,
        current_revision=7,
        now=now,
    )
    consumed = consume_approval(
        approved,
        payload=payload,
        current_snapshot=snapshot,
        current_revision=7,
        now=now,
    )
    assert consumed.state == "consumed"
    with pytest.raises(ValueError, match="APPROVAL_REPLAY"):
        consume_approval(
            consumed,
            payload=payload,
            current_snapshot=snapshot,
            current_revision=7,
            now=now,
        )
    with pytest.raises(ValueError, match="APPROVAL_PAYLOAD_MISMATCH"):
        consume_approval(
            approved,
            payload={"action": "different"},
            current_snapshot=snapshot,
            current_revision=7,
            now=now,
        )
    with pytest.raises(ValueError, match="APPROVAL_EXPIRED"):
        approve_action(
            approval,
            approver_id="admin-b",
            approver_role="admin",
            current_snapshot=snapshot,
            current_revision=7,
            now=now + timedelta(minutes=6),
        )


class _DecisionRows:
    def __init__(self, row):
        self.row = row

    def first(self):
        return self.row


class _DecisionSession:
    def __init__(self, row):
        self.row = row

    def execute(self, *_args, **_kwargs):
        return _DecisionRows(self.row)


def test_server_decision_resolves_classification_and_does_not_trust_client_label(
    monkeypatch, caplog
):
    from types import SimpleNamespace

    from nexus_titan_api import privacy_routes
    from nexus_titan_api.identity import Actor
    from nexus_titan_api.identity_schemas import (
        PrivacyDecisionRequest,
        PrivacyResourceReference,
    )

    monkeypatch.setattr(
        privacy_routes,
        "_membership_scope",
        lambda *_args: SimpleNamespace(role="operator"),
    )
    monkeypatch.setattr(privacy_routes, "_check_registered_device", lambda *_args: None)
    actor = Actor("actor-a", "actor@example.test", True)
    caplog.set_level("INFO", logger="nexus_titan_api.privacy")
    unknown = PrivacyDecisionRequest(
        site_id="site-a",
        device_id="00000000-0000-4000-8000-000000000001",
        destination="cloud_inference",
        purpose="approved_summary",
        resource_refs=[
            PrivacyResourceReference(aggregate_type="asset", aggregate_id="missing")
        ],
        consent=True,
    )
    denied = privacy_routes.privacy_decision(
        "tenant-a", unknown, actor, _DecisionSession(None)
    )
    assert denied["classification"] == "restricted"
    assert denied["allow"] is False and denied["reason"] == "CLASSIFICATION_CEILING"
    assert "privacy_decision" in caplog.text

    public = privacy_routes.privacy_decision(
        "tenant-a", unknown, actor, _DecisionSession(("PUBLIC",))
    )
    assert public["classification"] == "public"
    assert public["allow"] is True
    assert public["policy_version"] == POLICY_VERSION


def test_upload_authorization_requires_device_and_explicit_consent_schema():
    from pydantic import ValidationError

    from nexus_titan_api.identity_schemas import UploadAuthorizationCreate

    with pytest.raises(ValidationError):
        UploadAuthorizationCreate(
            site_id="site-a",
            user_id="user-a",
            max_bytes=100,
            content_type="image/jpeg",
            classification="PUBLIC",
        )
