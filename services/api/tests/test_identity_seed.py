from __future__ import annotations

import pytest

from nexus_titan_api.identity_seed import validate_seed_target


@pytest.fixture
def local_demo_environment(monkeypatch):
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://local:local-only@127.0.0.1:5432/nexus_dev"
    )
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")


def test_demo_seed_accepts_only_loopback_emulator_target(local_demo_environment):
    validate_seed_target(organization_id="demo-nexus", site_id="demo-site")


@pytest.mark.parametrize(
    "environment,organization_id,site_id,database_url,error",
    [
        (
            "production",
            "demo-nexus",
            "demo-site",
            "postgresql://local:local-only@127.0.0.1:5432/nexus_dev",
            "APP_ENV=local",
        ),
        (
            "local",
            "other-org",
            "demo-site",
            "postgresql://local:local-only@127.0.0.1:5432/nexus_dev",
            "restricted",
        ),
        (
            "local",
            "demo-nexus",
            "demo-site",
            "postgresql://local:local-only@db.example.test:5432/nexus",
            "loopback",
        ),
    ],
)
def test_demo_seed_rejects_production_or_nonisolated_target(
    local_demo_environment,
    monkeypatch,
    environment,
    organization_id,
    site_id,
    database_url,
    error,
):
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("DATABASE_URL", database_url)
    with pytest.raises(RuntimeError, match=error):
        validate_seed_target(organization_id=organization_id, site_id=site_id)
