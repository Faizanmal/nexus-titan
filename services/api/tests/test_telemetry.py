from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from nexus_titan_api import event_routes, telemetry, telemetry_store, world_routes
from nexus_titan_api.contracts import validate_contract
from nexus_titan_api.identity import Actor


def _world():
    path = (
        Path(__file__).resolve().parents[3]
        / "tests/fixtures/world/TITAN-WTP-01/world.json"
    )
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def test_seeded_series_and_fault_labels_are_reproducible_and_separate():
    first_samples, first_labels = telemetry.generate_series(
        _world(), seed=73, steps=80, missing_rate=0.08
    )
    second_samples, second_labels = telemetry.generate_series(
        _world(), seed=73, steps=80, missing_rate=0.08
    )
    assert first_samples == second_samples
    assert first_labels == second_labels
    assert len(first_samples) == 24 * 4 * 80
    assert first_labels
    assert all(
        sample["quality"] in {"good", "suspect", "missing"} for sample in first_samples
    )
    assert all("label" not in sample for sample in first_samples)
    assert any(
        sample["quality"] == "missing" and sample["value"] is None
        for sample in first_samples
    )


def test_detector_handles_out_of_order_samples_gaps_and_reports_holdout_metrics():
    samples, labels = telemetry.generate_series(
        _world(), seed=20261115, steps=120, missing_rate=0.03
    )
    scored = telemetry.score_samples(list(reversed(samples)))
    assert scored == telemetry.score_samples(samples)
    assert any(
        row["quality"] == "missing" and row["robust_z"] is None for row in scored
    )
    metrics = telemetry.holdout_metrics(scored, labels)
    assert metrics["true_positive"] > 0
    assert metrics["false_negative"] >= 0
    assert 0 <= metrics["precision"] <= 1
    assert 0 <= metrics["recall"] <= 1


def test_sustained_policy_requires_evidence_and_applies_cooldown():
    base = datetime(2026, 1, 1, tzinfo=UTC)
    rows = [
        {
            "asset_id": "WTP01-PMP-001",
            "metric": "pressure",
            "sample_sequence": index + 1,
            "sampled_at": (base + timedelta(seconds=index * 30))
            .isoformat()
            .replace("+00:00", "Z"),
            "quality": "good",
            "anomaly": index in {4, 5, 6, 9, 10, 11},
        }
        for index in range(12)
    ]
    alerts = telemetry.sustained_alerts(
        rows, min_hits=3, window=5, cooldown_seconds=900
    )
    assert alerts == telemetry.sustained_alerts(
        rows, min_hits=3, window=5, cooldown_seconds=900
    )
    assert len(alerts) == 1
    assert alerts[0]["evidence_samples"] == [5, 6, 7]


def test_contract_enforces_metric_units_and_missingness():
    sample = {
        "fixture_id": "TITAN-WTP-01",
        "site_id": "demo-site",
        "asset_id": "WTP01-PMP-001",
        "sample_sequence": 1,
        "sampled_at": "2026-01-01T00:00:00Z",
        "metric": "pressure",
        "value": None,
        "unit": "m3/h",
        "quality": "missing",
    }
    assert validate_contract("TelemetrySample", sample)
    sample["unit"] = "kPa"
    assert not validate_contract("TelemetrySample", sample)
    sample["quality"] = "good"
    assert validate_contract("TelemetrySample", sample)


def test_telemetry_query_is_tenant_site_scoped_and_marks_empty_as_unavailable(
    monkeypatch,
):
    captured = {}

    class Mappings:
        def all(self):
            return []

    class Result:
        def mappings(self):
            return Mappings()

    class Session:
        def execute(self, query, params):
            captured.update(params)
            assert "tenant_id=:tenant_id" in str(query)
            assert "site_id=:site_id" in str(query)
            return Result()

    monkeypatch.setattr(
        world_routes,
        "_authorize_site",
        lambda _s, tenant, _a, site: (
            captured.update({"authorized_tenant": tenant, "authorized_site": site})
            or ("operator", ["PUBLIC", "INTERNAL"])
        ),
    )
    monkeypatch.setattr(
        world_routes, "enforce_rate_limit", lambda *_args, **_kwargs: None
    )
    now = datetime(2026, 1, 1, tzinfo=UTC)
    for tenant_id in ("demo-nexus", "other-tenant"):
        response = world_routes.read_telemetry(
            tenant_id,
            "titan-wtp-01",
            "WTP01-PMP-001",
            "pressure",
            now,
            now + timedelta(minutes=5),
            60,
            Actor("operator", None, True),
            Session(),
        )
        assert response["availability"] == "no_data"
        assert response["stale"] is True
        assert response["points"] == []
        assert captured["authorized_tenant"] == captured["tenant_id"] == tenant_id
        assert captured["authorized_site"] == captured["site_id"] == "titan-wtp-01"


def test_telemetry_migration_constrains_tenant_metric_unit_and_duplicate_keys():
    migration = (
        Path(__file__).resolve().parents[1] / "migrations/004_synthetic_telemetry.sql"
    ).read_text(encoding="utf-8")
    assert "PRIMARY KEY (tenant_id,site_id,asset_id,metric,sampled_at)" in migration
    assert "REFERENCES tenants(tenant_id)" in migration
    assert "quality='missing' AND value IS NULL" in migration
    assert "CREATE INDEX telemetry_samples_window_idx" in migration
    assert "ON CONFLICT (tenant_id,site_id,asset_id,metric,sampled_at) DO NOTHING" in (
        Path(__file__).resolve().parents[1] / "src/nexus_titan_api/telemetry_store.py"
    ).read_text(encoding="utf-8")


def test_simulator_append_is_not_allowed_through_untrusted_device_sync(monkeypatch):
    event = {
        "tenant_id": "demo-nexus",
        "site_id": "titan-wtp-01",
        "source": "simulator",
        "classification": "internal",
        "aggregate_type": "incident",
        "event_type": "incident.created",
    }
    assert (
        event_routes.event_policy_denial(
            event,
            role="operator",
            tenant_id="demo-nexus",
            allowed_sites={"titan-wtp-01"},
        )
        == "SOURCE_FORBIDDEN"
    )
    monkeypatch.setenv("APP_ENV", "production")
    try:
        telemetry_store.simulate("demo-nexus", confirmed_tenant="demo-nexus", steps=40)
    except RuntimeError as error:
        assert "APP_ENV=local" in str(error)
    else:
        raise AssertionError("production must reject synthetic telemetry writes")


def test_batch_size_throttle_and_time_bounds_fail_closed_before_database(monkeypatch):
    monkeypatch.setenv("APP_ENV", "local")
    for kwargs in (
        {"batch_size": 0},
        {"batch_size": 2001},
        {"throttle_ms": 5001},
        {"steps": 2001},
    ):
        try:
            telemetry_store.simulate(
                "demo-nexus", confirmed_tenant="demo-nexus", **kwargs
            )
        except ValueError as error:
            assert "bounded" in str(error)
        else:
            raise AssertionError(f"invalid simulator bounds were accepted: {kwargs}")
