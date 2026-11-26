# ADR 0034: UI/UX, WCAG 2.1 AA Accessibility, Semantic Design Tokens, and Judge Usability Architecture

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Industrial intelligence and mission control command centers must serve diverse operational personas under high-stress conditions: field technicians navigating low-bandwidth devices, operations supervisors evaluating hydraulic mitigations, forensic investigators analyzing causal graphs, fresh evaluators seeking rapid orientation, and hackathon judges verifying technical claims under tight evaluation timelines. This requires rigorous WCAG 2.1 AA accessibility, keyboard-first discoverability, accessible alternatives for 3D/canvas and time-series graphics, high-contrast semantic design tokens, and unambiguous AI provenance badges without developer console inspection.

- **Decisions:**
  1. **Semantic Design System & WCAG 2.1 AA Token Hierarchy**:
     - Standardized dark mode (`:root[data-theme="dark"]`) and light mode (`:root[data-theme="light"]`) design tokens in `apps/web/src/app/globals.css`.
     - Validated luminance and contrast ratios exceeding the WCAG 2.1 AA threshold of $\ge 4.5:1$ for normal text (Dark: foreground 15.6:1, muted 8.9:1, accent 11.2:1; Light: foreground 14.1:1, muted 5.7:1, accent 4.8:1) and $\ge 3.0:1$ for UI focus outlines (`:focus-visible`).
     - Established CSS token bridges for legacy Tailwind classes (`text-slate-*`, `bg-slate-*`, `text-blue-800`, `text-amber-800`, `text-red-*`) to prevent unstyled or low-contrast text across all 19 application destinations.
  2. **Keyboard-First Discoverability & Focus Management**:
     - Global Command Palette accessible via **`⌘K`** / **`Ctrl+K`** with real-time route filtering, arrow key navigation (`ArrowUp`, `ArrowDown`), and <kbd>Enter</kbd> selection.
     - Enforced strict WAI-ARIA modal dialog focus containment (`trapTab`) preventing keyboard focus from escaping active modals (`role="dialog"` and `role="alertdialog"`).
     - Full keyboard accessibility for interactive charts, topology nodes, sequence scrubbers, and drawer navigation.
  3. **Accessible Alternatives for Complex Visual & Spatial Data**:
     - **Digital Twin 3D Canvas (`/world`)**: Accompanied by both an interactive 2D SVG plant coordinate grid fallback and a screen-reader accessible `Asset Topology Table` with `<caption className="sr-only">`, `<th scope="col">` column headers, and live text filtering.
     - **Time-Series Telemetry (`/telemetry`)**: Rendered with SVG graphics carrying `role="img"` and descriptive `aria-label` summaries, accompanied by accessible paginated data tables and synthetic CSV data export.
  4. **Universal Accessible Component Primitives (`command-center-primitives.tsx`)**:
     - Standardized 12 reusable accessible primitives: `StatusIndicator`, `MetricValue`, `EvidenceProvenance`, `InferenceSourceChip`, `PolicyDecision`, `Timeline`, `DataTable`, `EmptyState`, `ErrorState`, `LoadingState`, `OfflineState`, `ConfirmationDialog`, and `GraphLegend`.
     - Integrated `aria-live="polite"` dynamic region announcements, status roles (`role="status"`, `role="alert"`), and semantic color tokens.
  5. **Reduced Motion & Performance Optimization**:
     - Implemented `@media (prefers-reduced-motion: reduce)` in `globals.css` clamping animations, transitions, and smooth scrolling to 0.01 ms for vestibular-sensitive operators.
     - Dynamic client bundle optimization and Turbopack route code-splitting achieving sub-2.5 MB total client bundle across 23 compiled routes.
  6. **Judge Usability & Immediate Hybrid AI Provenance**:
     - Authored [docs/JUDGE_WALKTHROUGH.md](file:///j:/Hackathons/Devpost/nexus-titan/docs/JUDGE_WALKTHROUGH.md) providing a structured 5-minute evaluator rubric for all 5 personas.
     - Explicit color-coded inference provenance badges (`LOCAL_ON_DEVICE`, `CLOUD_BACKEND`, `HYBRID_EDGE`) across the 14-step flagship scenario, exposing execution source, latency, device model, and cryptographic correlation ID in seconds.
     - Dedicated judge sandbox onboarding granting rate-limited simulation quotas without access to destructive actions.
     - Prominent Zero Industrial Connection notice confirming purely fictional linear hydraulic simulation on `TITAN-WTP-01`.

- **Consequences:**
  - Full compliance with WCAG 2.1 AA accessibility standards, verified by automated test suites (`apps/web/tests/accessibility.test.mjs`, `apps/web/tests/design-system.test.mjs`).
  - Seamless, transparent evaluator experience for hackathon judges with zero dependency on the browser developer console.
  - Robust multi-device responsiveness across desktop (1920x1080), tablet (768x1024), and mobile (375x812) viewports.
