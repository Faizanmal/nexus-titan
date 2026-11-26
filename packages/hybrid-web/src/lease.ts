import { HybridRuntimeError } from "./errors.ts";
import type { LeasedInferenceTask } from "./types.ts";

export function assertLeaseValid(task: Pick<LeasedInferenceTask, "lease_expires_at">, now = Date.now()): void {
  const expires = Date.parse(task.lease_expires_at);
  if (!Number.isFinite(expires) || expires <= now) {
    throw new HybridRuntimeError("LEASE_EXPIRED", "Task lease is missing, invalid, or expired.");
  }
}
