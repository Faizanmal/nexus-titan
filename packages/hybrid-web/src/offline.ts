import type { DataClassification } from "@nexus-titan/contracts";

export const OFFLINE_DB = "nexus-offline-v1";
export const OFFLINE_DB_VERSION = 2;
export const OFFLINE_STORES = ["snapshots", "manuals", "outbox", "outbox_states", "inbox", "peer_inbox", "peer_outbox", "peer_transfer_state", "vault", "attempts"] as const;
export type OfflineStore = typeof OFFLINE_STORES[number];
export type OfflinePolicyLease = { tenantId: string; issuedAt: number; expiresAt: number; revoked: boolean; policyVersion: string };
export type DurableTask = { id: string; tenantId: string; state: "queued" | "running" | "retry_wait" | "acked" | "conflict" | "denied"; attempts: number; nextAttemptAt: number; safeEvent: unknown; createdAt: number };
type OutboxDeliveryState = { id: string; taskId: string; tenantId: string; state: DurableTask["state"]; attempts: number; nextAttemptAt: number; updatedAt: number };

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of OFFLINE_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
}

async function runStore<T>(store: OfflineStore, mode: IDBTransactionMode, operation: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = operation(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Offline storage operation failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Offline storage transaction aborted."));
    });
  } finally { db.close(); }
}

export async function putOffline(store: OfflineStore, value: { id: string; [key: string]: unknown }): Promise<IDBValidKey> {
  try { return await runStore(store, "readwrite", (s) => s.put(value)); }
  catch (error) {
    if (!(error instanceof DOMException) || !["QuotaExceededError", "UnknownError"].includes(error.name)) throw error;
    // Evict only rebuildable derived data; never silently evict the outbox, inbox, or vault.
    for (const disposable of ["attempts", "manuals", "snapshots"] as const) {
      const rows = await listOffline<{id: string}>(disposable);
      for (const row of rows) await runStore(disposable, "readwrite", (s) => s.delete(row.id));
    }
    return runStore(store, "readwrite", (s) => s.put(value));
  }
}
export const getOffline = <T>(store: OfflineStore, id: string) => runStore<T | undefined>(store, "readonly", (s) => s.get(id));
export const listOffline = <T>(store: OfflineStore) => runStore<T[]>(store, "readonly", (s) => s.getAll());
export async function clearTenantOffline(tenantId: string): Promise<number> {
  let pending = 0;
  for (const name of OFFLINE_STORES) {
    const entries = await listOffline<{id: string; tenantId?: string; state?: string; taskId?: string}>(name);
    const rows = entries.filter((row) => row.tenantId === tenantId);
    if (name === "outbox") for (const row of rows) {
      const state = await getOffline<OutboxDeliveryState>("outbox_states", `state:${row.id}`);
      if (state?.state !== "acked") pending += 1;
    }
    for (const row of rows) await runStore(name, "readwrite", (s) => s.delete(row.id));
  }
  return pending;
}

export async function clearAllOfflineRecords(): Promise<number> {
  const all: Array<{store: OfflineStore; row: {id: string; tenantId?: string; state?: string}}> = [];
  for (const store of OFFLINE_STORES) for (const row of await listOffline<{id: string; tenantId?: string; state?: string}>(store)) all.push({ store, row });
  let pending = 0;
  for (const {store, row} of all) if (store === "outbox") {
    const state = await getOffline<OutboxDeliveryState>("outbox_states", `state:${row.id}`);
    if (state?.state !== "acked") pending += 1;
  }
  for (const {store, row} of all) await runStore(store, "readwrite", (s) => s.delete(row.id));
  cachedKey = undefined;
  return pending;
}

let cachedKey: CryptoKey | undefined;
async function vaultKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto is unavailable in this context.");
  const stored = await getOffline<{id: string; key: CryptoKey}>("vault", "device-aes-key");
  if (stored?.key) { cachedKey = stored.key; return stored.key; }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await putOffline("vault", { id: "device-aes-key", key });
  cachedKey = key;
  return key;
}

export async function sealRestricted(tenantId: string, id: string, classification: DataClassification, value: unknown): Promise<void> {
  if (classification !== "restricted") throw new Error("The restricted vault accepts restricted records only.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${OFFLINE_DB}:${tenantId}:${id}:v1`);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, await vaultKey(), plaintext);
  await putOffline("vault", { id: `record:${tenantId}:${id}`, tenantId, classification, iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)), version: 1 });
}

