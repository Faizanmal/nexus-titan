from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_session
from .errors import APIError
from .identity import Actor, current_actor
from .identity_schemas import (
    DeviceChallenge,
    DeviceRegistration,
    InviteAccept,
    InviteCreate,
    MemberUpdate,
    SiteCreate,
    UploadAuthorizationCreate,
)
from .identity_services import (
    enforce_rate_limit,
    get_scoped_site_ids,
    sync_membership_projection,
    sync_upload_authorization,
)
from .models import (
    Device,
    Invite,
    InviteSite,
    Membership,
    MembershipSite,
    Organization,
    Site,
    UploadAuthorization,
    User,
)
from .models import (
    DeviceChallenge as DeviceChallengeRow,
)
from .privacy_policy import evaluate_privacy

router = APIRouter(tags=["identity"])
logger = logging.getLogger("nexus_titan_api.privacy")
ADMIN_ROLES = {"owner", "admin"}


def require_membership(
    session: Session, organization_id: str, actor: Actor
) -> Membership:
    member = session.get(Membership, (organization_id, actor.uid))
    if member is None or member.status != "active":
        raise APIError(
            "TENANT_ACCESS_DENIED",
            403,
            "The user is not an active member of this organization.",
        )
    return member


def require_admin(member: Membership, role: str | None = None) -> None:
    if member.role not in ADMIN_ROLES:
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "This organization role cannot administer membership or sites.",
        )
    if role == "admin" and member.role != "owner":
        raise APIError(
            "ROLE_FORBIDDEN",
            403,
            "Only an organization owner can grant the admin role.",
        )


def validate_sites(session: Session, organization_id: str, site_ids: list[str]) -> None:
    if len(site_ids) != len(set(site_ids)):
        raise APIError("INVALID_SITE_SCOPE", 422, "Site scope contains duplicate IDs.")
    found = (
        set(
            session.scalars(
                select(Site.id).where(
                    Site.organization_id == organization_id, Site.id.in_(site_ids)
                )
            ).all()
        )
        if site_ids
        else set()
    )
    if found != set(site_ids):
        raise APIError(
            "INVALID_SITE_SCOPE",
            422,
            "Every site scope must belong to the requested organization.",
        )


def firestore_projection_or_503(
    *, organization_id: str, user_id: str, active: bool, role: str, site_ids: set[str]
) -> None:
    try:
        sync_membership_projection(
            organization_id=organization_id,
            user_id=user_id,
            active=active,
            role=role,
            site_ids=site_ids,
        )
    except RuntimeError as error:
        raise APIError(
            "PROJECTION_UNAVAILABLE",
            503,
            "The membership projection could not be updated.",
        ) from error


@router.get("/v1/me")
def get_me(
    actor: Actor = Depends(current_actor), session: Session = Depends(get_session)
) -> dict[str, object]:
    memberships = session.scalars(
        select(Membership).where(
            Membership.user_id == actor.uid, Membership.status == "active"
        )
    ).all()
    response: list[dict[str, object]] = []
    for member in memberships:
        organization = session.get(Organization, member.organization_id)
        if organization is None:
            continue
        if member.role in ADMIN_ROLES:
            sites = session.scalars(
                select(Site)
                .where(Site.organization_id == member.organization_id)
                .order_by(Site.id)
            ).all()
        else:
            sites = session.scalars(
                select(Site)
                .join(
                    MembershipSite,
                    (MembershipSite.organization_id == Site.organization_id)
                    & (MembershipSite.site_id == Site.id),
                )
                .where(
                    MembershipSite.organization_id == member.organization_id,
                    MembershipSite.user_id == actor.uid,
                )
                .order_by(Site.id)
            ).all()
        response.append(
            {
                "organization_id": organization.id,
                "organization_name": organization.display_name,
                "role": member.role,
                "sites": [{"site_id": site.id, "name": site.name} for site in sites],
            }
        )
    return {
        "uid": actor.uid,
        "email": actor.email,
        "email_verified": actor.email_verified,
        "memberships": response,
    }


@router.get("/v1/organizations/{organization_id}/sites")
def list_sites(
    organization_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, organization_id, actor)
    query = select(Site).where(Site.organization_id == organization_id)
    if member.role not in ADMIN_ROLES:
        query = query.join(
            MembershipSite,
            (MembershipSite.organization_id == Site.organization_id)
            & (MembershipSite.site_id == Site.id),
        ).where(MembershipSite.user_id == actor.uid)
    rows = session.scalars(query.order_by(Site.id)).all()
    return {
        "organization_id": organization_id,
        "sites": [{"site_id": row.id, "name": row.name} for row in rows],
    }


