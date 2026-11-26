"""Bounded synthetic sample ingestion and canonical, deduplicated incident alerts."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid5

from sqlalchemy import text
from sqlalchemy.orm import Session

from .contracts import validate_contract
from .database import database_url, engine_for
from .event_store import append_event
from .privacy_policy import evaluate_privacy
from .telemetry import FIXTURE_ID, generate_series, score_samples, sustained_alerts

SITE_ID = "titan-wtp-01"
ALERT_NAMESPACE = UUID("f90b601e-bd5a-5e8a-a264-c450d9d351c2")


def load_world() -> dict:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "tests/fixtures/world" / FIXTURE_ID / "world.json"
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise RuntimeError("Synthetic world fixture is not installed")


def simulate(
    tenant_id: str,
    *,
    confirmed_tenant: str | None,
    seed: int = 20261115,
    steps: int = 240,
    batch_size: int = 500,
    throttle_ms: int = 0,
) -> dict:
    if os.getenv("APP_ENV") != "local" or tenant_id != confirmed_tenant:
        raise RuntimeError(
            "Telemetry simulation requires APP_ENV=local and exact tenant confirmation"
        )
    if tenant_id != "demo-nexus":
        raise RuntimeError(
            "Synthetic telemetry may only be written to the isolated demo-nexus tenant"
        )
    decision = evaluate_privacy(
        role="service_worker",
        purpose="synthetic_telemetry",
        destination="telemetry",
        classification="public",
        tenant_match=True,
        device_trusted=True,
    )
    if not decision["allow"]:
        raise RuntimeError("Privacy policy denied synthetic telemetry ingestion")
    if not 1 <= batch_size <= 2000 or not 0 <= throttle_ms <= 5000:
        raise ValueError("batch_size or throttle_ms is outside the bounded limits")
    world = load_world()
    samples, labels = generate_series(world, seed=seed, steps=steps)
    scored = score_samples(samples)
    alerts = sustained_alerts(scored)
    engine = engine_for(database_url())
    inserted = duplicates = 0
    with Session(engine, expire_on_commit=False) as session:
        for offset in range(0, len(samples), batch_size):
            batch = samples[offset : offset + batch_size]
            values = []
            for sample in batch:
                item = {**sample, "site_id": SITE_ID}
                if validate_contract("TelemetrySample", item):
                    raise ValueError(
                        "generated synthetic sample failed its wire contract"
                    )
                values.append(
                    {
                        "tenant_id": tenant_id,
                        "site_id": SITE_ID,
                        "fixture_id": FIXTURE_ID,
                        "asset_id": item["asset_id"],
                        "sampled_at": datetime.fromisoformat(
                            item["sampled_at"].replace("Z", "+00:00")
                        ),
                        "sample_sequence": item["sample_sequence"],
                        "metric": item["metric"],
                        "value": item["value"],
                        "unit": item["unit"],
                        "quality": item["quality"],
                    }
                )
            result = session.execute(
                text("""INSERT INTO telemetry_samples
                (tenant_id,site_id,fixture_id,asset_id,sampled_at,sample_sequence,metric,value,unit,quality)
                VALUES (:tenant_id,:site_id,:fixture_id,:asset_id,:sampled_at,:sample_sequence,:metric,:value,:unit,:quality)
                ON CONFLICT (tenant_id,site_id,asset_id,metric,sampled_at) DO NOTHING
                RETURNING sample_sequence"""),
                values,
            )
            batch_inserted = len(result.all())
            inserted += batch_inserted
            duplicates += len(batch) - batch_inserted
            session.commit()
            if throttle_ms and offset + batch_size < len(samples):
                time.sleep(throttle_ms / 1000)

        emitted = 0
        for alert in alerts:
            triggered_at = datetime.fromisoformat(
                alert["sampled_at"].replace("Z", "+00:00")
            )
            window_start = datetime.fromtimestamp(
                int(triggered_at.timestamp()) // 300 * 300, UTC
            )
            cooldown = session.execute(
                text("""SELECT 1 FROM telemetry_alerts
                WHERE tenant_id=:tenant AND site_id=:site AND asset_id=:asset AND metric=:metric
                  AND triggered_at > :triggered_at - interval '15 minutes' LIMIT 1"""),
                {
                    "tenant": tenant_id,
                    "site": SITE_ID,
                    "asset": alert["asset_id"],
                    "metric": alert["metric"],
                    "triggered_at": triggered_at,
                },
            ).first()
            if cooldown:
                continue
            event_id = uuid5(
                ALERT_NAMESPACE,
                f"{tenant_id}:{SITE_ID}:{alert['asset_id']}:{alert['metric']}:{window_start.isoformat()}",
            )
            # Serialize alert append attempts before reading the idempotency row. This prevents two
            # concurrent simulator runs from selecting different event sequence numbers for one ID.
            tenant_head = int(
                session.execute(
                    text(
                        "SELECT last_sequence FROM tenants WHERE tenant_id=:tenant FOR UPDATE"
                    ),
                    {"tenant": tenant_id},
                ).scalar_one()
            )
            previous = session.execute(
                text(
                    "SELECT sequence FROM events WHERE tenant_id=:tenant AND event_id=:event_id"
                ),
                {"tenant": tenant_id, "event_id": event_id},
            ).first()
            if previous:
                sequence = int(previous.sequence)
            else:
                sequence = tenant_head + 1
            event = {
                "event_id": str(event_id),
                "tenant_id": tenant_id,
                "schema_version": "1.3.0",
                "event_type": "incident.created",
                "source": "simulator",
                "sequence": sequence,
                "occurred_at": alert["sampled_at"],
                "classification": "internal",
                "site_id": SITE_ID,
                "aggregate_type": "incident",
                "aggregate_id": str(event_id),
                "expected_revision": 0,
                "payload": {
                    "label": f"Synthetic {alert['metric']} anomaly at {alert['asset_id']}",
                    "status": "open",
                    "affected_asset_ids": [alert["asset_id"]],
                    "state": {
                        "fixture_id": FIXTURE_ID,
                        "metric": alert["metric"],
                        "evidence_samples": alert["evidence_samples"],
                        "triggered_at": alert["sampled_at"],
                        "policy": "3-of-5 robust-z sustained evidence; 15-minute cooldown",
                    },
                },
            }
            if validate_contract("Event", event):
                raise ValueError(
                    "synthetic anomaly event failed the shared event schema"
                )
            append_result = append_event(session, device_id=None, event=event)
            if append_result["status"] not in {"accepted", "duplicate"}:
                raise RuntimeError("canonical incident append conflicted")
            session.execute(
                text("""INSERT INTO telemetry_alerts
                (tenant_id,site_id,asset_id,metric,window_start,event_id,triggered_at)
                VALUES (:tenant,:site,:asset,:metric,:window,:event,:triggered)
                ON CONFLICT DO NOTHING"""),
                {
                    "tenant": tenant_id,
                    "site": SITE_ID,
                    "asset": alert["asset_id"],
                    "metric": alert["metric"],
                    "window": window_start,
                    "event": event_id,
                    "triggered": triggered_at,
                },
            )
            session.commit()
            if append_result["status"] == "accepted":
                emitted += 1
    return {
        "tenant_id": tenant_id,
        "fixture_id": FIXTURE_ID,
        "seed": seed,
        "generated": len(samples),
        "inserted": inserted,
        "duplicates": duplicates,
        "alerts": len(alerts),
        "incidents_emitted": emitted,
        "holdout": score_holdout(scored, labels),
    }


def score_holdout(scored: list[dict], labels: list[dict]) -> dict:
    from .telemetry import holdout_metrics

    return holdout_metrics(scored, labels)


def prune(
    tenant_id: str, *, confirmed_tenant: str | None, retention_days: int = 90
) -> int:
    if (
        os.getenv("APP_ENV") != "local"
        or tenant_id != confirmed_tenant
        or tenant_id != "demo-nexus"
    ):
        raise RuntimeError(
            "Telemetry pruning is restricted to confirmed local demo-nexus data"
        )
    if not 30 <= retention_days <= 365:
        raise ValueError("retention_days must be between 30 and 365")
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    with Session(engine_for(database_url())) as session:
        removed = session.execute(
            text(
                """DELETE FROM telemetry_samples
            WHERE tenant_id=:tenant AND fixture_id=:fixture AND sampled_at < :cutoff"""
            ),
            {"tenant": tenant_id, "fixture": FIXTURE_ID, "cutoff": cutoff},
        ).rowcount
        session.commit()
    return max(0, int(removed or 0))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--confirm", required=True)
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument("--steps", type=int, default=240)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--throttle-ms", type=int, default=0)
    parser.add_argument("--prune", action="store_true")
    parser.add_argument("--retention-days", type=int, default=90)
    args = parser.parse_args()
    if args.prune:
        print(
            json.dumps(
                {
                    "tenant_id": args.tenant,
                    "retention_days": args.retention_days,
                    "deleted_samples": prune(
                        args.tenant,
                        confirmed_tenant=args.confirm,
                        retention_days=args.retention_days,
                    ),
                },
                sort_keys=True,
            )
        )
    else:
        print(
            json.dumps(
                simulate(
                    args.tenant,
                    confirmed_tenant=args.confirm,
                    seed=args.seed,
                    steps=args.steps,
                    batch_size=args.batch_size,
                    throttle_ms=args.throttle_ms,
                ),
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
