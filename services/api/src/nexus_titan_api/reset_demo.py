"""Delete only the explicitly confirmed local demo tenant."""

import argparse
import os
from urllib.parse import urlparse

import psycopg


def reset(tenant: str, confirmation: str) -> None:
    if (
        os.getenv("APP_ENV") != "local"
        or tenant != "demo-nexus"
        or confirmation != tenant
    ):
        raise RuntimeError(
            "Reset requires APP_ENV=local, tenant demo-nexus and --confirm demo-nexus"
        )
    parsed = urlparse(os.environ["DATABASE_URL"])
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1", "postgres"}:
        raise RuntimeError("Refusing reset against a non-local database host")
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        connection.execute("DELETE FROM tenants WHERE tenant_id = %s", (tenant,))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    reset(args.tenant, args.confirm)
    print("Deleted only demo-nexus tenant data.")
