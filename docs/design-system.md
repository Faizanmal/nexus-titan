# NEXUS TITAN command-center design system

## Shell and navigation

All routes share `CommandCenterShell`: fixed desktop navigation, mobile horizontal route rail, breadcrumb, current organization/site selectors, API-backed incident drawer, identity/offline status, and dark/light toggle. The selected tenant/site is a client convenience only. Tenant-scoped API authorization remains authoritative. The viewer role is visible in the selector and viewer-visible write areas are labeled/read-only.

The route palette opens with Ctrl+K (Windows/Linux) or ⌘K (macOS), filters all shipped app routes, supports ArrowUp/ArrowDown and Enter, and closes with Escape. The notification drawer reads unresolved incidents from `/v1/world/incidents`; it does not synthesize alerts.

## Tokens

| Token role | Dark | Light |
|---|---|---|
| Background | `#0b1216` | `#f1f5f5` |
| Main surface | `#111c22` | `#ffffff` |
| Raised surface | `#17242b` | `#e9eff0` |
| Text | `#e5eef1` | `#122229` |
| Muted text | `#adbdc5` | `#435861` |
| Accent | `#56d9c3` | `#087f74` |
| Online / warning / fault / info | `#5dde9b` / `#f0c46c` / `#ff8f88` / `#82b8ff` | `#08783e` / `#835500` / `#a22925` / `#164f9d` |

Primary foreground, muted text and accent combinations are checked for at least 4.5:1 contrast against the corresponding primary surface by the static design test. This does not replace browser-based checks across all route combinations.

## Component inventory

Open `/design-system` for status indicator, metric with units/staleness, evidence provenance, inference-source chip, policy decision, timeline, accessible table, empty/error/loading/offline states, confirmation dialog and graph legend. Values on the inventory page are isolated under `src/components/demo/design-fixtures.ts` and explicitly marked as specimens.

The existing telemetry chart continues to provide a sample table alternative. State labels remain textual; color is only supplemental. Focus outlines are visible, dialog focus is contained, and reduced-motion preferences suppress transitions/animation.

## Responsive coverage intent

CSS layout breakpoints target wide desktop, 1024px tablet, and 390px mobile widths. Mobile hides the fixed rail, exposes a horizontally scrollable navigation strip and stacks workspace selectors. The required screenshots at 1440×900, 1024×768 and 390×844 were not generated because the Next runtime and Playwright package/browser were unavailable; no screenshot acceptance is claimed. See `docs/evidence/phase-16.md`.
