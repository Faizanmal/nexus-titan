"""Apply ordered SQL migrations, each atomically and idempotently."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from alembic.config import Config

from alembic import command

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
API_ROOT = Path(__file__).resolve().parents[2]


def sql_statements(script: str) -> list[str]:
    """Split this project's simple, non-procedural SQL migration files safely."""
    return [statement.strip() for statement in script.split(";") if statement.strip()]


def _apply_raw_migrations(
    url: str, *, before: str | None = None, after: str | None = None
) -> list[str]:
    applied: list[str] = []
    with psycopg.connect(url) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        connection.commit()
        for path in sorted(MIGRATIONS.glob("[0-9]*.sql")):
            version = path.stem
            if before and version >= before:
                continue
            if after and version <= after:
                continue
            found = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = %s", (version,)
            ).fetchone()
            if found:
                continue
            with connection.transaction():
                for statement in sql_statements(path.read_text(encoding="utf-8")):
                    connection.execute(statement)
                connection.execute(
                    "INSERT INTO schema_migrations(version) VALUES (%s)", (version,)
                )
            applied.append(version)
    return applied


def migrate(database_url: str | None = None) -> list[str]:
    """Apply the complete dependency-ordered SQL and Alembic schema."""
    return migrate_all(database_url)


def migrate_all(database_url: str | None = None) -> list[str]:
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option(
        "sqlalchemy.url",
        url.replace("%", "%%").replace("postgresql://", "postgresql+psycopg://", 1),
    )
    # Raw 001-004 need only the tenant base. Alembic 0002 creates identity tables
    # required by raw 005+, while Alembic 0003 depends on raw 003's world_documents.
    applied = _apply_raw_migrations(url, before="005_privacy_approvals")
    with psycopg.connect(url) as connection:
        has_alembic = connection.execute(
            "SELECT to_regclass('alembic_version') IS NOT NULL"
        ).fetchone()[0]
        revision = (
            connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            if has_alembic
            else None
        )
    if revision is None:
        command.upgrade(config, "0002_identity")
    elif revision not in {"0002_identity", "0003_world_sites"}:
        raise RuntimeError(f"Unsupported Alembic schema revision: {revision}")
    applied.extend(_apply_raw_migrations(url, after="004_synthetic_telemetry"))
    command.upgrade(config, "head")
    return applied


if __name__ == "__main__":
    versions = migrate_all()
    print(
        "Applied SQL migrations: "
        + (", ".join(versions) if versions else "none; already current")
        + "; Alembic identity schema is current."
    )