export async function openRestricted<T>(tenantId: string, id: string): Promise<T | undefined> {
  const entry = await getOffline<{iv: number[]; ciphertext: number[]; version: number}>("vault", `record:${tenantId}:${id}`);
  if (!entry) return undefined;
  const aad = new TextEncoder().encode(`${OFFLINE_DB}:${tenantId}:${id}:v${entry.version}`);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(entry.iv), additionalData: aad, tagLength: 128 }, await vaultKey(), new Uint8Array(entry.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function enqueueSafeChange(task: DurableTask, classification: DataClassification): Promise<void> {
  if (classification === "confidential" || classification === "restricted") throw new Error("Confidential and restricted data cannot enter the synchronization outbox.");
  if (task.tenantId.length === 0) throw new Error("An authorized tenant scope is required.");
  if (await getOffline("outbox", task.id)) throw new Error("Outbox records are append-only; this id already exists.");
  await putOffline("outbox", task);
  await putOffline("outbox_states", { id: `state:${task.id}`, taskId: task.id, tenantId: task.tenantId, state: "queued", attempts: 0, nextAttemptAt: task.nextAttemptAt, updatedAt: Date.now() } satisfies OutboxDeliveryState);
}

export function offlineLeaseValid(lease: OfflinePolicyLease | null | undefined, now = Date.now()): boolean {
  return Boolean(lease && !lease.revoked && Number.isFinite(lease.expiresAt) && lease.expiresAt > now && lease.issuedAt <= now);
}

export function retryDelay(attempt: number, random = Math.random): number {
  const bounded = Math.max(0, Math.min(8, attempt));
  return Math.round(Math.min(5 * 60_000, 1_000 * 2 ** bounded) * (0.75 + random() * 0.5));
}

export async function recoverOfflineTasks(tenantId: string): Promise<void> {
  const rows = await listOffline<OutboxDeliveryState>("outbox_states");
  for (const row of rows) if (row.tenantId === tenantId && row.state === "running") await putOffline("outbox_states", { ...row, state: "queued", nextAttemptAt: Date.now(), updatedAt: Date.now() });
}

export async function runOfflineOutbox(tenantId: string, lease: OfflinePolicyLease | null | undefined, send: (task: DurableTask) => Promise<"accepted" | "duplicate" | "conflict" | "denied">, now = Date.now()): Promise<void> {
  if (!lease || lease.tenantId !== tenantId || !offlineLeaseValid(lease, now)) throw new Error("A current tenant-scoped offline policy lease is required before synchronization.");
  await recoverOfflineTasks(tenantId);
  const events = (await listOffline<DurableTask>("outbox")).filter((row) => row.tenantId === tenantId).sort((a, b) => a.createdAt - b.createdAt);
  const rows: Array<{event: DurableTask; state: OutboxDeliveryState}> = [];
  for (const event of events) {
    const state = await getOffline<OutboxDeliveryState>("outbox_states", `state:${event.id}`);
    const current = state ?? { id: `state:${event.id}`, taskId: event.id, tenantId, state: "queued" as const, attempts: 0, nextAttemptAt: event.nextAttemptAt, updatedAt: event.createdAt };
    if (["queued", "retry_wait"].includes(current.state) && current.nextAttemptAt <= now && rows.length < 10) rows.push({ event, state: current });
  }
  for (const {event, state} of rows) {
    const running = { ...state, state: "running" as const, updatedAt: Date.now() };
    await putOffline("outbox_states", running);
    try {
      const result = await send({ ...event, state: running.state, attempts: running.attempts, nextAttemptAt: running.nextAttemptAt });
      const state = result === "accepted" || result === "duplicate" ? "acked" : result;
      await putOffline("outbox_states", { ...running, state, updatedAt: Date.now() });
    } catch {
      const attempts = running.attempts + 1;
      await putOffline("outbox_states", { ...running, attempts, state: "retry_wait", nextAttemptAt: Date.now() + retryDelay(attempts), updatedAt: Date.now() });
    }
  }
}

export async function registerOfflineWorker(): Promise<void> {
  const localSecureOrigin = typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && (globalThis.isSecureContext || localSecureOrigin)) await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
}
