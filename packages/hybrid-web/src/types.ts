import type { AgentInvocation, AgentResult, DataClassification } from "@nexus-titan/contracts";
export type { DataClassification };

export type HybridMode = "PREFER_ON_DEVICE" | "ONLY_ON_DEVICE" | "PREFER_IN_CLOUD" | "ONLY_IN_CLOUD";
export type InferenceSource = "ON_DEVICE" | "IN_CLOUD" | "UNKNOWN" | "MOCK";
export type Modality = "text" | "image/jpeg" | "image/png" | "other";
export type ModelState = "unknown" | "unavailable" | "downloadable" | "downloading" | "ready";
export type QuotaState = "unknown" | "available" | "exhausted";

export interface CapabilitySnapshot {
  desktopChrome: boolean;
  promptApi: boolean;
  modelState: ModelState;
  modality: Modality;
  foreground: boolean;
  online: boolean;
  quota: QuotaState;
  checkedAt: string;
}

export interface RuntimeConfig {
  model: string;
  promptVersion: string;
  maxOutputTokens: number;
  cloudEnabled: boolean;
  source: "remote_config" | "safe_default";
}

export interface LeasedInferenceTask extends AgentInvocation {
  lease_id: string;
  lease_expires_at: string;
  incident_id?: string;
  input: {
    text: string;
    modality: Modality;
    template_id: string;
    cloud_approved: boolean;
    image_data_url?: string;
    allow_restricted_local?: boolean;
    incident_id?: string;
  };
}

export interface InferenceOutput extends AgentResult {
  output: { summary: string; caveats: string[] };
}

export interface HybridTrace {
  taskId: string;
  leaseId: string;
  mode: HybridMode;
  actualSource: InferenceSource;
  status: "queued" | "running" | "result_ready" | "submitting" | "retry_wait" | "submitted" | "cancelled" | "failed";
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  attempts: number;
  privacy: DataClassification;
  templateId: string;
  configSource?: RuntimeConfig["source"];
  errorCode?: string;
  repairCount?: number;
}
