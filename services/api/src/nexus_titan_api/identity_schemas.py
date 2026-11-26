from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

MemberRole = Literal["owner", "admin", "operator", "viewer", "judge"]
InvitableRole = Literal["admin", "operator", "viewer", "judge"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SiteCreate(StrictModel):
    site_id: str = Field(
        min_length=2, max_length=63, pattern=r"^[a-z0-9][a-z0-9_-]{1,62}$"
    )
    name: str = Field(min_length=1, max_length=160)


class InviteCreate(StrictModel):
    email: str = Field(min_length=3, max_length=320)
    role: InvitableRole
    site_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("email must be a valid address")
        return value


class InviteAccept(StrictModel):
    invite_token: str = Field(min_length=32, max_length=128)


class MemberUpdate(StrictModel):
    role: InvitableRole
    status: Literal["active", "suspended"]
    site_ids: list[str] = Field(default_factory=list, max_length=100)


class DeviceChallenge(StrictModel):
    client_device_id: str = Field(
        min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"
    )


class DeviceRegistration(StrictModel):
    challenge_id: str = Field(min_length=36, max_length=36)
    client_device_id: str = Field(
        min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"
    )
    label: str = Field(min_length=1, max_length=120)
    public_key_pem: str = Field(min_length=80, max_length=4096)
    signature_base64: str = Field(min_length=80, max_length=256)


class UploadAuthorizationCreate(StrictModel):
    site_id: str = Field(
        min_length=2, max_length=63, pattern=r"^[a-z0-9][a-z0-9_-]{1,62}$"
    )
    user_id: str = Field(min_length=1, max_length=128)
    max_bytes: int = Field(gt=0, le=15 * 1024 * 1024)
    content_type: Literal["application/pdf", "image/jpeg", "image/png"]
    classification: Literal["PUBLIC", "INTERNAL"]
    device_id: UUID
    consent: Literal[True]
    expires_minutes: int = Field(default=60, ge=5, le=1440)


class PrivacyApprovalCreate(StrictModel):
    site_id: str = Field(
        min_length=2, max_length=63, pattern=r"^[a-z0-9][a-z0-9_-]{1,62}$"
    )
    device_id: UUID
    aggregate_type: Literal["asset", "incident"]
    aggregate_id: str = Field(min_length=1, max_length=128)
    snapshot_revision: int = Field(ge=0)
    action_payload: dict[str, Any]
    idempotency_key: str = Field(min_length=8, max_length=128)
    consent: Literal[True]
    expires_minutes: int = Field(default=10, ge=1, le=60)


class PrivacyApprovalConsume(StrictModel):
    action_payload: dict[str, Any]
    device_id: UUID


class PrivacyResourceReference(StrictModel):
    aggregate_type: Literal["asset", "incident"]
    aggregate_id: str = Field(min_length=1, max_length=128)


class PrivacyDecisionRequest(StrictModel):
    site_id: str = Field(
        min_length=2, max_length=63, pattern=r"^[a-z0-9][a-z0-9_-]{1,62}$"
    )
    device_id: UUID
    destination: Literal[
        "local_inference",
        "cloud_inference",
        "upload",
        "telemetry",
        "sync",
        "peer",
        "rag_index",
        "audit_metadata",
    ]
    purpose: str = Field(min_length=1, max_length=64)
    resource_refs: list[PrivacyResourceReference] = Field(
        default_factory=list, max_length=32
    )
    consent: bool = False
    approval_id: UUID | None = None
    upload_authorization_id: str | None = Field(
        default=None, min_length=16, max_length=96
    )
