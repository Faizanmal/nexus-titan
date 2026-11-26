import type { DataClassification } from "@nexus-titan/contracts";

export const PRIVACY_POLICY_VERSION = "nexus-privacy-v1" as const;
const order: readonly DataClassification[] = ["public", "internal", "confidential", "restricted"];
const rules = {
  local_inference: { purpose: "approved_task", ceiling: "restricted", roles: ["owner", "admin", "operator"], device: true },
  cloud_inference: { purpose: "approved_summary", ceiling: "public", roles: ["owner", "admin", "operator"], device: true, consent: true },
  upload: { purpose: "approved_artifact", ceiling: "internal", roles: ["owner", "admin", "operator"], device: true, consent: true, approval: true },
  telemetry: { purpose: "synthetic_telemetry", ceiling: "public", roles: ["owner", "admin", "operator", "service_worker"], device: true },
  sync: { purpose: "state_sync", ceiling: "internal", roles: ["owner", "admin", "operator"], device: true },
  peer: { purpose: "event_replication", ceiling: "public", roles: ["owner", "admin", "operator"], device: true, consent: true },
  rag_index: { purpose: "approved_retrieval", ceiling: "public", roles: ["owner", "admin", "operator"], device: true, approval: true },
  audit_metadata: { purpose: "privacy_audit", ceiling: "restricted", roles: ["owner", "admin", "operator", "viewer", "service_worker"], tenant: true, metadataOnly: true },
} as const;

export type PrivacyDestination = keyof typeof rules;
export type PrivacyDecision = { allow: boolean; reason: string; policyVersion: typeof PRIVACY_POLICY_VERSION; classification: DataClassification };

export function normalizeClassification(value: unknown): DataClassification {
  return order.includes(value as DataClassification) ? value as DataClassification : "restricted";
}

export function aggregateClassification(references: readonly { tenantId: string; classification?: unknown }[], tenantId: string): DataClassification {
  if (!references.length || references.some((ref) => ref.tenantId !== tenantId)) return "restricted";
  return references.reduce<DataClassification>((highest, ref) => {
    const normalized = normalizeClassification(ref.classification);
    return order.indexOf(normalized) > order.indexOf(highest) ? normalized : highest;
  }, "public");
}

export function evaluatePrivacy(input: {
  role: string; purpose: string; destination: string; classification?: unknown; tenantMatch: boolean;
  deviceTrusted?: boolean; consent?: boolean; approval?: boolean; metadataOnly?: boolean;
  remoteConfig?: { disabledDestinations?: readonly string[]; requestedCeiling?: unknown };
}): PrivacyDecision {
  const classification = normalizeClassification(input.classification);
  const deny = (reason: string): PrivacyDecision => ({ allow: false, reason, policyVersion: PRIVACY_POLICY_VERSION, classification });
  const rule = rules[input.destination as PrivacyDestination];
  if (!rule) return deny("DESTINATION_UNKNOWN");
  if (!input.tenantMatch) return deny("TENANT_SCOPE_VIOLATION");
  if (!rule.roles.includes(input.role as never)) return deny("ROLE_FORBIDDEN");
  if (input.purpose !== rule.purpose) return deny("PURPOSE_MISMATCH");
  if ("device" in rule && rule.device && input.deviceTrusted !== true) return deny("DEVICE_UNTRUSTED");
  if ("consent" in rule && rule.consent && input.consent !== true) return deny("CONSENT_REQUIRED");
  if ("approval" in rule && rule.approval && input.approval !== true) return deny("APPROVAL_REQUIRED");
  if ("metadataOnly" in rule && rule.metadataOnly && input.metadataOnly !== true) return deny("RAW_AUDIT_FORBIDDEN");
  if (input.remoteConfig?.disabledDestinations?.includes(input.destination)) return deny("DESTINATION_DISABLED");
  const policyCeiling = order.indexOf(rule.ceiling);
  // Remote Config may lower the immutable policy ceiling, never raise it.
  const requestedCeiling = input.remoteConfig?.requestedCeiling === undefined ? policyCeiling : order.indexOf(normalizeClassification(input.remoteConfig.requestedCeiling));
  if (requestedCeiling > policyCeiling) return deny("CLASSIFICATION_CEILING");
  const ceiling = Math.min(policyCeiling, requestedCeiling);
  if (order.indexOf(classification) > ceiling) return deny("CLASSIFICATION_CEILING");
  return { allow: true, reason: "ALLOW", policyVersion: PRIVACY_POLICY_VERSION, classification };
}

