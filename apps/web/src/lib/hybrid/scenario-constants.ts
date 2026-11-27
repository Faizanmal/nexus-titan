/**
 * Unified Canonical Scenario Constants for Flagship Incident:
 * INC-TITAN-WTP01-P101-202611 (Pump P-101 at TITAN-WTP-01).
 * Single source of truth for telemetry, physical dial observations, and model config.
 */

export const FLAGSHIP_INCIDENT_ID = "INC-TITAN-WTP01-P101-202611";
export const FLAGSHIP_ASSET_ID = "P-101";
export const FLAGSHIP_FACILITY = "TITAN-WTP-01";
export const SYNTHETIC_CANARY_TOKEN = "SYNTHETIC-CANARY-001";

// SCADA Telemetry readings (transducer PT-101 loop in alarm state)
export const SCADA_TELEMETRY_PRESSURE_KPA = 185.0;
export const SCADA_TELEMETRY_VIBRATION_MMS = 8.42;
export const SCADA_TELEMETRY_FLOW_GPM = 285.0;
export const SCADA_TELEMETRY_CAVITATION_INDEX = 0.38;

// Field physical dial gauge readings (technician manual inspection)
export const PHYSICAL_DIAL_PRESSURE_NOMINAL_KPA = 410.0;
export const PHYSICAL_DIAL_PRESSURE_CONTRADICTION_KPA = 410.0;
export const PHYSICAL_DIAL_PRESSURE_AGREEING_KPA = 185.0;
export const PHYSICAL_CASING_TEMP_AMBIENT_C = 28.5;
export const PHYSICAL_VIBRATION_NOMINAL_MMS = 2.1;

// Configured model names
export const CONFIG_CLOUD_MODEL = "gemini-3.5-flash-lite";
export const CONFIG_NANO_MODEL_LABEL = "Gemini Nano (Chrome built-in)";
