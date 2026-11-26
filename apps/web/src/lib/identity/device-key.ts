"use client";

const DATABASE = "nexus-titan-device-keys";
const STORE = "keys";
const RECORD = "primary";
const ID_KEY = "nexus-device-id-v1";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadKeys(): Promise<CryptoKeyPair | undefined> {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(RECORD);
    request.onsuccess = () => resolve(request.result as CryptoKeyPair | undefined);
    request.onerror = () => reject(request.error);
  });
}

/** Returns nonextractable signing handles for authenticated in-origin protocols. */
export async function deviceSigningKeyPair(): Promise<CryptoKeyPair> {
  const keys = await loadKeys();
  if (!keys) throw new Error("Register this browser as a trusted device before signing peer messages.");
  return keys;
}

async function saveKeys(keys: CryptoKeyPair): Promise<void> {
  const database = await openStore();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(keys, RECORD);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function localDeviceId(): string {
  let value = localStorage.getItem(ID_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(ID_KEY, value);
  }
  return value;
}

export function rotateLocalDeviceId(): string {
  const value = crypto.randomUUID();
  localStorage.setItem(ID_KEY, value);
  return value;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

export async function createDeviceProof(challenge: string): Promise<{ deviceId: string; label: string; publicKeyPem: string; signatureBase64: string }> {
  let keys = await loadKeys();
  if (!keys) {
    keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    await saveKeys(keys);
  }
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, fromBase64Url(challenge)));
  const wrapped = toBase64(spki).match(/.{1,64}/g)?.join("\n") ?? "";
  return {
    deviceId: localDeviceId(),
    label: typeof navigator === "undefined" ? "Web device" : navigator.userAgent.slice(0, 120),
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`,
    signatureBase64: toBase64(signature),
  };
}

export async function signSyncBody(body: string): Promise<string> {
  const keys = await loadKeys();
  if (!keys) throw new Error("Register this browser as a trusted device before synchronizing events.");
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(body),
  ));
  return toBase64(signature);
}