@router.post("/v1/organizations/{organization_id}/sites", status_code=201)
def create_site(
    organization_id: str,
    payload: SiteCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    member = require_membership(session, organization_id, actor)
    require_admin(member)
    if session.get(Site, payload.site_id):
        raise APIError("SITE_ALREADY_EXISTS", 409, "The site ID already exists.")
    site = Site(id=payload.site_id, organization_id=organization_id, name=payload.name)
    session.add(site)
    session.commit()
    return {"site_id": site.id, "organization_id": organization_id, "name": site.name}


@router.post("/v1/organizations/{organization_id}/invites", status_code=201)
def create_invite(
    organization_id: str,
    payload: InviteCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, organization_id, actor)
    require_admin(member, payload.role)
    if os.getenv("APP_ENV", "local").lower() not in {"local", "test"}:
        raise APIError(
            "INVITE_DELIVERY_UNCONFIGURED",
            503,
            "Organization invites are disabled until a verified-email delivery provider is configured.",
        )
    if not actor.email_verified:
        raise APIError(
            "EMAIL_NOT_VERIFIED",
            403,
            "Verify the account email before inviting members.",
        )
    validate_sites(session, organization_id, payload.site_ids)
    enforce_rate_limit(
        session,
        scope=f"invite:{organization_id}",
        actor=actor.uid,
        limit=10,
        window=timedelta(hours=1),
    )
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    invite = Invite(
        organization_id=organization_id,
        email=payload.email,
        role=payload.role,
        token_hash=hashlib.sha256(token.encode("utf-8")).digest(),
        invited_by=actor.uid,
        expires_at=now + timedelta(hours=24),
    )
    session.add(invite)
    session.flush()
    session.add_all(
        InviteSite(
            invite_id=invite.id, organization_id=organization_id, site_id=site_id
        )
        for site_id in payload.site_ids
    )
    session.commit()
    # The token is returned once for the dev invite flow. Production delivery must use a vetted mailer.
    return {
        "invite_id": str(invite.id),
        "email": invite.email,
        "role": invite.role,
        "expires_at": invite.expires_at.isoformat(),
        "invite_token": token,
    }


@router.post("/v1/invites/accept")
def accept_invite(
    payload: InviteAccept,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    enforce_rate_limit(
        session,
        scope="invite-accept",
        actor=actor.uid,
        limit=10,
        window=timedelta(minutes=1),
    )
    if not actor.email_verified or not actor.email:
        raise APIError(
            "EMAIL_NOT_VERIFIED",
            403,
            "Verify the Firebase account email before accepting an invite.",
        )
    token_hash = hashlib.sha256(payload.invite_token.encode("utf-8")).digest()
    invite = session.scalar(
        select(Invite).where(Invite.token_hash == token_hash).with_for_update()
    )
    now = datetime.now(UTC)
    if invite is None or invite.consumed_at is not None or invite.expires_at <= now:
        raise APIError(
            "INVITE_INVALID", 404, "The invite is invalid, expired, or already used."
        )
    if not secrets.compare_digest(invite.email, actor.email.strip().lower()):
        raise APIError(
            "INVITE_EMAIL_MISMATCH",
            403,
            "The invite belongs to a different verified email address.",
        )
    membership = session.get(Membership, (invite.organization_id, actor.uid))
    if membership is not None:
        raise APIError(
            "MEMBERSHIP_EXISTS",
            409,
            "The user already has membership in this organization.",
        )
    user = session.get(User, actor.uid)
    if user is None:
        session.add(User(id=actor.uid, email=actor.email.strip().lower()))
    else:
        user.email = actor.email.strip().lower()
    membership = Membership(
        organization_id=invite.organization_id,
        user_id=actor.uid,
        role=invite.role,
        status="active",
    )
    session.add(membership)
    site_rows = session.scalars(
        select(InviteSite).where(InviteSite.invite_id == invite.id)
    ).all()
    site_ids = {row.site_id for row in site_rows}
    session.add_all(
        MembershipSite(
            organization_id=invite.organization_id, user_id=actor.uid, site_id=site_id
        )
        for site_id in site_ids
    )
    invite.consumed_at = now
    organization_id = invite.organization_id
    role = invite.role
    session.commit()
    firestore_projection_or_503(
        organization_id=organization_id,
        user_id=actor.uid,
        active=True,
        role=role,
        site_ids=site_ids,
    )
    return {"organization_id": organization_id, "role": role, "status": "active"}


@router.patch("/v1/organizations/{organization_id}/members/{user_id}")
def update_member(
    organization_id: str,
    user_id: str,
    payload: MemberUpdate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    actor_membership = require_membership(session, organization_id, actor)
    require_admin(actor_membership, payload.role)
    target = session.get(Membership, (organization_id, user_id))
    if target is None:
        raise APIError(
            "MEMBER_NOT_FOUND", 404, "The organization member was not found."
        )
    if target.role == "owner":
        raise APIError(
            "OWNER_PROTECTED",
            409,
            "Owner transfer requires a dedicated owner-transfer workflow.",
        )
    validate_sites(session, organization_id, payload.site_ids)
    old_role = target.role
    old_status = target.status
    old_site_ids = get_scoped_site_ids(session, organization_id, user_id)
    new_site_ids = (
        set(payload.site_ids)
        if payload.status == "active" and payload.role not in ADMIN_ROLES
        else set()
    )
    restrictive_change = (
        (old_status == "active" and payload.status == "suspended")
        or (old_role in ADMIN_ROLES and payload.role not in ADMIN_ROLES)
        or not old_site_ids.issubset(new_site_ids)
    )
    target.role = payload.role
    target.status = payload.status
    session.query(MembershipSite).filter_by(
        organization_id=organization_id, user_id=user_id
    ).delete(synchronize_session=False)
    if payload.status == "active" and payload.role not in ADMIN_ROLES:
        session.add_all(
            MembershipSite(
                organization_id=organization_id, user_id=user_id, site_id=site_id
            )
            for site_id in payload.site_ids
        )
    projection_args = {
        "organization_id": organization_id,
        "user_id": user_id,
        "active": payload.status == "active",
        "role": payload.role,
        "site_ids": new_site_ids,
    }
    if restrictive_change:
        firestore_projection_or_503(**projection_args)
    session.commit()
    if not restrictive_change:
        firestore_projection_or_503(**projection_args)
    return {
        "organization_id": organization_id,
        "user_id": user_id,
        "role": payload.role,
        "status": payload.status,
    }


@router.post("/v1/organizations/{organization_id}/devices/challenges")
def create_device_challenge(
    organization_id: str,
    payload: DeviceChallenge,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    require_membership(session, organization_id, actor)
    enforce_rate_limit(
        session,
        scope=f"device-challenge:{organization_id}",
        actor=actor.uid,
        limit=10,
        window=timedelta(minutes=10),
    )
    nonce = secrets.token_bytes(32)
    row = DeviceChallengeRow(
        organization_id=organization_id,
        user_id=actor.uid,
        nonce=nonce,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    session.add(row)
    session.commit()
    return {
        "challenge_id": str(row.id),
        "challenge": base64.urlsafe_b64encode(nonce).decode("ascii").rstrip("="),
    }


@router.post("/v1/organizations/{organization_id}/devices", status_code=201)
def register_device(
    organization_id: str,
    payload: DeviceRegistration,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    require_membership(session, organization_id, actor)
    try:
        challenge_id = UUID(payload.challenge_id)
    except ValueError as error:
        raise APIError(
            "DEVICE_PROOF_INVALID", 400, "The device challenge is invalid."
        ) from error
    challenge = session.scalar(
        select(DeviceChallengeRow)
        .where(
            DeviceChallengeRow.id == challenge_id,
            DeviceChallengeRow.organization_id == organization_id,
            DeviceChallengeRow.user_id == actor.uid,
        )
        .with_for_update()
    )
    now = datetime.now(UTC)
    if (
        challenge is None
        or challenge.consumed_at is not None
        or challenge.expires_at <= now
    ):
        raise APIError(
            "DEVICE_CHALLENGE_EXPIRED",
            403,
            "The device challenge is invalid, expired, or already used.",
        )
    try:
        public_key = serialization.load_pem_public_key(
            payload.public_key_pem.encode("ascii")
        )
        signature = base64.b64decode(payload.signature_base64, validate=True)
        if isinstance(public_key, ed25519.Ed25519PublicKey):
            public_key.verify(signature, challenge.nonce)
        elif isinstance(public_key, ec.EllipticCurvePublicKey) and isinstance(
            public_key.curve, ec.SECP256R1
        ):
            if len(signature) == 64:
                signature = encode_dss_signature(
                    int.from_bytes(signature[:32], "big"),
                    int.from_bytes(signature[32:], "big"),
                )
            public_key.verify(signature, challenge.nonce, ec.ECDSA(hashes.SHA256()))
        else:
            raise TypeError("unsupported public key type")
    except (ValueError, TypeError, InvalidSignature) as error:
        raise APIError(
            "DEVICE_PROOF_INVALID", 403, "The registered key did not prove possession."
        ) from error
    existing = session.scalar(
        select(Device).where(
            Device.organization_id == organization_id,
            Device.user_id == actor.uid,
            Device.client_device_id == payload.client_device_id,
        )
    )
    if existing is not None:
        raise APIError(
            "DEVICE_ID_EXISTS",
            409,
            "This client device ID is already registered or revoked.",
        )
    challenge.consumed_at = now
    device = Device(
        organization_id=organization_id,
        user_id=actor.uid,
        client_device_id=payload.client_device_id,
        label=payload.label,
        public_key_pem=payload.public_key_pem,
        status="registered",
    )
    session.add(device)
    session.commit()
    return {
        "device_id": str(device.id),
        "client_device_id": device.client_device_id,
        "status": device.status,
    }


@router.get("/v1/organizations/{organization_id}/devices")
def list_devices(
    organization_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, organization_id, actor)
    query = select(Device).where(Device.organization_id == organization_id)
    if member.role not in ADMIN_ROLES:
        query = query.where(Device.user_id == actor.uid)
    rows = session.scalars(query.order_by(Device.created_at.desc())).all()
    return {
        "devices": [
            {
                "device_id": str(row.id),
                "client_device_id": row.client_device_id,
                "label": row.label,
                "status": row.status,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.get("/v1/organizations/{organization_id}/devices/{device_id}/peer-key")
def get_registered_peer_key(
    organization_id: str,
    device_id: UUID,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Expose a registered signing public key only inside its active organization."""
    member = require_membership(session, organization_id, actor)
    if member.role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN", 403, "This organization role cannot pair peer devices."
        )
    device = session.scalar(
        select(Device).where(
            Device.id == device_id,
            Device.organization_id == organization_id,
            Device.status == "registered",
        )
    )
    if device is None:
        raise APIError(
            "PEER_DEVICE_UNAVAILABLE",
            404,
            "The peer device is not registered and active in this organization.",
        )
    peer_member = session.get(Membership, (organization_id, device.user_id))
    if (
        peer_member is None
        or peer_member.status != "active"
        or peer_member.role not in {"owner", "admin", "operator"}
    ):
        raise APIError(
            "PEER_DEVICE_UNAVAILABLE",
            404,
            "The peer device is not eligible for peer transfer.",
        )
    return {
        "device_id": str(device.id),
        "public_key_pem": device.public_key_pem,
        "status": "registered",
    }


@router.get("/v1/organizations/{organization_id}/devices/peers")
def list_registered_peer_devices(
    organization_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    """List active, same-tenant device identities eligible for consent-based pairing."""
    require_membership(session, organization_id, actor)
    eligible_roles = {"owner", "admin", "operator"}
    rows = session.scalars(
        select(Device)
        .join(
            Membership,
            (Membership.organization_id == Device.organization_id)
            & (Membership.user_id == Device.user_id),
        )
        .where(
            Device.organization_id == organization_id,
            Device.status == "registered",
            Membership.status == "active",
            Membership.role.in_(eligible_roles),
        )
        .order_by(Device.created_at.desc())
    ).all()
    return {
        "organization_id": organization_id,
        "devices": [
            {
                "device_id": str(row.id),
                "client_device_id": row.client_device_id,
                "label": row.label,
                "status": "registered",
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ],
    }


@router.post("/v1/organizations/{organization_id}/devices/{device_id}/revoke")
def revoke_device(
    organization_id: str,
    device_id: UUID,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    member = require_membership(session, organization_id, actor)
    device = session.get(Device, device_id)
    if device is None or device.organization_id != organization_id:
        raise APIError("DEVICE_NOT_FOUND", 404, "The device was not found.")
    if member.role not in ADMIN_ROLES and device.user_id != actor.uid:
        raise APIError(
            "DEVICE_ACCESS_DENIED", 403, "A user can revoke only their own devices."
        )
    if device.status != "revoked":
        device.status = "revoked"
        device.revoked_at = datetime.now(UTC)
        session.commit()
    return {"device_id": str(device.id), "status": "revoked"}


@router.get("/v1/organizations/{organization_id}/devices/{client_device_id}/trust")
def check_device_trust(
    organization_id: str,
    client_device_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    require_membership(session, organization_id, actor)
    device = session.scalar(
        select(Device).where(
            Device.organization_id == organization_id,
            Device.user_id == actor.uid,
            Device.client_device_id == client_device_id,
        )
    )
    if device is None or device.status != "registered":
        raise APIError(
            "DEVICE_NOT_TRUSTED",
            403,
            "This device is not registered or has been revoked.",
        )
    return {"client_device_id": client_device_id, "status": "registered"}


@router.post(
    "/v1/organizations/{organization_id}/upload-authorizations", status_code=201
)
def approve_upload(
    organization_id: str,
    payload: UploadAuthorizationCreate,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    member = require_membership(session, organization_id, actor)
    require_admin(member)
    site = session.get(Site, payload.site_id)
    if site is None or site.organization_id != organization_id:
        raise APIError(
            "SITE_NOT_FOUND", 404, "The site was not found in this organization."
        )
    target = session.get(Membership, (organization_id, payload.user_id))
    if target is None or target.status != "active":
        raise APIError(
            "MEMBER_NOT_FOUND",
            404,
            "The upload recipient is not an active organization member.",
        )
    if target.role not in ADMIN_ROLES and payload.site_id not in get_scoped_site_ids(
        session, organization_id, payload.user_id
    ):
        raise APIError(
            "INVALID_SITE_SCOPE",
            403,
            "The upload recipient is not scoped to this site.",
        )
    trusted_device = (
        session.scalar(
            select(Device.id).where(
                Device.id == payload.device_id,
                Device.organization_id == organization_id,
                Device.user_id == actor.uid,
                Device.status == "registered",
            )
        )
        is not None
    )
    decision = evaluate_privacy(
        role=member.role,
        purpose="approved_artifact",
        destination="upload",
        classification=payload.classification.lower(),
        tenant_match=True,
        device_trusted=trusted_device,
        consent=payload.consent,
        approval=True,
    )
    if not decision["allow"]:
        logger.info(
            json.dumps(
                {
                    "event": "privacy_policy_denied",
                    "policy_version": decision["policy_version"],
                    "tenant_id": organization_id,
                    "actor_id": actor.uid,
                    "reason": decision["reason"],
                },
                separators=(",", ":"),
            )
        )
        raise APIError(
            "POLICY_DENIED",
            403,
            "The privacy policy denied the artifact upload authorization.",
        )
    enforce_rate_limit(
        session,
        scope=f"upload-approval:{organization_id}",
        actor=actor.uid,
        limit=20,
        window=timedelta(hours=1),
    )
    authorization = UploadAuthorization(
        id=secrets.token_urlsafe(18),
        organization_id=organization_id,
        site_id=payload.site_id,
        user_id=payload.user_id,
        status="approved",
        max_bytes=payload.max_bytes,
        content_type=payload.content_type,
        classification=payload.classification,
        expires_at=datetime.now(UTC) + timedelta(minutes=payload.expires_minutes),
    )
    session.add(authorization)
    session.commit()
    try:
        sync_upload_authorization(authorization)
    except RuntimeError as error:
        raise APIError(
            "PROJECTION_UNAVAILABLE",
            503,
            "The approved upload capability is not available in Storage.",
        ) from error
    return {
        "authorization_id": authorization.id,
        "status": authorization.status,
        "storage_path": f"organizations/{organization_id}/sites/{payload.site_id}/artifacts/{authorization.id}",
        "max_bytes": authorization.max_bytes,
        "content_type": authorization.content_type,
        "classification": authorization.classification,
        "expires_at": authorization.expires_at.isoformat(),
    }


@router.post(
    "/v1/organizations/{organization_id}/upload-authorizations/{authorization_id}/revoke"
)
def revoke_upload(
    organization_id: str,
    authorization_id: str,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    member = require_membership(session, organization_id, actor)
    require_admin(member)
    authorization = session.scalar(
        select(UploadAuthorization)
        .where(
            UploadAuthorization.organization_id == organization_id,
            UploadAuthorization.id == authorization_id,
        )
        .with_for_update()
    )
    if authorization is None:
        raise APIError(
            "UPLOAD_AUTHORIZATION_NOT_FOUND",
            404,
            "The upload authorization was not found.",
        )
    if authorization.status != "revoked":
        authorization.status = "revoked"
        try:
            sync_upload_authorization(
                authorization
            )  # Revoke the Firestore capability before committing canonical state.
        except RuntimeError as error:
            raise APIError(
                "PROJECTION_UNAVAILABLE",
                503,
                "Storage revocation could not be confirmed.",
            ) from error
        session.commit()
    return {"authorization_id": authorization.id, "status": authorization.status}
