export * from "./generated.ts";
import type { HealthStatus } from "./generated.ts";

export const healthStatus = (): HealthStatus => ({
  status: "ok",
  service: "nexus-titan-api",
});
