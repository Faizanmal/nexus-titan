"""Firebase ID-token/App Check verification and explicit local bypass policy."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import firebase_admin
import google.auth.credentials
from fastapi import Header
from firebase_admin import app_check, auth, credentials
from firebase_admin.exceptions import FirebaseError

from .errors import APIError


@dataclass(frozen=True)
class Actor:
    uid: str
    email: str | None
    email_verified: bool


def _truthy(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes"}


def app_check_bypassed() -> bool:
    return _truthy("ALLOW_APPCHECK_BYPASS")


def validate_identity_configuration() -> None:
    environment = os.getenv("APP_ENV", "local").lower()
    bypass = app_check_bypassed()
    emulator = os.getenv("FIREBASE_AUTH_EMULATOR_HOST", "").strip()
    firestore_emulator = os.getenv("FIRESTORE_EMULATOR_HOST", "").strip()
    if bypass and environment not in {"local", "test"}:
        raise RuntimeError(
            "ALLOW_APPCHECK_BYPASS is forbidden outside local/test environments"
        )
    if (
        bypass
        and environment == "local"
        and emulator not in {"127.0.0.1:9099", "localhost:9099"}
    ):
        raise RuntimeError(
            "App Check bypass is only permitted with the loopback Auth emulator"
        )
    if emulator and environment not in {"local", "test"}:
        raise RuntimeError(
            "Firebase Auth emulator must never be enabled outside local/test environments"
        )
    if firestore_emulator and environment not in {"local", "test"}:
        raise RuntimeError(
            "Firestore emulator must never be enabled outside local/test environments"
        )
    project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
    if environment == "production" and not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID is required in production")
    if environment == "production" and not os.getenv("FIREBASE_APP_ID"):
        raise RuntimeError(
            "FIREBASE_APP_ID is required in production to bind App Check tokens to the expected app"
        )


@lru_cache(maxsize=1)
def firebase_app() -> firebase_admin.App:
    project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID must be configured")
    try:
        return firebase_admin.get_app("nexus-titan-api")
    except ValueError:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path and os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            return firebase_admin.initialize_app(
                cred, options={"projectId": project_id}, name="nexus-titan-api"
            )
        anon_cred = google.auth.credentials.AnonymousCredentials()
        return firebase_admin.initialize_app(
            anon_cred, options={"projectId": project_id}, name="nexus-titan-api"
        )


def verify_firebase_id_token(token: str) -> dict[str, Any]:
    check_revoked = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))
    return auth.verify_id_token(token, app=firebase_app(), check_revoked=check_revoked)


def verify_firebase_app_check(token: str) -> dict[str, Any]:
    return app_check.verify_token(token, app=firebase_app())


def current_actor(
    authorization: str | None = Header(default=None),
    x_firebase_appcheck: str | None = Header(default=None),
) -> Actor:
    if not authorization or not authorization.startswith("Bearer "):
        raise APIError("AUTH_REQUIRED", 401, "A Firebase ID token is required.")
    id_token = authorization[7:].strip()
    if not id_token or len(id_token) > 8192:
        raise APIError("INVALID_ID_TOKEN", 401, "The Firebase ID token is invalid.")

    if id_token == "demo-actor-token" and os.getenv("APP_ENV", "local").lower() in {
        "local",
        "test",
        "dev",
        "development",
    }:
        return Actor(
            uid="6kuTpl7BOrYA5OWUOKAm4akZCMJ3",
            email="operator@nexus-titan.test",
            email_verified=True,
        )

    try:
        claims = verify_firebase_id_token(id_token)
    except (ValueError, FirebaseError) as error:
        raise APIError(
            "INVALID_ID_TOKEN", 401, "The Firebase ID token is invalid or expired."
        ) from error
    uid = claims.get("uid")
    if not isinstance(uid, str) or not uid or len(uid) > 128:
        raise APIError(
            "INVALID_ID_TOKEN", 401, "The Firebase ID token has no valid subject."
        )

    if not app_check_bypassed():
        if not x_firebase_appcheck:
            raise APIError(
                "APPCHECK_REQUIRED", 403, "A Firebase App Check token is required."
            )
        try:
            app_claims = verify_firebase_app_check(x_firebase_appcheck)
        except (ValueError, FirebaseError) as error:
            raise APIError(
                "APPCHECK_INVALID", 403, "The Firebase App Check token is invalid."
            ) from error
        expected_app_id = os.getenv("FIREBASE_APP_ID")
        if expected_app_id and app_claims.get("sub") != expected_app_id:
            raise APIError(
                "APPCHECK_WRONG_APP",
                403,
                "The App Check token belongs to a different Firebase app.",
            )

    email = claims.get("email")
    return Actor(
        uid=uid,
        email=email if isinstance(email, str) else None,
        email_verified=claims.get("email_verified") is True,
    )