const redactions: readonly [RegExp, string][] = [
  [/RESTRICTED_MARKER_[A-Z0-9_-]+/gi, "[REDACTED]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]"],
  [/\b(?:SN|SERIAL)\s*[:=#-]\s*[A-Z0-9-]{4,}\b/gi, "[REDACTED]"],
  [/(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/g, "[REDACTED]"],
];

export interface ShareArtifact {
  artifactId: string;
  tenantId: string;
  destination: PrivacyDestination;
  reason: string;
  consent: boolean;
  policyVersion: typeof PRIVACY_POLICY_VERSION;
  classification: "public";
  previewText: string;
  outgoingBytes: Uint8Array;
  redacted: boolean;
}

export function createShareArtifact(input: {
  artifactId: string; tenantId: string; destination: PrivacyDestination; reason: string;
  references: readonly { tenantId: string; classification?: unknown }[]; text: string; consent: boolean; reviewed: boolean;
}): ShareArtifact {
  if (input.references.length === 0 || input.references.some((ref) => ref.tenantId !== input.tenantId || normalizeClassification(ref.classification) === "restricted")) {
    throw new Error("SHARE_SOURCE_DENIED");
  }
  if (!input.consent || !input.reason.trim()) throw new Error("SHARE_CONSENT_REQUIRED");
  let preview = input.text;
  for (const [pattern, replacement] of redactions) preview = preview.replace(pattern, replacement);
  if (/REDACTION_UNCERTAIN|RESTRICTED_MARKER_|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:SN|SERIAL)\s*[:=#-]/i.test(preview)) throw new Error("SHARE_REDACTION_UNCERTAIN");
  const requiresReview = preview !== input.text || input.references.some((ref) => normalizeClassification(ref.classification) !== "public");
  if (requiresReview && !input.reviewed) throw new Error("SHARE_REVIEW_REQUIRED");
  return { artifactId: input.artifactId, tenantId: input.tenantId, destination: input.destination, reason: input.reason,
    consent: input.consent, policyVersion: PRIVACY_POLICY_VERSION, classification: "public", previewText: preview,
    outgoingBytes: new TextEncoder().encode(preview), redacted: preview !== input.text };
}

export async function dispatchShareArtifact(
  artifact: ShareArtifact,
  authorization: { role: string; purpose: string; tenantMatch: boolean; deviceTrusted: boolean; consent: boolean; approval: boolean },
  sink: (destination: PrivacyDestination, bytes: Uint8Array) => Promise<void>,
): Promise<PrivacyDecision> {
  if (artifact.policyVersion !== PRIVACY_POLICY_VERSION || new TextDecoder().decode(artifact.outgoingBytes) !== artifact.previewText) {
    return { allow: false, reason: "ARTIFACT_BYTES_CHANGED", policyVersion: PRIVACY_POLICY_VERSION, classification: "restricted" };
  }
  const decision = evaluatePrivacy({ ...authorization, destination: artifact.destination, classification: artifact.classification });
  if (!decision.allow) return decision;
  await sink(artifact.destination, artifact.outgoingBytes.slice());
  return decision;
}

export async function approvalDigest(value: unknown): Promise<string> {
  const canonical = canonicalJson(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Approval payload contains a non-finite number.");
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Approval payload is not JSON serializable.");
  return serialized;
}
