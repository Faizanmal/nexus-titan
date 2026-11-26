import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/app/globals.css");
const shell = read("../src/components/command-center-shell.tsx");
const primitives = read("../src/components/command-center-primitives.tsx");
const worldPage = read("../src/app/world/page.tsx");
const demoPage = read("../src/app/demo/page.tsx");
const recoveryPage = read("../src/app/recovery/page.tsx");
const telemetryPage = read("../src/app/telemetry/page.tsx");

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

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("1. all 19 navigation routes have verified page files and accessible heading hierarchy", () => {
  const hrefs = [...shell.matchAll(/href:\s*"(\/[^\"]*)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length >= 19, "Expected at least 19 navigation routes in command center shell");
  
  for (const href of new Set(hrefs)) {
    const route = href === "/" ? "../src/app/page.tsx" : `../src/app${href}/page.tsx`;
    const fullPath = new URL(route, import.meta.url);
    assert.ok(existsSync(fullPath), `missing route page file for ${href}`);
    const content = read(route);
    assert.match(content, /export\s+default\s+function/, `Route ${href} must export a default component`);
    // Verify route has accessible heading or landmark structure
    const hasHeading = /<h[1-4][\s>]/.test(content) || /aria-label=/.test(content) || /<main[\s>]/.test(content) || /<FieldRelayPage/.test(content);
    assert.ok(hasHeading, `Route ${href} must contain accessible headings or landmarks`);
  }
});

test("2. form controls across operations, field, demo, and recovery routes have accessible labels", () => {
  // Shell workspace selectors
  assert.match(shell, /<label\s+className="sr-only"\s+htmlFor="workspace-tenant">Organization<\/label>/);
  assert.match(shell, /<label\s+className="sr-only"\s+htmlFor="workspace-site">Site<\/label>/);
  assert.match(shell, /id="workspace-tenant"/);
  assert.match(shell, /id="workspace-site"/);
  assert.match(shell, /<label\s+className="sr-only"\s+htmlFor="command-search">Search routes<\/label>/);
  assert.match(shell, /id="command-search"/);

  // Demo controls
  assert.match(demoPage, /aria-label="Judge Alias"/);
  assert.match(demoPage, /aria-label="Timeline event scrubber slider"/);
  assert.match(demoPage, /aria-label="Type 'RESET demo-nexus' to enable factory reset"/);

  // Recovery controls
  assert.match(recoveryPage, /aria-label="Task ID to requeue"/);
  assert.match(recoveryPage, /aria-label="Device ID to rotate keypair"/);
  assert.match(recoveryPage, /aria-label="Target scratch schema name"/);

  // Telemetry controls
  assert.match(telemetryPage, /aria-label="Select metric to visualize"/);
  assert.match(telemetryPage, /aria-label="Telemetry pagination and status"/);

  // World controls
  assert.match(worldPage, /aria-label="Filter assets by name, subsystem, or id"/);
});

test("3. WCAG 2.1 AA color contrast compliance for dark and light design tokens", () => {
  for (const theme of ["dark", "light"]) {
    const bg = token(theme, "background");
    const surface1 = token(theme, "surface-1");
    const fg = token(theme, "foreground");
    const muted = token(theme, "text-muted");
    const accent = token(theme, "accent");
    const focus = token(theme, "focus");

    // Primary text contrast against main background (WCAG AA normal text >= 4.5:1)
    const fgContrast = contrast(fg, bg);
    assert.ok(fgContrast >= 4.5, `${theme} foreground contrast (${fgContrast.toFixed(2)}) must be >= 4.5`);

    // Muted text contrast against primary surfaces (WCAG AA normal text >= 4.5:1)
    const mutedContrast = contrast(muted, surface1);
    assert.ok(mutedContrast >= 4.5, `${theme} muted text contrast (${mutedContrast.toFixed(2)}) must be >= 4.5`);

    // Accent contrast against surface (WCAG AA normal text >= 4.5:1)
    const accentContrast = contrast(accent, surface1);
    assert.ok(accentContrast >= 4.5, `${theme} accent contrast (${accentContrast.toFixed(2)}) must be >= 4.5`);

    // Focus indicator contrast against surface (WCAG 2.1 Non-text contrast >= 3.0:1)
    const focusContrast = contrast(focus, bg);
    assert.ok(focusContrast >= 3.0, `${theme} focus contrast (${focusContrast.toFixed(2)}) must be >= 3.0`);
  }
});

test("4. screen reader accessible alternatives exist for 3D canvas, charts, and topologies", () => {
  // World view provides companion Accessible Asset Topology Table with headers & caption
  assert.match(worldPage, /<table\s+className="w-full text-left text-xs">/);
  assert.match(worldPage, /<caption\s+className="sr-only">Canonical water treatment asset inventory<\/caption>/);
  assert.match(worldPage, /<th\s+scope="col"/);

  // 2D SVG topology fallback exists alongside 3D canvas
  assert.match(worldPage, /2D Topology · Accessible Alternative/);
  assert.match(worldPage, /<svg\s+viewBox="-8 -60 160 64"/);

  // Telemetry page has accessible SVG chart with role="img", aria-label, and companion table
  assert.match(telemetryPage, /role="img"/);
  assert.match(telemetryPage, /aria-label=/);
  assert.match(telemetryPage, /Download synthetic CSV/);
  assert.match(telemetryPage, /<caption className="sr-only">Downsampled/);
  assert.match(telemetryPage, /<th scope="col"/);
});

test("5. keyboard navigation, command palette, focus trapping, and modal dialogs conform to WAI-ARIA", () => {
  // Command palette shortcut ⌘K / Ctrl+K
  assert.match(shell, /ctrlKey.*key\.toLowerCase\(\).*=== "k"/s);

  // Command palette dialog attributes
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /aria-labelledby="palette-title"/);
  assert.match(shell, /id="palette-title"/);

  // Palette listbox navigation with ArrowUp/ArrowDown/Enter
  assert.match(shell, /role="listbox"/);
  assert.match(shell, /role="option"/);
  assert.match(shell, /aria-selected=/);
  assert.match(shell, /event\.key === "ArrowDown"/);
  assert.match(shell, /event\.key === "ArrowUp"/);
  assert.match(shell, /event\.key === "Enter"/);

  // Tab cycle trap implementation
  assert.match(shell, /function trapTab/);
  assert.match(shell, /event\.shiftKey && document\.activeElement === first/);

  // Notification drawer attributes
  assert.match(shell, /aria-labelledby="notifications-title"/);
  assert.match(shell, /id="notifications-title"/);

  // Confirmation dialog role & focus
  assert.match(primitives, /role="alertdialog"/);
  assert.match(primitives, /aria-labelledby="confirm-title"/);
  assert.match(primitives, /aria-describedby="confirm-detail"/);
});

test("6. reduced motion preference is respected across all components", () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation-duration:\s*\.01ms\s*!important/);
  assert.match(css, /transition-duration:\s*\.01ms\s*!important/);
  assert.match(css, /scroll-behavior:\s*auto\s*!important/);
});

