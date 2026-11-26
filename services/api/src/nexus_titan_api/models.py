"""Canonical PostgreSQL identity, tenancy, membership and device records."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint(
            "id ~ '^[a-z0-9][a-z0-9_-]{2,62}$'", name="ck_organizations_id"
        ),
    )

    id: Mapped[str] = mapped_column(String(63), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    sites: Mapped[list[Site]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class User(Base):
    __tablename__ = "identity_users"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)  # Firebase Auth UID
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        UniqueConstraint("organization_id", "id", name="uq_sites_org_id"),
        CheckConstraint("id ~ '^[a-z0-9][a-z0-9_-]{1,62}$'", name="ck_sites_id"),
    )

    id: Mapped[str] = mapped_column(String(63), primary_key=True)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    organization: Mapped[Organization] = relationship(back_populates="sites")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        CheckConstraint(
            "role IN ('owner','admin','operator','viewer')", name="ck_memberships_role"
        ),
        CheckConstraint(
            "status IN ('active','suspended')", name="ck_memberships_status"
        ),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("identity_users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    site_scopes: Mapped[list[MembershipSite]] = relationship(
        cascade="all, delete-orphan"
    )


class MembershipSite(Base):
    __tablename__ = "membership_sites"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "user_id"],
            ["memberships.organization_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id", "site_id"],
            ["sites.organization_id", "sites.id"],
            ondelete="CASCADE",
        ),
    )

    organization_id: Mapped[str] = mapped_column(String(63), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    site_id: Mapped[str] = mapped_column(String(63), primary_key=True)


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            "client_device_id",
            name="uq_devices_org_user_client_id",
        ),
        ForeignKeyConstraint(
            ["organization_id", "user_id"],
            ["memberships.organization_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("status IN ('registered','revoked')", name="ck_devices_status"),
    )

    id: Mapped[object] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    organization_id: Mapped[str] = mapped_column(String(63), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    client_device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    public_key_pem: Mapped[str] = mapped_column(String(4096), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="registered", server_default="registered"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeviceChallenge(Base):
    __tablename__ = "device_challenges"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "user_id"],
            ["memberships.organization_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[object] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    organization_id: Mapped[str] = mapped_column(String(63), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Invite(Base):
    __tablename__ = "organization_invites"
    __table_args__ = (
        CheckConstraint(
            "role IN ('admin','operator','viewer')", name="ck_invites_role"
        ),
        UniqueConstraint("organization_id", "id", name="uq_invites_org_id"),
    )

    id: Mapped[object] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(
        LargeBinary(32), unique=True, nullable=False
    )
    invited_by: Mapped[str] = mapped_column(
        ForeignKey("identity_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InviteSite(Base):
    __tablename__ = "invite_sites"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "invite_id"],
            ["organization_invites.organization_id", "organization_invites.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id", "site_id"],
            ["sites.organization_id", "sites.id"],
            ondelete="CASCADE",
        ),
    )

    invite_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(63), nullable=False)
    site_id: Mapped[str] = mapped_column(String(63), primary_key=True)


class RateLimitBucket(Base):
    __tablename__ = "identity_rate_limit_buckets"

    key: Mapped[str] = mapped_column(String(192), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    hits: Mapped[int] = mapped_column(Integer, nullable=False)


class UploadAuthorization(Base):
    __tablename__ = "upload_authorizations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "user_id"],
            ["memberships.organization_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id", "site_id"],
            ["sites.organization_id", "sites.id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "status IN ('approved','consumed','revoked')",
            name="ck_upload_authorizations_status",
        ),
        CheckConstraint(
            "max_bytes > 0 AND max_bytes <= 15728640",
            name="ck_upload_authorizations_max_bytes",
        ),
        CheckConstraint(
            "content_type IN ('application/pdf','image/jpeg','image/png')",
            name="ck_upload_authorizations_content_type",
        ),
        CheckConstraint(
            "classification IN ('PUBLIC','INTERNAL')",
            name="ck_upload_authorizations_classification",
        ),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(63), nullable=False)
    site_id: Mapped[str] = mapped_column(String(63), nullable=False)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    max_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(96), nullable=False)
    classification: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class PrivacyApproval(Base):
    __tablename__ = "privacy_approvals"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_privacy_approval_idempotency"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "site_id"],
            ["sites.organization_id", "sites.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "actor_id"],
            ["memberships.organization_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "actor_role IN ('owner','admin','operator')",
            name="ck_privacy_approval_actor_role",
        ),
        CheckConstraint(
            "approver_role IS NULL OR approver_role IN ('owner','admin')",
            name="ck_privacy_approval_approver_role",
        ),
        CheckConstraint(
            "state IN ('pending','approved','consumed','revoked','expired')",
            name="ck_privacy_approval_state",
        ),
        CheckConstraint(
            "action = 'simulated_action'", name="ck_privacy_approval_action"
        ),
        CheckConstraint(
            "aggregate_type IN ('asset','incident')",
            name="ck_privacy_approval_aggregate_type",
        ),
        CheckConstraint(
            "snapshot_revision >= 0", name="ck_privacy_approval_snapshot_revision"
        ),
        CheckConstraint(
            "payload_digest ~ '^[0-9a-f]{64}$' AND snapshot_digest ~ '^[0-9a-f]{64}$'",
            name="ck_privacy_approval_digests",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    tenant_id: Mapped[str] = mapped_column(String(63), nullable=False, index=True)
    site_id: Mapped[str] = mapped_column(String(63), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(16), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("identity_users.id"))
    approver_role: Mapped[str | None] = mapped_column(String(16))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
