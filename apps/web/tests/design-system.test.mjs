import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/app/globals.css");
const shell = read("../src/components/command-center-shell.tsx");
const primitives = read("../src/components/command-center-primitives.tsx");

function token(theme, name) {
  const marker = theme === "dark" ? ':root[data-theme="dark"]' : ':root[data-theme="light"]';
  const start = css.indexOf(marker);
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing ${theme} ${name} token`);
  return match[1];
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + 0.05) / (values[1] + 0.05); }

test("all command-center destinations have a page entry", () => {
  const hrefs = [...shell.matchAll(/href:\s*"(\/[^\"]*)"/g)].map((match) => match[1]);
  for (const href of new Set(hrefs)) {
    const route = href === "/" ? "../src/app/page.tsx" : `../src/app${href}/page.tsx`;
    assert.ok(existsSync(new URL(route, import.meta.url)), `missing route page for ${href}`);
  }
});

test("dark and light text/accent tokens meet WCAG AA on primary surfaces", () => {
  for (const theme of ["dark", "light"]) {
    const surface = theme === "dark" ? token(theme, "surface-1") : "#ffffff";
    assert.ok(contrast(token(theme, "foreground"), token(theme, "background")) >= 4.5, `${theme} foreground contrast`);
    assert.ok(contrast(token(theme, "text-muted"), surface) >= 4.5, `${theme} muted contrast`);
    assert.ok(contrast(token(theme, "accent"), surface) >= 4.5, `${theme} accent contrast`);
  }
});

test("legacy route status colors are bridged to readable semantic tokens", () => {
  for (const utility of ["text-blue-800", "text-amber-800", "bg-amber-100", "text-red-900", "text-red-700"]) {
    assert.match(css, new RegExp(`\\[class~="${utility}"\\]`), `${utility} semantic bridge`);
  }
});

test("keyboard, reduced-motion and reusable accessibility primitives are present", () => {
  assert.match(shell, /ctrlKey.*key\.toLowerCase\(\).*=== "k"/s);
  assert.match(shell, /aria-modal="true"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  for (const name of ["StatusIndicator", "MetricValue", "EvidenceProvenance", "InferenceSourceChip", "PolicyDecision", "Timeline", "DataTable", "EmptyState", "ErrorState", "LoadingState", "OfflineState", "ConfirmationDialog", "GraphLegend"]) {
    assert.match(primitives, new RegExp(`function ${name}\\b`));
  }
});

test("component specimen fixtures are isolated from operational pages", () => {
  const fixtures = read("../src/components/demo/design-fixtures.ts");
  assert.match(fixtures, /never used as operational data/i);
  assert.match(read("../src/app/design-system/page.tsx"), /isolated visual specimen/i);
});

test("mission control and incident workspace use authorized projections and bounded cursor reads", () => {
  const mission = read("../src/app/mission/page.tsx");
  const incident = read("../src/app/incidents/[id]/page.tsx");
  assert.match(mission, /\/v1\/world\/snapshot/);
  assert.match(mission, /\/sync\/events\?/);
  assert.match(mission, /after_sequence=\$\{cursor\.current\}/);
  assert.match(mission, /has_more/);
  assert.match(incident, /\/v1\/causal\/investigations/);
  assert.match(incident, /\/v1\/agents\/runs/);
  assert.match(incident, /encodeURIComponent\(incidentId\)/);
});

test("field alias reuses the existing offline workflow and telemetry is API-backed/export-labeled", () => {
  assert.match(read("../src/app/field/page.tsx"), /<FieldRelayPage\s*\/>/);
  const telemetry = read("../src/app/telemetry/page.tsx");
  assert.match(telemetry, /\/v1\/world\/telemetry/);
  assert.match(telemetry, /Download synthetic CSV/);
  assert.match(telemetry, /PAGE_SIZE/);
  assert.match(telemetry, /Missing buckets/);
});

test("demo reset UI requires exact confirmation and calls guarded API", () => {
  const demo = read("../src/app/demo/page.tsx");
  assert.match(demo, /RESET demo-nexus/);
  assert.match(demo, /\/v1\/demo\/reset/);
  assert.match(demo, /allowedCandidate/);
});
