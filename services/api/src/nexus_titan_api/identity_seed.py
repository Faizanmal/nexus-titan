"""Create the isolated local demo organization; never targets a real Firebase project."""

from __future__ import annotations

import argparse
import os
from urllib.parse import urlparse

from firebase_admin import auth
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import database_url, engine_for
from .identity import firebase_app, validate_identity_configuration
from .identity_services import sync_membership_projection
from .models import Membership, Organization, Site, User


def validate_seed_target(*, organization_id: str, site_id: str) -> None:
    if os.getenv("APP_ENV") != "local":
        raise RuntimeError("Identity demo seed requires APP_ENV=local")
    if organization_id != "demo-nexus" or site_id != "demo-site":
        raise RuntimeError(
            "Identity demo seed is restricted to organization demo-nexus and site demo-site"
        )
    parsed = urlparse(os.getenv("DATABASE_URL", ""))
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Identity demo seed requires a loopback PostgreSQL host")
    if os.getenv("FIREBASE_AUTH_EMULATOR_HOST") not in {
        "127.0.0.1:9099",
        "localhost:9099",
    }:
        raise RuntimeError(
            "Identity demo seed requires the loopback Firebase Auth emulator"
        )
    if os.getenv("FIRESTORE_EMULATOR_HOST") not in {"127.0.0.1:8080", "localhost:8080"}:
        raise RuntimeError(
            "Identity demo seed requires the loopback Firestore emulator"
        )


def seed_demo(*, owner_uid: str, organization_id: str, site_id: str) -> None:
    validate_seed_target(organization_id=organization_id, site_id=site_id)
    validate_identity_configuration()
    firebase_user = auth.get_user(owner_uid, app=firebase_app())
    if not firebase_user.email or not firebase_user.email_verified:
        raise RuntimeError(
            "The demo owner must have a verified email in the Auth emulator"
        )

    with Session(engine_for(database_url())) as session:
        session.execute(
            text(
                "INSERT INTO tenants(tenant_id) VALUES (:tenant_id) ON CONFLICT DO NOTHING"
            ),
            {"tenant_id": organization_id},
        )
        organization = session.get(Organization, organization_id)
        if organization is None:
            session.add(
                Organization(id=organization_id, display_name="NEXUS Titan Demo")
            )
        site = session.get(Site, site_id)
        if site is None:
            session.add(
                Site(id=site_id, organization_id=organization_id, name="Demo site")
            )
        elif site.organization_id != organization_id:
            raise RuntimeError(
                "The demo site ID is already owned by another organization"
            )
        user = session.get(User, owner_uid)
        if user is None:
            session.add(User(id=owner_uid, email=firebase_user.email.lower()))
        else:
            user.email = firebase_user.email.lower()
        membership = session.get(Membership, (organization_id, owner_uid))
        if membership is None:
            session.add(
                Membership(
                    organization_id=organization_id,
                    user_id=owner_uid,
                    role="owner",
                    status="active",
                )
            )
        else:
            membership.role = "owner"
            membership.status = "active"
        session.commit()
        sync_membership_projection(
            organization_id=organization_id,
            user_id=owner_uid,
            active=True,
            role="owner",
            site_ids=set(),
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner-uid", required=True)
    parser.add_argument("--organization-id", default="demo-nexus")
    parser.add_argument("--site-id", default="demo-site")
    arguments = parser.parse_args()
    seed_demo(
        owner_uid=arguments.owner_uid,
        organization_id=arguments.organization_id,
        site_id=arguments.site_id,
    )
    print(
        f"Local demo organization {arguments.organization_id} and site {arguments.site_id} are ready."
    )
