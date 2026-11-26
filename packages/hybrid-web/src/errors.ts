export type HybridErrorCode =
  | "PRIVACY_DENIED"
  | "CAPABILITY_UNAVAILABLE"
  | "FOREGROUND_REQUIRED"
  | "NETWORK_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "LEASE_EXPIRED"
  | "CANCELLED"
  | "SOURCE_MISMATCH"
  | "INVALID_RESPONSE"
  | "REMOTE_CONFIG_REJECTED"
  | "SDK_ERROR"
  | "RESULT_SUBMISSION_FAILED";

export class HybridRuntimeError extends Error {
  readonly code: HybridErrorCode;
  readonly retryable: boolean;
  constructor(code: HybridErrorCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "HybridRuntimeError";
  }
}

export function mapSdkError(error: unknown): HybridRuntimeError {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "Firebase AI Logic request failed.";
  if (code.includes("quota") || code.includes("resource-exhausted")) {
    return new HybridRuntimeError("QUOTA_EXCEEDED", "The configured provider quota is exhausted.", false);
  }
  if (code.includes("network") || code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return new HybridRuntimeError("NETWORK_UNAVAILABLE", "The inference provider is unavailable or offline.", true);
  }
  if (code.includes("api-not-enabled") || /not available in this environment/i.test(message)) {
    return new HybridRuntimeError("CAPABILITY_UNAVAILABLE", "The required device inference API is unavailable.");
  }
  return new HybridRuntimeError("SDK_ERROR", message, false);
}
