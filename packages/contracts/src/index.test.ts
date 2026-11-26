import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isEventSource, type EventBatch, type TelemetrySample } from "./generated.ts";
import { healthStatus } from "./index.ts";

test("health contract JSON roundtrip", () => {
  const encoded = JSON.stringify(healthStatus());
  assert.deepEqual(JSON.parse(encoded), {
    status: "ok",
    service: "nexus-titan-api",
  });
});

test("synthetic event batch JSON roundtrip preserves the contract payload", () => {
  const fixture = new URL("../../../tests/fixtures/contracts/v1.0.0/event-sequence.json", import.meta.url);
  const payload = JSON.parse(readFileSync(fixture, "utf8")) as EventBatch;
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  assert.equal(isEventSource("device"), true);
  assert.equal(isEventSource("unknown-source"), false);
});

test("telemetry sample JSON roundtrip preserves null and explicit quality/unit fields", () => {
  const sample: TelemetrySample = {
    fixture_id: "TITAN-WTP-01", site_id: "titan-wtp-01", asset_id: "WTP01-PMP-001",
    sample_sequence: 7, sampled_at: "2026-01-01T00:00:00Z", metric: "pressure",
    value: null, unit: "kPa", quality: "missing",
  };
  assert.deepEqual(JSON.parse(JSON.stringify(sample)), sample);
});
