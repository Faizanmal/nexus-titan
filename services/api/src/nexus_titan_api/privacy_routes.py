"""Server-authoritative privacy decisions and simulated-action approvals."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .identity_routes import ADMIN_ROLES, get_scoped_site_ids, require_membership
from .identity_schemas import (
    PrivacyApprovalConsume,
    PrivacyApprovalCreate,
    PrivacyDecisionRequest,
)
from .models import Device, Membership, PrivacyApproval, Site, UploadAuthorization
from .privacy_policy import (
    Approval,
    aggregate_classification,
    approve_action,
    consume_approval,
    create_approval,
    evaluate_privacy,
)

router = APIRouter(
    prefix="/v1/organizations/{organization_id}/privacy", tags=["privacy"]
)
logger = logging.getLogger("nexus_titan_api.privacy")


@router.post("/decisions")
def privacy_decision(
    organization_id: str,
    payload: PrivacyDecisionRequest,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = _membership_scope(session, organization_id, actor, payload.site_id)
    _check_registered_device(session, organization_id, actor, payload.device_id)
    references: list[dict[str, object]] = []
    for reference in payload.resource_refs:
        row = session.execute(
            text(
                """SELECT classification FROM aggregate_projections WHERE tenant_id=:tenant
            AND site_id=:site AND aggregate_type=:type AND aggregate_id=:id"""
            ),
            {
                "tenant": organization_id,
                "site": payload.site_id,
                "type": reference.aggregate_type,
                "id": reference.aggregate_id,
            },
        ).first()
        references.append(
            {
                "tenant_id": organization_id if row is not None else None,
                "classification": (
                    row[0].lower() if row is not None and row[0] is not None else None
                ),
            }
        )
    classification = aggregate_classification(references, organization_id)
    approval = False
    if payload.approval_id is not None:
        approval = (
            session.scalar(
                select(PrivacyApproval.id).where(
                    PrivacyApproval.id == payload.approval_id,
                    PrivacyApproval.tenant_id == organization_id,
                    PrivacyApproval.site_id == payload.site_id,
                    PrivacyApproval.actor_id == actor.uid,
                    PrivacyApproval.state == "approved",
                    PrivacyApproval.expires_at > datetime.now(UTC),
                )
            )
            is not None
        )
    if payload.upload_authorization_id is not None:
        approval = (
            session.scalar(
                select(UploadAuthorization.id).where(
                    UploadAuthorization.id == payload.upload_authorization_id,
                    UploadAuthorization.organization_id == organization_id,
                    UploadAuthorization.site_id == payload.site_id,
                    UploadAuthorization.user_id == actor.uid,
                    UploadAuthorization.status == "approved",
                    UploadAuthorization.expires_at > datetime.now(UTC),
                    UploadAuthorization.classification == classification.upper(),
                )
            )
            is not None
        )
    decision = evaluate_privacy(
        role=member.role,
        purpose=payload.purpose,
        destination=payload.destination,
        classification=classification,
        tenant_match=True,
        device_trusted=True,
        consent=payload.consent,
        approval=approval,
    )
    logger.info(
        json.dumps(
            {
                "event": "privacy_decision",
                "policy_version": decision["policy_version"],
                "tenant_id": organization_id,
                "site_id": payload.site_id,
                "actor_role": member.role,
                "destination": payload.destination,
                "allow": decision["allow"],
                "reason": decision["reason"],
            },
            separators=(",", ":"),
        )
    )
    return {
        **decision,
        "role": member.role,
        "tenant_id": organization_id,
        "device_trusted": True,
        "tenant_match": True,
    }


def _current_snapshot(
    session: Session,
    tenant_id: str,
    site_id: str,
    aggregate_type: str,
    aggregate_id: str,
) -> tuple[dict[str, object], int, str] | None:
    row = (
        session.execute(
            text(
                """SELECT h.revision,p.revision AS projection_revision,p.state,p.classification FROM aggregate_heads h
        LEFT JOIN aggregate_projections p ON p.tenant_id=h.tenant_id AND p.site_id=h.site_id
          AND p.aggregate_type=h.aggregate_type AND p.aggregate_id=h.aggregate_id
        WHERE h.tenant_id=:tenant AND h.site_id=:site AND h.aggregate_type=:type AND h.aggregate_id=:id"""
            ),
            {
                "tenant": tenant_id,
                "site": site_id,
                "type": aggregate_type,
                "id": aggregate_id,
            },
        )
        .mappings()
        .first()
    )
    if (
        row is None
        or row["projection_revision"] is None
        or int(row["projection_revision"]) != int(row["revision"])
    ):
        return None
    revision = int(row["revision"])
    snapshot: dict[str, object] = {
        "revision": revision,
        "state": row["state"] if row["state"] is not None else {},
    }
    classification = (
        row["classification"] if row["classification"] is not None else None
    )
    return (
        snapshot,
        revision,
        classification.lower() if isinstance(classification, str) else "restricted",
    )


def _membership_scope(
    session: Session, organization_id: str, actor: Actor, site_id: str
) -> Membership:
    member = require_membership(session, organization_id, actor)
    if member.role not in ADMIN_ROLES and site_id not in get_scoped_site_ids(
        session, organization_id, actor.uid
    ):
        raise APIError(
            "SITE_ACCESS_DENIED",
            403,
            "The active membership is not scoped to this site.",
        )
    site = session.get(Site, site_id)
    if site is None or site.organization_id != organization_id:
        raise APIError(
            "SITE_NOT_FOUND", 404, "The site was not found in this organization."
        )
    return member


def _check_registered_device(
    session: Session, organization_id: str, actor: Actor, device_id: UUID
) -> None:
    device = session.scalar(
        select(Device.id).where(
            Device.id == device_id,
            Device.organization_id == organization_id,
            Device.user_id == actor.uid,
            Device.status == "registered",
        )
    )
    if device is None:
        raise APIError(
            "DEVICE_NOT_TRUSTED", 403, "A registered, non-revoked device is required."
        )


def _as_approval(row: PrivacyApproval) -> Approval:
    return Approval(
        approval_id=str(row.id),
        tenant_id=row.tenant_id,
        site_id=row.site_id,
        actor_id=row.actor_id,
        actor_role=row.actor_role,
        action=row.action,
        payload_digest=row.payload_digest,
        snapshot_digest=row.snapshot_digest,
        snapshot_revision=row.snapshot_revision,
        idempotency_key=row.idempotency_key,
        expires_at=row.expires_at,
        state=row.state,
        approved_by=row.approved_by,
        approver_role=row.approver_role,
        consumed_at=row.consumed_at,
    )


@router.post("/simulated-approvals", status_code=201)
def request_simulated_approval(
    organization_id: str,
    payload: PrivacyApprovalCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = _membership_scope(session, organization_id, actor, payload.site_id)
    if member.role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "This role cannot request a simulated action approval.",
        )
    _check_registered_device(session, organization_id, actor, payload.device_id)
    current = _current_snapshot(
        session,
        organization_id,
        payload.site_id,
        payload.aggregate_type,
        payload.aggregate_id,
    )
    if current is None:
        raise APIError(
            "SNAPSHOT_NOT_FOUND", 404, "The aggregate snapshot does not exist."
        )
    snapshot, revision, classification = current
    if revision != payload.snapshot_revision:
        raise APIError(
            "APPROVAL_SNAPSHOT_STALE",
            409,
            "The aggregate revision changed before approval was requested.",
        )
    decision = evaluate_privacy(
        role=member.role,
        purpose="approved_task",
        destination="local_inference",
        classification=classification,
        tenant_match=True,
        device_trusted=True,
        consent=payload.consent,
    )
    if not decision["allow"]:
        raise APIError(
            "POLICY_DENIED",
            403,
            "The privacy policy denied this simulated action request.",
        )
    action_payload = {
        "action": "simulated_action",
        "tenant_id": organization_id,
        "site_id": payload.site_id,
        "actor_id": actor.uid,
        "actor_role": member.role,
        "aggregate_type": payload.aggregate_type,
        "aggregate_id": payload.aggregate_id,
        "payload": payload.action_payload,
    }
    approval = create_approval(
        approval_id=str(uuid4()),
        tenant_id=organization_id,
        site_id=payload.site_id,
        actor_id=actor.uid,
        actor_role=member.role,
        action="simulated_action",
        payload=action_payload,
        snapshot=snapshot,
        snapshot_revision=revision,
        idempotency_key=payload.idempotency_key,
        expires_at=datetime.now(UTC) + timedelta(minutes=payload.expires_minutes),
    )
    existing = session.scalar(
        select(PrivacyApproval).where(
            PrivacyApproval.tenant_id == organization_id,
            PrivacyApproval.idempotency_key == payload.idempotency_key,
        )
    )
    if existing is not None:
        if (
            existing.actor_id != actor.uid
            or existing.payload_digest != approval.payload_digest
            or existing.snapshot_digest != approval.snapshot_digest
        ):
            raise APIError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "The approval key is already bound to a different request.",
            )
        return {
            "approval_id": str(existing.id),
            "state": existing.state,
            "expires_at": existing.expires_at.isoformat(),
            "policy_version": "nexus-privacy-v1",
        }
    row = PrivacyApproval(
        id=UUID(approval.approval_id),
        tenant_id=approval.tenant_id,
        site_id=approval.site_id,
        actor_id=approval.actor_id,
        actor_role=approval.actor_role,
        action=approval.action,
        aggregate_type=payload.aggregate_type,
        aggregate_id=payload.aggregate_id,
        payload_digest=approval.payload_digest,
        snapshot_digest=approval.snapshot_digest,
        snapshot_revision=approval.snapshot_revision,
        idempotency_key=approval.idempotency_key,
        state="pending",
        expires_at=approval.expires_at,
    )
    session.add(row)
    session.commit()
    logger.info(
        json.dumps(
            {
                "event": "privacy_approval_requested",
                "policy_version": "nexus-privacy-v1",
                "tenant_id": organization_id,
                "approval_id": str(row.id),
                "actor_role": member.role,
            },
            separators=(",", ":"),
        )
    )
    return {
        "approval_id": str(row.id),
        "state": row.state,
        "expires_at": row.expires_at.isoformat(),
        "policy_version": "nexus-privacy-v1",
    }


@router.post("/simulated-approvals/{approval_id}/approve")
def approve_simulated_action(
    organization_id: str,
    approval_id: UUID,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    row = session.scalar(
        select(PrivacyApproval)
        .where(
            PrivacyApproval.id == approval_id,
            PrivacyApproval.tenant_id == organization_id,
        )
        .with_for_update()
    )
    if row is None:
        raise APIError("APPROVAL_NOT_FOUND", 404, "The approval request was not found.")
    member = _membership_scope(session, organization_id, actor, row.site_id)
    current = _current_snapshot(
        session, organization_id, row.site_id, row.aggregate_type, row.aggregate_id
    )
    if current is None:
        raise APIError(
            "APPROVAL_SNAPSHOT_STALE",
            409,
            "The approved snapshot revision is no longer current.",
        )
    snapshot, revision, _classification = current
    try:
        approved = approve_action(
            _as_approval(row),
            approver_id=actor.uid,
            approver_role=member.role,
            current_snapshot=snapshot,
            current_revision=revision,
            now=datetime.now(UTC),
        )
    except ValueError as error:
        raise APIError(
            str(error),
            409,
            "The approval request is expired, stale, replayed, or not eligible for this actor.",
        ) from error
    row.state, row.approved_by, row.approver_role = (
        approved.state,
        approved.approved_by,
        approved.approver_role,
    )
    session.commit()
    logger.info(
        json.dumps(
            {
                "event": "privacy_approval_approved",
                "policy_version": "nexus-privacy-v1",
                "tenant_id": organization_id,
                "approval_id": str(row.id),
                "approver_role": member.role,
            },
            separators=(",", ":"),
        )
    )
    return {
        "approval_id": str(row.id),
        "state": row.state,
        "policy_version": "nexus-privacy-v1",
    }


@router.post("/simulated-approvals/{approval_id}/consume")
def consume_simulated_approval(
    organization_id: str,
    approval_id: UUID,
    payload: PrivacyApprovalConsume,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    row = session.scalar(
        select(PrivacyApproval)
        .where(
            PrivacyApproval.id == approval_id,
            PrivacyApproval.tenant_id == organization_id,
        )
        .with_for_update()
    )
    if row is None:
        raise APIError("APPROVAL_NOT_FOUND", 404, "The approval request was not found.")
    member = _membership_scope(session, organization_id, actor, row.site_id)
    if row.actor_id != actor.uid or row.actor_role != member.role:
        raise APIError(
            "APPROVAL_ACTOR_MISMATCH",
            403,
            "Only the requesting actor in the original role can consume this approval.",
        )
    _check_registered_device(session, organization_id, actor, payload.device_id)
    current = _current_snapshot(
        session, organization_id, row.site_id, row.aggregate_type, row.aggregate_id
    )
    if current is None:
        raise APIError(
            "APPROVAL_SNAPSHOT_STALE",
            409,
            "The approval's snapshot or payload no longer matches.",
        )
    snapshot, revision, _classification = current
    try:
        match = consume_approval(
            _as_approval(row),
            payload={
                "action": "simulated_action",
                "tenant_id": row.tenant_id,
                "site_id": row.site_id,
                "actor_id": row.actor_id,
                "actor_role": row.actor_role,
                "aggregate_type": row.aggregate_type,
                "aggregate_id": row.aggregate_id,
                "payload": payload.action_payload,
            },
            current_snapshot=snapshot,
            current_revision=revision,
            now=datetime.now(UTC),
        )
    except ValueError as error:
        raise APIError(
            str(error),
            409,
            "The approval is expired, stale, replayed, or otherwise invalid.",
        ) from error
    row.state, row.consumed_at = match.state, match.consumed_at
    session.commit()
    logger.info(
        json.dumps(
            {
                "event": "privacy_approval_consumed",
                "policy_version": "nexus-privacy-v1",
                "tenant_id": organization_id,
                "approval_id": str(row.id),
                "actor_role": member.role,
            },
            separators=(",", ":"),
        )
    )
    return {
        "approval_id": str(row.id),
        "state": row.state,
        "executed": False,
        "policy_version": "nexus-privacy-v1",
    }