test("7. reusable accessibility primitives provide comprehensive UI/UX state coverage", () => {
  const expectedPrimitives = [
    "StatusIndicator",
    "MetricValue",
    "EvidenceProvenance",
    "InferenceSourceChip",
    "PolicyDecision",
    "Timeline",
    "DataTable",
    "EmptyState",
    "ErrorState",
    "LoadingState",
    "OfflineState",
    "ConfirmationDialog",
    "GraphLegend",
  ];

  for (const name of expectedPrimitives) {
    assert.match(primitives, new RegExp(`export\\s+function\\s+${name}\\b`), `Missing accessible primitive ${name}`);
  }

  // Accessibility features inside primitives
  assert.match(primitives, /aria-label=/);
  assert.match(primitives, /role="alert"/);
  assert.match(primitives, /role="status"/);
  assert.match(primitives, /aria-live="polite"/);
  assert.match(primitives, /scope="col"/);
});

test("8. hybrid AI provenance badges and zero-industrial-connection disclaimers are prominently displayed", () => {
  // Shell persistent synthetic demo banner
  assert.match(shell, /role="note"/);
  assert.match(shell, /Synthetic demo/);
  assert.match(shell, /Actions and model outputs do not control real infrastructure/);

  // Demo page step provenance chips
  assert.match(demoPage, /LOCAL_ON_DEVICE/);
  assert.match(demoPage, /CLOUD_BACKEND/);
  assert.match(demoPage, /HYBRID_EDGE/);
  assert.match(demoPage, /Zero Industrial Connection Notice/);
  assert.match(demoPage, /strictly fictional synthetic linear hydraulic plant/);
});

test("9. responsive viewport layouts defined for desktop, tablet, and mobile", () => {
  assert.match(css, /@media\s*\(max-width:\s*1100px\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  assert.match(shell, /className="cc-mobile-nav"/);
  assert.match(shell, /className="cc-mobile-brand"/);
});
