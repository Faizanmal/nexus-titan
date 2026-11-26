from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from firebase_admin import firestore
from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .identity import firebase_app
from .models import MembershipSite, RateLimitBucket, UploadAuthorization


def enforce_rate_limit(
    session: Session,
    *,
    scope: str,
    actor: str,
    limit: int,
    window: timedelta,
    cost: int = 1,
) -> None:
    if cost < 1 or cost > limit:
        from .errors import APIError

        raise APIError(
            "RATE_LIMITED", 429, "The request cost exceeds the configured rate limit."
        )
    now = datetime.now(UTC)
    window_seconds = int(window.total_seconds())
    window_start = datetime.fromtimestamp(
        int(now.timestamp()) // window_seconds * window_seconds, UTC
    )
    key = hashlib.sha256(f"{scope}:{actor}".encode()).hexdigest()
    table = RateLimitBucket.__table__
    statement = insert(RateLimitBucket).values(
        key=key, window_started_at=window_start, hits=cost
    )
    statement = statement.on_conflict_do_update(
        index_elements=[table.c.key],
        set_={
            "window_started_at": case(
                (table.c.window_started_at < window_start, window_start),
                else_=table.c.window_started_at,
            ),
            "hits": case(
                (table.c.window_started_at < window_start, cost),
                else_=table.c.hits + cost,
            ),
        },
    ).returning(table.c.hits)
    hits = session.execute(statement).scalar_one()
    session.commit()
    if hits > limit:
        from .errors import APIError

        raise APIError("RATE_LIMITED", 429, "The request rate limit was exceeded.")


def sync_membership_projection(
    *, organization_id: str, user_id: str, active: bool, role: str, site_ids: set[str]
) -> None:
    """Write only server-owned, minimal Firestore ACL projection documents."""
    try:
        client = firestore.client(app=firebase_app())
        root = client.collection("organizations").document(organization_id)
        membership_ref = root.collection("memberships").document(user_id)
        scopes = (
            root.collection("site_memberships").document(user_id).collection("sites")
        )
        existing = {document.id for document in scopes.stream()}
        allowed = site_ids if active and role not in {"owner", "admin"} else set()

        # Rules consult this single atomic membership document for active state, role and scope.
        membership_ref.set(
            {
                "active": active,
                "role": role,
                "site_ids": sorted(allowed),
                "updated_at": firestore.SERVER_TIMESTAMP,
            }
        )
        # Retain the per-site projection for server-side diagnostics; it is not an auth source.
        for site_id in existing - allowed:
            scopes.document(site_id).delete()
        for site_id in allowed - existing:
            scopes.document(site_id).set({"active": True})
    except Exception as error:
        raise RuntimeError("Firestore membership projection update failed") from error


def get_scoped_site_ids(
    session: Session, organization_id: str, user_id: str
) -> set[str]:
    return set(
        session.scalars(
            select(MembershipSite.site_id).where(
                MembershipSite.organization_id == organization_id,
                MembershipSite.user_id == user_id,
            )
        ).all()
    )


def sync_upload_authorization(row: UploadAuthorization) -> None:
    """Publish one server-approved, immutable upload capability for Storage Rules."""
    try:
        client = firestore.client(app=firebase_app())
        reference = (
            client.collection("organizations")
            .document(row.organization_id)
            .collection("sites")
            .document(row.site_id)
            .collection("upload_authorizations")
            .document(row.id)
        )
        if row.status == "revoked":
            reference.set({"status": "revoked"})
            return
        reference.set(
            {
                "status": row.status,
                "user_id": row.user_id,
                "max_bytes": row.max_bytes,
                "content_type": row.content_type,
                "classification": row.classification,
                "expires_at": row.expires_at,
            }
        )
    except Exception as error:
        raise RuntimeError("Firestore upload authorization update failed") from error
