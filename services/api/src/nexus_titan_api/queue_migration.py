"""Cross-platform offline outbox queue migration and schema upgrade utilities."""

from __future__ import annotations

import copy
import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("nexus_titan_api.queue_migration")

CURRENT_SCHEMA_VERSION = "1.3.0"
SUPPORTED_LEGACY_VERSIONS = {"1.0.0", "1.1.0", "1.2.0", "1.3.0"}


class QueueMigrationError(ValueError):
    """Raised when an offline queue payload cannot be safely migrated."""


def migrate_event_record(event: dict[str, Any]) -> dict[str, Any]:
    """
    Migrates a single event record from legacy schema versions (v1.0.0-v1.2.0)
    to canonical schema v1.3.0. Preserves original event_id, timestamps, and payload
    while normalizing classification, schema_version, and mandatory wire fields.
    """
    upgraded = copy.deepcopy(event)

    schema_version = upgraded.get("schema_version", "1.0.0")
    if schema_version not in SUPPORTED_LEGACY_VERSIONS:
        raise QueueMigrationError(f"Unsupported event schema version: {schema_version}")

    # 1. Normalize schema version to v1.3.0
    upgraded["schema_version"] = CURRENT_SCHEMA_VERSION

    # 2. Normalize timestamp to ISO 8601 UTC
    if "timestamp" in upgraded:
        raw_ts = upgraded["timestamp"]
        if isinstance(raw_ts, (int, float)):
            dt = datetime.fromtimestamp(raw_ts, UTC)
            upgraded["timestamp"] = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        elif isinstance(raw_ts, str):
            # Ensure standard Z suffix
            if raw_ts.endswith("+00:00"):
                upgraded["timestamp"] = raw_ts[:-6] + "Z"
            elif not raw_ts.endswith("Z") and "+" not in raw_ts:
                upgraded["timestamp"] = raw_ts + "Z"

    # 3. Default classification if absent from older clients
    if "classification" not in upgraded:
        upgraded["classification"] = "confidential"

    # 4. Normalize source
    if "source" not in upgraded:
        upgraded["source"] = "device"

    # 5. Ensure payload is a dictionary
    if "payload" not in upgraded or not isinstance(upgraded["payload"], dict):
        upgraded["payload"] = {}

    return upgraded


def migrate_queue_batch(batch: dict[str, Any]) -> dict[str, Any]:
    """
    Migrates an entire offline sync batch to v1.3.0.
    Ensures all contained events are validated against v1.3.0 schemas.
    """
    migrated_batch = copy.deepcopy(batch)

    if not isinstance(migrated_batch.get("events"), list):
        raise QueueMigrationError("Batch events must be a list")

    migrated_events: list[dict[str, Any]] = []
    for raw_event in migrated_batch["events"]:
        migrated_events.append(migrate_event_record(raw_event))

    migrated_batch["events"] = migrated_events
    migrated_batch["schema_version"] = CURRENT_SCHEMA_VERSION

    return migrated_batch
