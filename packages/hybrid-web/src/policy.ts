import { HybridRuntimeError } from "./errors.ts";
import type { CapabilitySnapshot, DataClassification, HybridMode, InferenceSource, Modality } from "./types.ts";

export const MODE_MAPPING: Record<HybridMode, "PREFER_ON_DEVICE" | "ONLY_ON_DEVICE" | "PREFER_IN_CLOUD" | "ONLY_IN_CLOUD"> = {
  PREFER_ON_DEVICE: "PREFER_ON_DEVICE",
  ONLY_ON_DEVICE: "ONLY_ON_DEVICE",
  PREFER_IN_CLOUD: "PREFER_IN_CLOUD",
  ONLY_IN_CLOUD: "ONLY_IN_CLOUD",
};

const cloudMayReceive = (classification: DataClassification) => classification === "public";
const deviceMayReceive = (classification: DataClassification) => classification !== "restricted";
const canDeviceHandle = (modality: Modality) => modality === "text" || modality === "image/jpeg" || modality === "image/png";

export function checkRequestPolicy(input: {
  mode: HybridMode;
  classification: DataClassification;
  cloudApproved: boolean;
  capability: CapabilitySnapshot;
}): void {
  const { mode, classification, cloudApproved, capability } = input;
  const cloudPossible = mode !== "ONLY_ON_DEVICE";
  if (!canDeviceHandle(capability.modality)) {
    throw new HybridRuntimeError("CAPABILITY_UNAVAILABLE", "This runtime supports only text and JPEG/PNG image inputs.");
  }
  if (cloudPossible && (!cloudMayReceive(classification) || !cloudApproved)) {
    throw new HybridRuntimeError("PRIVACY_DENIED", "Cloud-capable modes require public input and explicit cloud approval.");
  }
  if (mode === "ONLY_ON_DEVICE" && !deviceMayReceive(classification)) {
    throw new HybridRuntimeError("PRIVACY_DENIED", "Restricted input is not allowed by the browser inference policy.");
  }
  if (mode === "ONLY_ON_DEVICE") {
    if (!capability.desktopChrome || !capability.promptApi || capability.modelState === "unavailable") {
      throw new HybridRuntimeError("CAPABILITY_UNAVAILABLE", "Chrome Prompt API or compatible device model is unavailable.");
    }
    if (!capability.foreground) throw new HybridRuntimeError("FOREGROUND_REQUIRED", "Device inference requires the active foreground page.");
  }
  if (mode !== "ONLY_IN_CLOUD" && !capability.online && capability.modelState !== "ready" && mode !== "ONLY_ON_DEVICE") {
    throw new HybridRuntimeError("NETWORK_UNAVAILABLE", "No ready local model is available while offline.");
  }
  if (mode === "ONLY_IN_CLOUD" && !capability.online) {
    throw new HybridRuntimeError("NETWORK_UNAVAILABLE", "Cloud-only inference requires a network connection.");
  }
}

export function mapSdkSource(source: unknown): InferenceSource {
  if (source === "ON_DEVICE" || source === "on_device") return "ON_DEVICE";
  if (source === "IN_CLOUD" || source === "in_cloud") return "IN_CLOUD";
  return "UNKNOWN";
}

export function verifyActualSource(mode: HybridMode, source: InferenceSource): void {
  if (mode === "ONLY_ON_DEVICE" && source !== "ON_DEVICE") {
    throw new HybridRuntimeError("SOURCE_MISMATCH", "The SDK did not confirm on-device inference for ONLY_ON_DEVICE.");
  }
  if (mode === "ONLY_IN_CLOUD" && source !== "IN_CLOUD") {
    throw new HybridRuntimeError("SOURCE_MISMATCH", "The SDK did not confirm cloud inference for ONLY_IN_CLOUD.");
  }
}
