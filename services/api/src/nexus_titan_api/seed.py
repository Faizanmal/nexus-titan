"""Idempotent local-only demo tenant and synthetic public event seed."""

import os
from uuid import UUID

import psycopg

TENANT = "demo-nexus"
EVENT_ID = UUID("10000000-0000-4000-8000-000000000001")


def seed() -> int:
    if os.getenv("APP_ENV") != "local":
        raise RuntimeError("Demo seed is restricted to APP_ENV=local")
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url) as connection:
        connection.execute(
            "INSERT INTO tenants(tenant_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (TENANT,),
        )
        connection.execute(
            "INSERT INTO events(tenant_id,event_id,sequence,schema_version,event_type,source,classification,occurred_at,payload) "
            "VALUES (%s,%s,1,'1.0.0','demo.seeded','API','PUBLIC',now(),%s) ON CONFLICT DO NOTHING",
            (
                TENANT,
                EVENT_ID,
                '{"fixture":true,"message":"Synthetic local demo event"}',
            ),
        )
        count = connection.execute(
            "SELECT count(*) FROM events WHERE tenant_id = %s AND event_id = %s",
            (TENANT, EVENT_ID),
        ).fetchone()[0]
        if count != 1:
            raise RuntimeError("Demo event invariant failed")
        return count


if __name__ == "__main__":
    count = seed()
    print(
        f"Seeded synthetic public demo tenant demo-nexus; fixture_event_rows={count}."
    )
