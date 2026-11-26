"use client";

import { getToken } from "firebase/app-check";
import type { EventSyncResponse, SyncEventBatch } from "@nexus-titan/contracts";
import { firebaseAppCheckClient, firebaseAuthClient } from "@/lib/firebase/client";
import { localDeviceId, signSyncBody } from "@/lib/identity/device-key";

export class IdentityApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "IdentityApiError";
  }
}

export async function identityApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { auth } = firebaseAuthClient();
  const user = auth.currentUser;
  if (!user) throw new IdentityApiError("Sign in is required.", 401, "AUTH_REQUIRED");
  const idToken = await user.getIdToken(); // Firebase refreshes an expired token automatically.
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${idToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (process.env.NEXT_PUBLIC_APPCHECK_EMULATOR_BYPASS !== "true") {
    const appCheckToken = await getToken(firebaseAppCheckClient(), false);
    headers.set("X-Firebase-AppCheck", appCheckToken.token);
  }
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
  const response = await fetch(new URL(path, base), { ...init, headers, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new IdentityApiError(body.error?.message ?? `Identity API failed with HTTP ${response.status}.`, response.status, body.error?.code);
  }
  return body as T;
}

export async function syncSignedEventBatch(organizationId: string, events: SyncEventBatch["events"]): Promise<EventSyncResponse> {
  const deviceList = await identityApi<{ devices: Array<{ device_id: string; client_device_id: string; status: string }> }>(
    `/v1/organizations/${encodeURIComponent(organizationId)}/devices`,
  );
  const device = deviceList.devices.find((item) => item.client_device_id === localDeviceId() && item.status === "registered");
  if (!device) throw new IdentityApiError("Register this browser as a trusted device before synchronizing events.", 403, "DEVICE_NOT_TRUSTED");
  const payload: SyncEventBatch = { tenant_id: organizationId, device_id: device.device_id, events };
  const body = JSON.stringify(payload);
  const signature = await signSyncBody(body);
  return identityApi<EventSyncResponse>("/sync/events", {
    method: "POST",
    headers: { "X-Nexus-Device-Signature": signature },
    body,
  });
}
