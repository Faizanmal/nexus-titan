"""Deterministic, fail-closed privacy policy and local share artifact utilities."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve()
_POLICY_CANDIDATES = [
    parent / "contracts/privacy/policy-v1.json" for parent in _HERE.parents
]
POLICY_PATH = next(
    (candidate for candidate in _POLICY_CANDIDATES if candidate.is_file()), None
)
if POLICY_PATH is None:
    raise RuntimeError("The versioned privacy policy definition is not installed")
POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
POLICY_VERSION = POLICY["policy_version"]
CLASS_ORDER = tuple(POLICY["classification_order"])
RULES = POLICY["destinations"]


def normalize_classification(value: object) -> str:
    return value if isinstance(value, str) and value in CLASS_ORDER else "restricted"


def aggregate_classification(references: list[dict[str, Any]], tenant_id: str) -> str:
    if not references or any(ref.get("tenant_id") != tenant_id for ref in references):
        return "restricted"
    return max(
        (normalize_classification(ref.get("classification")) for ref in references),
        key=CLASS_ORDER.index,
    )


def evaluate_privacy(
    *,
    role: str,
    purpose: str,
    destination: str,
    classification: object = None,
    tenant_match: bool,
    device_trusted: bool = False,
    consent: bool = False,
    approval: bool = False,
    metadata_only: bool = False,
    remote_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    classification = normalize_classification(classification)

    def deny(reason: str) -> dict[str, Any]:
        return {
            "allow": False,
            "reason": reason,
            "policy_version": POLICY_VERSION,
            "classification": classification,
        }

    rule = RULES.get(destination)
    if rule is None:
        return deny("DESTINATION_UNKNOWN")
    if rule.get("requires_tenant", True) and not tenant_match:
        return deny("TENANT_SCOPE_VIOLATION")
    if role not in rule["roles"]:
        return deny("ROLE_FORBIDDEN")
    if purpose != rule["purpose"]:
        return deny("PURPOSE_MISMATCH")
    if rule.get("requires_device") and not device_trusted:
        return deny("DEVICE_UNTRUSTED")
    if rule.get("requires_consent") and not consent:
        return deny("CONSENT_REQUIRED")
    if rule.get("requires_approval") and not approval:
        return deny("APPROVAL_REQUIRED")
    if rule.get("metadata_only") and not metadata_only:
        return deny("RAW_AUDIT_FORBIDDEN")
    remote_config = remote_config or {}
    if destination in remote_config.get("disabled_destinations", []):
        return deny("DESTINATION_DISABLED")
    ceiling = CLASS_ORDER.index(rule["max_classification"])
    requested = remote_config.get("requested_ceiling")
    if requested is not None:
        requested_ceiling = CLASS_ORDER.index(normalize_classification(requested))
        if requested_ceiling > ceiling:
            return deny("CLASSIFICATION_CEILING")
        ceiling = min(ceiling, requested_ceiling)
    if CLASS_ORDER.index(classification) > ceiling:
        return deny("CLASSIFICATION_CEILING")
    return {
        "allow": True,
        "reason": "ALLOW",
        "policy_version": POLICY_VERSION,
        "classification": classification,
    }


_REDACTIONS = (
    (re.compile(r"RESTRICTED_MARKER_[A-Z0-9_-]+", re.IGNORECASE), "[REDACTED]"),
    (
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
        "[REDACTED]",
    ),
    (
        re.compile(r"\b(?:SN|SERIAL)\s*[:=#-]\s*[A-Z0-9-]{4,}\b", re.IGNORECASE),
        "[REDACTED]",
    ),
    (re.compile(r"(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)"), "[REDACTED]"),
)


@dataclass(frozen=True)
class ShareArtifact:
    artifact_id: str
    tenant_id: str
    destination: str
    reason: str
    consent: bool
    policy_version: str
    classification: str
    preview_text: str
    outgoing_bytes: bytes
    redacted: bool


def create_share_artifact(
    *,
    artifact_id: str,
    tenant_id: str,
    destination: str,
    reason: str,
    references: list[dict[str, Any]],
    text: str,
    consent: bool,
    reviewed: bool,
) -> ShareArtifact:
    if not references or any(
        ref.get("tenant_id") != tenant_id
        or normalize_classification(ref.get("classification")) == "restricted"
        for ref in references
    ):
        raise ValueError("SHARE_SOURCE_DENIED")
    if not consent or not reason.strip():
        raise ValueError("SHARE_CONSENT_REQUIRED")
    preview = text
    for pattern, replacement in _REDACTIONS:
        preview = pattern.sub(replacement, preview)
    if re.search(
        r"REDACTION_UNCERTAIN|RESTRICTED_MARKER_|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:SN|SERIAL)\s*[:=#-]",
        preview,
        re.IGNORECASE,
    ):
        raise ValueError("SHARE_REDACTION_UNCERTAIN")
    if preview != text and not reviewed:
        raise ValueError("SHARE_REVIEW_REQUIRED")
    return ShareArtifact(
        artifact_id,
        tenant_id,
        destination,
        reason,
        consent,
        POLICY_VERSION,
        "public",
        preview,
        preview.encode("utf-8"),
        preview != text,
    )


async def dispatch_share_artifact(
    artifact: ShareArtifact,
    *,
    role: str,
    purpose: str,
    tenant_match: bool,
    device_trusted: bool,
    consent: bool,
    approval: bool,
    sink: Callable[[str, bytes], Any],
) -> dict[str, Any]:
    if (
        artifact.policy_version != POLICY_VERSION
        or artifact.outgoing_bytes != artifact.preview_text.encode("utf-8")
    ):
        return {
            "allow": False,
            "reason": "ARTIFACT_BYTES_CHANGED",
            "policy_version": POLICY_VERSION,
            "classification": "restricted",
        }
    decision = evaluate_privacy(
        role=role,
        purpose=purpose,
        destination=artifact.destination,
        classification=artifact.classification,
        tenant_match=tenant_match,
        device_trusted=device_trusted,
        consent=consent,
        approval=approval,
    )
    if not decision["allow"]:
        return decision
    result = sink(artifact.destination, bytes(artifact.outgoing_bytes))
    if hasattr(result, "__await__"):
        await result
    return decision


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class Approval:
    approval_id: str
    tenant_id: str
    site_id: str
    actor_id: str
    actor_role: str
    action: str
    payload_digest: str
    snapshot_digest: str
    snapshot_revision: int
    idempotency_key: str
    expires_at: datetime
    state: str = "pending"
    approved_by: str | None = None
    approver_role: str | None = None
    consumed_at: datetime | None = None


def create_approval(
    *,
    approval_id: str,
    tenant_id: str,
    site_id: str,
    actor_id: str,
    actor_role: str,
    action: str,
    payload: Any,
    snapshot: Any,
    snapshot_revision: int,
    idempotency_key: str,
    expires_at: datetime,
) -> Approval:
    if (
        actor_role not in {"operator", "admin", "owner"}
        or not tenant_id
        or not site_id
        or not action
        or not idempotency_key
    ):
        raise ValueError("APPROVAL_REQUEST_INVALID")
    if snapshot_revision < 0 or expires_at.tzinfo is None:
        raise ValueError("APPROVAL_REQUEST_INVALID")
    return Approval(
        approval_id,
        tenant_id,
        site_id,
        actor_id,
        actor_role,
        action,
        canonical_digest(payload),
        canonical_digest(snapshot),
        snapshot_revision,
        idempotency_key,
        expires_at.astimezone(UTC),
    )


def approve_action(
    approval: Approval,
    *,
    approver_id: str,
    approver_role: str,
    current_snapshot: Any,
    current_revision: int,
    now: datetime,
) -> Approval:
    if approval.state != "pending":
        raise ValueError("APPROVAL_REPLAY")
    if approver_role not in {"admin", "owner"}:
        raise ValueError("APPROVAL_ROLE_FORBIDDEN")
    if approver_id == approval.actor_id:
        raise ValueError("APPROVAL_SEPARATION_REQUIRED")
    if now.astimezone(UTC) >= approval.expires_at:
        raise ValueError("APPROVAL_EXPIRED")
    if (
        current_revision != approval.snapshot_revision
        or canonical_digest(current_snapshot) != approval.snapshot_digest
    ):
        raise ValueError("APPROVAL_SNAPSHOT_STALE")
    return replace(
        approval, state="approved", approved_by=approver_id, approver_role=approver_role
    )


def consume_approval(
    approval: Approval,
    *,
    payload: Any,
    current_snapshot: Any,
    current_revision: int,
    now: datetime,
) -> Approval:
    if approval.state != "approved":
        raise ValueError("APPROVAL_REPLAY")
    if now.astimezone(UTC) >= approval.expires_at:
        return replace(approval, state="expired")
    if canonical_digest(payload) != approval.payload_digest:
        raise ValueError("APPROVAL_PAYLOAD_MISMATCH")
    if (
        current_revision != approval.snapshot_revision
        or canonical_digest(current_snapshot) != approval.snapshot_digest
    ):
        raise ValueError("APPROVAL_SNAPSHOT_STALE")
    return replace(approval, state="consumed", consumed_at=now.astimezone(UTC))
