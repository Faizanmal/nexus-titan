from nexus_titan_api import migrations


def test_full_migration_coordinator_bridges_raw_and_alembic_dependencies(monkeypatch):
    calls = []

    class Result:
        def fetchone(self):
            return (False,)

    class Connection:
        def execute(self, *_args):
            return Result()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(migrations.psycopg, "connect", lambda _url: Connection())

    class FakeConfig:
        def set_main_option(self, *_args):
            pass

    monkeypatch.setattr(migrations, "Config", lambda _path: FakeConfig())
    monkeypatch.setattr(
        migrations,
        "_apply_raw_migrations",
        lambda _url, **bounds: calls.append(("raw", bounds)) or [],
    )
    monkeypatch.setattr(
        migrations.command,
        "upgrade",
        lambda _config, revision: calls.append(("alembic", revision)),
    )

    migrations.migrate_all("postgresql://fixture")

    assert calls == [
        ("raw", {"before": "005_privacy_approvals"}),
        ("alembic", "0002_identity"),
        ("raw", {"after": "004_synthetic_telemetry"}),
        ("alembic", "head"),
    ]
