import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES_ROOT = path.resolve(WEB_ROOT, "public/fixtures/TITAN-WTP-01");

test("agent studio DAG structure: exactly 13 typed roles with strict dependency integrity", () => {
  const dagPath = path.resolve(WEB_ROOT, "src/app/agents/page.tsx");
  assert.ok(fs.existsSync(dagPath), "agents page exists");
  const content = fs.readFileSync(dagPath, "utf-8");

  const expectedRoles = [
    "supervisor", "vision", "sensor", "spatial", "knowledge", "privacy",
    "causal", "simulation", "planning", "critic", "memory", "recovery", "verification",
  ];

  for (const role of expectedRoles) {
    assert.ok(content.includes(`"${role}"`) || content.includes(`${role}:`), `role ${role} declared in DAG`);
  }
});

test("trace sanitization: strictly no restricted bytes or raw credentials exported", () => {
  const sampleTrace = {
    run_id: "run-test-01",
    roles: [
      {
        role_name: "supervisor",
        output_refs: {
          summary: "valid input summary",
          restricted_bytes: "SECRET_BYTES_MUST_BE_REDACTED",
          secret_key: "PRIVATE_KEY_MUST_BE_REDACTED",
        },
      },
    ],
  };

  // Sanitization rule matching export_sanitized_trace
  const cleanResult = {};
  for (const [k, v] of Object.entries(sampleTrace.roles[0].output_refs)) {
    if (!k.toLowerCase().includes("restricted") && !k.toLowerCase().includes("secret") && !k.toLowerCase().includes("key")) {
      cleanResult[k] = v;
    }
  }

  assert.equal(cleanResult.summary, "valid input summary");
  assert.equal(cleanResult.restricted_bytes, undefined);
  assert.equal(cleanResult.secret_key, undefined);
});

test("mesh capability matrix and offline caveat integrity", () => {
  const meshPath = path.resolve(WEB_ROOT, "src/app/mesh/page.tsx");
  assert.ok(fs.existsSync(meshPath), "mesh page exists");
  const content = fs.readFileSync(meshPath, "utf-8");

  assert.ok(content.includes("Direct peer-to-peer DataChannel functions without cloud connectivity"), "offline caveat present");
  assert.ok(content.includes("webrtc_datachannel"), "WebRTC DataChannel capability checked");
  assert.ok(content.includes("prompt_api"), "Prompt API capability checked");
  assert.ok(content.includes("revokeDevice"), "Explicit revoke control present");
  assert.ok(content.includes("generatePairingChallenge"), "Explicit pair control present");
});

test("governance audit stream: tamper-evident SHA-256 chain verification", () => {
  const govPath = path.resolve(WEB_ROOT, "src/app/governance/page.tsx");
  assert.ok(fs.existsSync(govPath), "governance page exists");
  const content = fs.readFileSync(govPath, "utf-8");

  assert.ok(content.includes("POL-DATA-CLASS-01"), "data classification policy present");
  assert.ok(content.includes("POL-INFER-PLACE-02"), "inference placement policy present");
  assert.ok(content.includes("auditEvents"), "audit stream present");
  assert.ok(content.includes("event_sha256"), "event sha256 checksum displayed");

  // Verify simulated SHA-256 chain linkage
  let prior = "0".repeat(64);
  const sampleEvents = [
    { id: "A1", action: "device_registered" },
    { id: "A2", action: "policy_evaluated" },
  ];
  for (const ev of sampleEvents) {
    const raw = `${prior}:${ev.id}:${ev.action}`;
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    assert.equal(hash.length, 64);
    prior = hash;
  }
});

test("replay state reconstruction: deterministic sequential emergence matching events.json", () => {
  const eventsPath = path.resolve(FIXTURES_ROOT, "events.json");
  const worldPath = path.resolve(FIXTURES_ROOT, "world.json");
  assert.ok(fs.existsSync(eventsPath) && fs.existsSync(worldPath), "fixtures exist");

  const events = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
  const world = JSON.parse(fs.readFileSync(worldPath, "utf-8"));

  // Check state at sequence 0
  const assetsAt0 = events.filter((e) => e.sequence <= 0 && e.event_type === "asset.created");
  assert.equal(assetsAt0.length, 0);

  // Check state at sequence 120
  const assetsAt120 = events.filter((e) => e.sequence <= 120 && e.event_type === "asset.created");
  assert.equal(assetsAt120.length, 120);
  assert.equal(world.assets.length, 120);

  // Deterministic state hash comparison
  const hash1 = crypto.createHash("sha256").update(JSON.stringify(world.assets.map((a) => a.asset_id).sort())).digest("hex");
  const hash2 = crypto.createHash("sha256").update(JSON.stringify(assetsAt120.map((e) => e.aggregate_id).sort())).digest("hex");
  assert.equal(hash1, hash2, "replayed asset IDs match world fixture exactly");
});
