import assert from "node:assert/strict";
import { mapReportedInferenceSource } from "../apps/web/src/lib/firebase/inference-source.ts";
import {
  optionalJpegFixture,
  publicTextFixture,
  resolveSpikeFixture,
} from "../apps/web/src/lib/firebase/public-fixture.ts";

assert.equal(mapReportedInferenceSource("on_device"), "ON_DEVICE");
assert.equal(mapReportedInferenceSource("in_cloud"), "IN_CLOUD");
assert.equal(mapReportedInferenceSource("ON_DEVICE"), "ON_DEVICE");
assert.equal(mapReportedInferenceSource("IN_CLOUD"), "IN_CLOUD");
assert.equal(mapReportedInferenceSource(undefined), null);
assert.equal(mapReportedInferenceSource(null), null);
assert.equal(mapReportedInferenceSource("ONLY_ON_DEVICE"), null);
assert.equal(mapReportedInferenceSource({ injected: "ON_DEVICE" }), null);
console.log("PASS inferenceSource mapper rejects injection and unrecognized values");

for (const mode of ["PREFER_ON_DEVICE", "PREFER_IN_CLOUD", "ONLY_IN_CLOUD", "ONLY_ON_DEVICE"] as const) {
  const fixture = resolveSpikeFixture(mode);
  assert.equal(fixture.kind, "text");
  assert.equal(fixture.id, publicTextFixture.id);
  assert.equal(fixture.prompt, publicTextFixture.prompt);
}
const preferWithJpeg = resolveSpikeFixture("PREFER_ON_DEVICE", { includeOptionalJpeg: true });
assert.equal(preferWithJpeg.kind, "text", "PREFER routes must never receive the optional JPEG");
const onlyDeviceJpeg = resolveSpikeFixture("ONLY_ON_DEVICE", { includeOptionalJpeg: true });
assert.equal(onlyDeviceJpeg.kind, "image");
assert.equal(onlyDeviceJpeg.id, optionalJpegFixture.id);
assert.equal(onlyDeviceJpeg.cloudAllowed, false);
console.log("PASS fixture adapter keeps PREFER/cloud on public text; JPEG only for ONLY_ON_DEVICE opt-in");
