/** Isolated component-catalog specimens. These are never used as operational data. */
export const DESIGN_FIXTURES = {
  metrics: [
    { label: "Pump discharge", value: "452.8", unit: "kPa", stale: false, source: "visual specimen" },
    { label: "Flow snapshot", value: "38.4", unit: "m³/h", stale: true, source: "visual specimen" },
  ],
  timeline: [
    { at: "09:42:16Z", title: "Sample event · specimen", detail: "Fixture only; not an incident record.", tone: "info" as const },
    { at: "09:38:02Z", title: "Warning state · specimen", detail: "Text label remains visible without color.", tone: "warning" as const },
  ],
  table: [
    { signal: "pressure", reading: "452.8", unit: "kPa", state: "Current · specimen" },
    { signal: "flow", reading: "38.4", unit: "m³/h", state: "Stale · specimen" },
  ],
  graphLegend: [
    { label: "Asset", description: "Synthetic fixture node", tone: "info" as const },
    { label: "Fault", description: "Requires a textual status too", tone: "fault" as const },
    { label: "Unverified", description: "Provisional relationship", tone: "warning" as const },
  ],
} as const;
