import type { DataClassification } from "@nexus-titan/contracts";
import { createShareArtifact, evaluatePrivacy, type ShareArtifact } from "./privacy-policy.ts";
import { getOffline, listOffline, putOffline } from "./offline.ts";

export const PEER_PROTOCOL_VERSION = 1 as const;
export const PEER_MAX_ENVELOPE_BYTES = 64 * 1024;
export const PEER_SESSION_TTL_MS = 5 * 60 * 1000;
export const PEER_ALLOWED_CAPABILITIES = ["public_observation", "annotation"] as const;
export type PeerCapability = typeof PEER_ALLOWED_CAPABILITIES[number];
export type PeerInvitation = {
  protocolVersion: 1; sessionId: string; tenantId: string; siteId: string; deviceId: string;
  issuedAt: number; expiresAt: number; nonce: string; ecdhPublicKey: string;
  capabilities: PeerCapability[]; maxEnvelopeBytes: number; signature: string;
};
export type PeerAcceptance = {
  protocolVersion: 1; sessionId: string; tenantId: string; siteId: string; deviceId: string;
  issuedAt: number; expiresAt: number; nonce: string; ecdhPublicKey: string;
  capabilities: PeerCapability[]; maxEnvelopeBytes: number; consent: true; signature: string;
};
export type PeerEnvelope = {
  protocolVersion: 1; sessionId: string; tenantId: string; siteId: string;
  senderDeviceId: string; recipientDeviceId: string; sequence: number; messageId: string;
  sentAt: number; expiresAt: number; classification: "public"; kind: "observation" | "annotation";
  iv: string; ciphertext: string; signature: string;
};
export type PeerSession = {
  sessionId: string; tenantId: string; siteId: string; localDeviceId: string; remoteDeviceId: string;
  expiresAt: number; sessionToken: string; capabilities: PeerCapability[]; maxEnvelopeBytes: number;
  sendKey: CryptoKey; receiveKey: CryptoKey; sendIvPrefix: Uint8Array; receiveIvPrefix: Uint8Array;
};
export type ApprovedPeerObservation = { artifact: ShareArtifact };
const approvedArtifacts = new WeakSet<object>();

const encoder = new TextEncoder();
const decoder = new TextDecoder();
type Bytes = Uint8Array<ArrayBuffer>;
const trustedPeerEnvelopes = new WeakSet<object>();
const verifiedPayloads = new WeakMap<object, PeerEnvelope>();
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(""));
const unb64 = (value: string): Bytes => {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function signingBytes<T extends { signature: string }>(value: T): Bytes {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _signature, ...unsigned } = value;
  return encoder.encode(canonical(unsigned));
}

export async function createEphemeralAgreementKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

export async function exportAgreementPublicKey(key: CryptoKey): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importAgreementPublicKey(encoded: string): Promise<CryptoKey> {
  if (encoded.length > 256) throw new Error("Peer agreement key is oversized.");
  return crypto.subtle.importKey("raw", unb64(encoded), { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export async function importRegisteredSigningKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  if (body.length > 8192) throw new Error("Registered key is oversized.");
  return crypto.subtle.importKey("spki", unb64(body), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function signPeerObject<T extends { signature: string }>(value: T, privateKey: CryptoKey): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, signingBytes(value))));
}

export async function verifyPeerObject<T extends { signature: string }>(value: T, key: CryptoKey): Promise<boolean> {
  try { return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(value.signature), signingBytes(value)); }
  catch { return false; }
}

export async function makePeerInvitation(input: {
  tenantId: string; siteId: string; deviceId: string; ecdh: CryptoKeyPair; signingKey: CryptoKey;
  now?: number; sessionId?: string; nonce?: string;
}): Promise<PeerInvitation> {
  const now = input.now ?? Date.now();
  const invitation: PeerInvitation = { protocolVersion: PEER_PROTOCOL_VERSION, sessionId: input.sessionId ?? crypto.randomUUID(),
    tenantId: input.tenantId, siteId: input.siteId, deviceId: input.deviceId, issuedAt: now, expiresAt: now + PEER_SESSION_TTL_MS,
    nonce: input.nonce ?? b64(crypto.getRandomValues(new Uint8Array(24))), ecdhPublicKey: await exportAgreementPublicKey(input.ecdh.publicKey),
    capabilities: [...PEER_ALLOWED_CAPABILITIES], maxEnvelopeBytes: PEER_MAX_ENVELOPE_BYTES, signature: "" };
  invitation.signature = await signPeerObject(invitation, input.signingKey);
  return invitation;
}

export async function acceptPeerInvitation(invitation: PeerInvitation, input: {
  tenantId: string; siteId: string; deviceId: string; consent: boolean; ecdh: CryptoKeyPair; signingKey: CryptoKey;
  expectedInvitationDevice: CryptoKey; now?: number; nonce?: string;
}): Promise<PeerAcceptance> {
  const now = input.now ?? Date.now();
  if (!input.consent) throw new Error("Explicit peer consent is required.");
  if (invitation.protocolVersion !== PEER_PROTOCOL_VERSION) throw new Error("Peer protocol downgrade or unsupported version.");
  if (invitation.tenantId !== input.tenantId || invitation.siteId !== input.siteId) throw new Error("Cross-tenant or cross-site peer pairing denied.");
  if (invitation.deviceId === input.deviceId) throw new Error("A device cannot pair with itself.");
  if (invitation.expiresAt <= now || invitation.expiresAt - invitation.issuedAt > PEER_SESSION_TTL_MS || invitation.issuedAt > now + 30_000) throw new Error("Peer invitation is expired or invalid.");
  if (invitation.maxEnvelopeBytes > PEER_MAX_ENVELOPE_BYTES || invitation.maxEnvelopeBytes < 1024) throw new Error("Peer invitation payload limit is invalid.");
  if (!(await verifyPeerObject(invitation, input.expectedInvitationDevice))) throw new Error("Peer invitation signature is invalid.");
  const acceptance: PeerAcceptance = { protocolVersion: PEER_PROTOCOL_VERSION, sessionId: invitation.sessionId,
    tenantId: input.tenantId, siteId: input.siteId, deviceId: input.deviceId, issuedAt: now,
    expiresAt: Math.min(invitation.expiresAt, now + PEER_SESSION_TTL_MS), nonce: input.nonce ?? b64(crypto.getRandomValues(new Uint8Array(24))),
    ecdhPublicKey: await exportAgreementPublicKey(input.ecdh.publicKey), capabilities: [...PEER_ALLOWED_CAPABILITIES],
    maxEnvelopeBytes: Math.min(invitation.maxEnvelopeBytes, PEER_MAX_ENVELOPE_BYTES), consent: true, signature: "" };
  acceptance.signature = await signPeerObject(acceptance, input.signingKey);
  return acceptance;
}

export async function derivePeerSession(input: {
  invitation: PeerInvitation; acceptance: PeerAcceptance; localDeviceId: string; ecdhPrivateKey: CryptoKey;
  expectedRemoteSigningKey: CryptoKey; now?: number;
}): Promise<PeerSession> {
  const { invitation, acceptance } = input;
  const now = input.now ?? Date.now();
  if (invitation.protocolVersion !== PEER_PROTOCOL_VERSION || acceptance.protocolVersion !== PEER_PROTOCOL_VERSION) throw new Error("Peer protocol downgrade or unsupported version.");
  if (invitation.sessionId !== acceptance.sessionId || invitation.tenantId !== acceptance.tenantId || invitation.siteId !== acceptance.siteId) throw new Error("Peer transcript mismatch.");
  if (acceptance.tenantId !== invitation.tenantId || acceptance.siteId !== invitation.siteId || acceptance.deviceId === invitation.deviceId) throw new Error("Peer acceptance scope is invalid.");
  if (![invitation.deviceId, acceptance.deviceId].includes(input.localDeviceId)) throw new Error("Local device is not a participant in the signed transcript.");
  if (!acceptance.consent || acceptance.expiresAt <= now || invitation.expiresAt <= now || acceptance.issuedAt < invitation.issuedAt || acceptance.expiresAt - acceptance.issuedAt > PEER_SESSION_TTL_MS || invitation.expiresAt - invitation.issuedAt > PEER_SESSION_TTL_MS || acceptance.issuedAt > now + 30_000 || invitation.issuedAt > now + 30_000) throw new Error("Peer session consent expired or has invalid lifetime.");
  const supported = (caps: PeerCapability[]) => Array.isArray(caps) && caps.length > 0 && new Set(caps).size === caps.length && caps.every((cap) => PEER_ALLOWED_CAPABILITIES.includes(cap));
  if (!supported(invitation.capabilities) || !supported(acceptance.capabilities) || invitation.maxEnvelopeBytes > PEER_MAX_ENVELOPE_BYTES || acceptance.maxEnvelopeBytes > PEER_MAX_ENVELOPE_BYTES || Math.min(invitation.maxEnvelopeBytes, acceptance.maxEnvelopeBytes) < 1024) throw new Error("Peer capabilities or envelope limit are invalid.");
  const negotiatedCapabilities = PEER_ALLOWED_CAPABILITIES.filter((cap) => invitation.capabilities.includes(cap) && acceptance.capabilities.includes(cap));
  if (!negotiatedCapabilities.length) throw new Error("No mutually supported peer capability.");
  const inviter = input.localDeviceId === invitation.deviceId;
  if (!(await verifyPeerObject(inviter ? acceptance : invitation, input.expectedRemoteSigningKey))) throw new Error("Peer handshake signature is invalid.");
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: await importAgreementPublicKey(input.localDeviceId === invitation.deviceId ? acceptance.ecdhPublicKey : invitation.ecdhPublicKey) }, input.ecdhPrivateKey, 256);
  const transcript = encoder.encode(canonical({ invitation, acceptance }));
  const salt = await crypto.subtle.digest("SHA-256", transcript);
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const deriveDirection = async (sender: string, receiver: string) => {
    const info = encoder.encode(`nexus-peer-v1:${invitation.tenantId}:${invitation.sessionId}:${sender}:${receiver}`);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, base, 288));
    return { key: await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]), prefix: bits.slice(32) };
  };
  const tokenBits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(`nexus-peer-session-token-v1:${invitation.tenantId}:${invitation.sessionId}`) }, base, 256);
  const invitationToAcceptance = await deriveDirection(invitation.deviceId, acceptance.deviceId);
  const acceptanceToInvitation = await deriveDirection(acceptance.deviceId, invitation.deviceId);
  const send = inviter ? invitationToAcceptance : acceptanceToInvitation;
  const receive = inviter ? acceptanceToInvitation : invitationToAcceptance;
  return { sessionId: invitation.sessionId, tenantId: invitation.tenantId, siteId: invitation.siteId,
    localDeviceId: input.localDeviceId, remoteDeviceId: inviter ? acceptance.deviceId : invitation.deviceId,
    expiresAt: Math.min(invitation.expiresAt, acceptance.expiresAt), sessionToken: b64(new Uint8Array(tokenBits)), capabilities: negotiatedCapabilities,
    maxEnvelopeBytes: Math.min(invitation.maxEnvelopeBytes, acceptance.maxEnvelopeBytes), sendKey: send.key, receiveKey: receive.key,
    sendIvPrefix: send.prefix, receiveIvPrefix: receive.prefix };
}

function nonce(prefix: Uint8Array, sequence: number): Bytes {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Peer sequence must be a positive safe integer.");
  const iv = new Uint8Array(12); iv.set(prefix.slice(0, 4));
  const view = new DataView(iv.buffer); view.setBigUint64(4, BigInt(sequence));
  return iv;
}

function validateSafePayload(payload: unknown): asserts payload is Record<string, unknown> {
  const value = JSON.stringify(payload);
  if (value.length > 48 * 1024) throw new Error("Peer observation exceeds its payload limit.");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Peer observations must be structured objects.");
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "text") || typeof record.text !== "string" || record.text.length > 16 * 1024) throw new Error("Peer payload must be a reviewed text observation or annotation only.");
  if (/(RESTRICTED_MARKER_|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:SN|SERIAL)\s*[:=#-])/i.test(value)) throw new Error("Peer observation contains an unresolved restricted marker or likely identifier.");
}

export function reviewPeerObservation(input: {
  tenantId: string; reason: string; text: string; consent: boolean; reviewed: boolean;
  role: string; deviceTrusted: boolean; tenantMatch: boolean;
  references: readonly { tenantId: string; classification?: unknown }[];
}): ApprovedPeerObservation {
  if (!input.reviewed) throw new Error("SHARE_REVIEW_REQUIRED");
  if (input.references.some((reference) => reference.classification !== "public")) throw new Error("PEER_CLASSIFICATION_DENIED");
  const decision = evaluatePrivacy({ role: input.role, purpose: "event_replication", destination: "peer", classification: "public",
    tenantMatch: input.tenantMatch && input.references.every((reference) => reference.tenantId === input.tenantId),
    deviceTrusted: input.deviceTrusted, consent: input.consent });
  if (!decision.allow) throw new Error(`PEER_POLICY_DENIED:${decision.reason}`);
  const artifact = createShareArtifact({ artifactId: crypto.randomUUID(), tenantId: input.tenantId, destination: "peer",
    reason: input.reason, references: input.references, text: input.text, consent: input.consent, reviewed: input.reviewed });
  const approved = Object.freeze({ artifact });
  approvedArtifacts.add(approved);
  return approved;
}

export async function sealPeerEnvelope(input: {
  session: PeerSession; sequence: number; kind: "observation" | "annotation"; approved: ApprovedPeerObservation;
  sign: (bytes: Bytes) => Promise<string>; verifyLocal: (bytes: Bytes, signature: string) => Promise<boolean>; now?: number; expiresMs?: number;
}): Promise<PeerEnvelope> {
  const { session } = input; const now = input.now ?? Date.now();
  const requiredCapability = input.kind === "observation" ? "public_observation" : "annotation";
  if (!session.capabilities.includes(requiredCapability)) throw new Error("Peer capability was not negotiated.");
  if (!approvedArtifacts.has(input.approved) || input.approved.artifact.tenantId !== session.tenantId || input.approved.artifact.destination !== "peer" || input.approved.artifact.classification !== "public") throw new Error("A reviewed, consented, sanitized, same-tenant peer artifact is required.");
  if (new TextDecoder().decode(input.approved.artifact.outgoingBytes) !== input.approved.artifact.previewText) throw new Error("Peer share artifact bytes changed after review.");
  const payload = { text: input.approved.artifact.previewText };
  validateSafePayload(payload);
  if (now >= session.expiresAt) throw new Error("Peer session expired.");
  const iv = nonce(session.sendIvPrefix, input.sequence);
  const metadata = { protocolVersion: PEER_PROTOCOL_VERSION, sessionId: session.sessionId, tenantId: session.tenantId, siteId: session.siteId,
    senderDeviceId: session.localDeviceId, recipientDeviceId: session.remoteDeviceId, sequence: input.sequence,
    messageId: crypto.randomUUID(), sentAt: now, expiresAt: Math.min(session.expiresAt, now + Math.min(input.expiresMs ?? 60_000, 60_000)),
    classification: "public" as const, kind: input.kind };
  const aad = encoder.encode(canonical(metadata));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, session.sendKey, encoder.encode(canonical(payload))));
  const envelope: PeerEnvelope = { ...metadata, iv: b64(iv), ciphertext: b64(ciphertext), signature: "" };
  const bytes = signingBytes(envelope);
  envelope.signature = await input.sign(bytes);
  if (!(await input.verifyLocal(bytes, envelope.signature))) throw new Error("Locally generated peer envelope signature did not verify.");
  if (encoder.encode(canonical(envelope)).length > session.maxEnvelopeBytes || encoder.encode(canonical(envelope)).length > PEER_MAX_ENVELOPE_BYTES) throw new Error("Peer envelope exceeds the negotiated size limit.");
  trustedPeerEnvelopes.add(envelope);
  return envelope;
}

export async function openPeerEnvelope(input: {
  envelope: PeerEnvelope; session: PeerSession; expectedSequence: number; verify: (bytes: Bytes, signature: string) => Promise<boolean>; now?: number;
}): Promise<Record<string, unknown>> {
  const { envelope, session } = input; const now = input.now ?? Date.now();
  if (encoder.encode(canonical(envelope)).length > Math.min(session.maxEnvelopeBytes, PEER_MAX_ENVELOPE_BYTES)) throw new Error("Peer envelope is oversized.");
  if (envelope.protocolVersion !== PEER_PROTOCOL_VERSION) throw new Error("Peer protocol downgrade or unsupported version.");
  if (envelope.sessionId !== session.sessionId || envelope.tenantId !== session.tenantId || envelope.siteId !== session.siteId || envelope.senderDeviceId !== session.remoteDeviceId || envelope.recipientDeviceId !== session.localDeviceId) throw new Error("Peer envelope scope is invalid.");
  if (envelope.classification !== "public" || !["observation", "annotation"].includes(envelope.kind)) throw new Error("Peer policy denied this data type.");
  if (envelope.expiresAt <= now || envelope.expiresAt > session.expiresAt || envelope.expiresAt <= envelope.sentAt || envelope.expiresAt - envelope.sentAt > 60_000 || envelope.sentAt > now + 30_000) throw new Error("Peer envelope expired or has an invalid timestamp.");
  if (envelope.sequence !== input.expectedSequence) throw new Error(envelope.sequence < input.expectedSequence ? "Peer envelope replay detected." : "Peer sequence gap detected; request resynchronization.");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _signature, iv: _iv, ciphertext: _ciphertext, ...metadata } = envelope;
  if (!(await input.verify(signingBytes(envelope), envelope.signature))) throw new Error("Peer envelope signature is invalid.");
  const expectedIv = nonce(session.receiveIvPrefix, envelope.sequence);
  const receivedIv = unb64(envelope.iv);
  if (receivedIv.length !== expectedIv.length || receivedIv.some((value, i) => value !== expectedIv[i])) throw new Error("Peer envelope nonce does not match the session sequence.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: receivedIv, additionalData: encoder.encode(canonical(metadata)), tagLength: 128 }, session.receiveKey, unb64(envelope.ciphertext));
  const payload = JSON.parse(decoder.decode(plaintext)) as unknown;
  validateSafePayload(payload);
  trustedPeerEnvelopes.add(envelope);
  if (payload && typeof payload === "object") verifiedPayloads.set(payload, envelope);
  return payload;
}

export class PeerReplayGuard {
  private lastSequence = 0;
  private readonly messageIds = new Set<string>();
  private readonly sessionId: string;
  private readonly tenantId: string;
  private readonly maxRemembered: number;
  constructor(sessionId: string, tenantId: string, maxRemembered = 512) {
    this.sessionId = sessionId; this.tenantId = tenantId; this.maxRemembered = maxRemembered;
  }
  nextSequence(): number { return this.lastSequence + 1; }
  commit(envelope: PeerEnvelope): void {
    if (!trustedPeerEnvelopes.has(envelope)) throw new Error("Peer envelope must be cryptographically verified before replay state advances.");
    if (envelope.sessionId !== this.sessionId || envelope.tenantId !== this.tenantId) throw new Error("Peer replay scope mismatch.");
    if (envelope.sequence !== this.lastSequence + 1) throw new Error("Peer sequence replay or gap detected.");
    if (this.messageIds.has(envelope.messageId)) throw new Error("Duplicate peer message ID.");
    this.lastSequence = envelope.sequence;
    this.messageIds.add(envelope.messageId);
    if (this.messageIds.size > this.maxRemembered) this.messageIds.delete(this.messageIds.values().next().value as string);
  }
}

export function createPeerConnection(iceServers: RTCIceServer[] = []): RTCPeerConnection {
  if (iceServers.length > 8) throw new Error("Peer ICE configuration has too many servers.");
  return new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 2 });
}

export function createPeerDataChannel(role: "offerer" | "answerer", iceServers: RTCIceServer[] = []): {
  connection: RTCPeerConnection; getChannel: () => RTCDataChannel | undefined; close: () => void;
} {
  const connection = createPeerConnection(iceServers);
  let channel: RTCDataChannel | undefined;
  if (role === "offerer") channel = connection.createDataChannel("nexus-peer-v1", { ordered: true });
  else connection.addEventListener("datachannel", (event) => { if (event.channel.label === "nexus-peer-v1") channel = event.channel; else event.channel.close(); });
  return { connection, getChannel: () => channel, close: () => { channel?.close(); connection.close(); } };
}

export class BoundedPeerTransferQueue {
  private readonly envelopes: PeerEnvelope[] = [];
  private readonly ids = new Set<string>();
  private readonly maxCount: number;
  private readonly maxBytes: number;
  constructor(maxCount = 20, maxBytes = 1024 * 1024) { this.maxCount = maxCount; this.maxBytes = maxBytes; }
  get size(): number { return this.envelopes.length; }
  enqueue(envelope: PeerEnvelope): boolean {
    if (!trustedPeerEnvelopes.has(envelope) || envelope.classification !== "public" || envelope.protocolVersion !== PEER_PROTOCOL_VERSION) throw new Error("Only cryptographically verified public peer envelopes may be queued.");
    if (this.ids.has(envelope.messageId)) return false;
    const nextSize = encoder.encode(canonical(envelope)).length;
    const totalSize = this.envelopes.reduce((sum, item) => sum + encoder.encode(canonical(item)).length, 0);
    if (nextSize > PEER_MAX_ENVELOPE_BYTES || this.envelopes.length >= this.maxCount || totalSize + nextSize > this.maxBytes) throw new Error("Peer transfer queue capacity exceeded.");
    this.envelopes.push(envelope); this.ids.add(envelope.messageId); return true;
  }
  take(): PeerEnvelope | undefined { return this.envelopes.shift(); }
  clear(): void { this.envelopes.length = 0; this.ids.clear(); }
}

export function sendPeerEnvelope(channel: RTCDataChannel, envelope: PeerEnvelope, maxBytes = PEER_MAX_ENVELOPE_BYTES): void {
  if (!trustedPeerEnvelopes.has(envelope)) throw new Error("Only cryptographically verified envelopes may be sent.");
  if (channel.readyState !== "open") throw new Error("Peer DataChannel is not open.");
  const body = canonical(envelope);
  const size = encoder.encode(body).length;
  if (size > Math.min(maxBytes, PEER_MAX_ENVELOPE_BYTES)) throw new Error("Peer DataChannel payload exceeds its negotiated bound.");
  if (channel.bufferedAmount + size > 256 * 1024) throw new Error("Peer DataChannel send buffer is full; retry after drain.");
  channel.send(body);
}

export async function persistPeerOutbox(envelope: PeerEnvelope, now = Date.now()): Promise<boolean> {
  if (!trustedPeerEnvelopes.has(envelope)) throw new Error("Only a signed, locally generated peer envelope can enter the peer outbox.");
  const current = await listOffline<{id: string; tenantId: string; envelope: PeerEnvelope}>("peer_outbox");
  if (current.some((item) => item.id === envelope.messageId)) return false;
  const encodedSize = encoder.encode(canonical(envelope)).length;
  const tenantItems = current.filter((item) => item.tenantId === envelope.tenantId);
  const totalBytes = current.reduce((sum, item) => sum + encoder.encode(canonical(item.envelope)).length, 0);
  const tenantBytes = tenantItems.reduce((sum, item) => sum + encoder.encode(canonical(item.envelope)).length, 0);
  if (current.length >= 50 || tenantItems.length >= 20 || totalBytes + encodedSize > 2 * 1024 * 1024 || tenantBytes + encodedSize > 1024 * 1024) throw new Error("Durable peer outbox capacity exceeded.");
  await putOffline("peer_outbox", { id: envelope.messageId, tenantId: envelope.tenantId, sessionId: envelope.sessionId,
    recipientDeviceId: envelope.recipientDeviceId, createdAt: now, envelope });
  await putOffline("peer_transfer_state", { id: `out:${envelope.messageId}`, tenantId: envelope.tenantId, messageId: envelope.messageId, direction: "out", state: "queued", updatedAt: now });
  return true;
}

export async function persistVerifiedPeerInbox(session: PeerSession, envelope: PeerEnvelope, payload: Record<string, unknown>, now = Date.now()): Promise<boolean> {
  if (!trustedPeerEnvelopes.has(envelope) || verifiedPayloads.get(payload) !== envelope || envelope.tenantId !== session.tenantId || envelope.sessionId !== session.sessionId || envelope.classification !== "public") throw new Error("Only a verified, same-session public observation can enter the provisional peer inbox.");
  validateSafePayload(payload);
  const current = await listOffline<{id: string; tenantId: string; envelope: PeerEnvelope}>("peer_inbox");
  const id = `${session.tenantId}:${session.sessionId}:${envelope.messageId}`;
  if (current.some((item) => item.id === id)) return false;
  const tenantCount = current.filter((item) => item.tenantId === session.tenantId).length;
  const currentBytes = current.reduce((sum, item) => sum + encoder.encode(canonical(item.envelope)).length, 0);
  const nextBytes = encoder.encode(canonical(envelope)).length + encoder.encode(canonical(payload)).length;
  if (current.length >= 200 || tenantCount >= 100 || currentBytes + nextBytes > 4 * 1024 * 1024) throw new Error("Durable peer inbox capacity exceeded.");
  await putOffline("peer_inbox", { id, tenantId: session.tenantId, siteId: session.siteId, sessionId: session.sessionId,
    senderDeviceId: session.remoteDeviceId, receivedAt: now, classification: "public", provisional: true,
    envelope, payload, signature: envelope.signature });
  await putOffline("peer_transfer_state", { id: `in:${envelope.messageId}`, tenantId: session.tenantId, messageId: envelope.messageId, direction: "in", state: "provisional", updatedAt: now });
  return true;
}

export async function markPeerTransferState(tenantId: string, messageId: string, direction: "in" | "out", state: "queued" | "sent" | "provisional" | "accepted" | "rejected"): Promise<void> {
  const id = `${direction === "in" ? "in" : "out"}:${messageId}`;
  const current = await getOffline<{id: string; tenantId: string}>("peer_transfer_state", id);
  if (!current || current.tenantId !== tenantId) throw new Error("Peer transfer state is outside the authorized tenant scope.");
  await putOffline("peer_transfer_state", { ...current, state, updatedAt: Date.now() });
}

export function meshCapabilityAdvertisement(input: { dataChannel: boolean; webrtc: boolean; localModel: boolean; link: "unknown" | "lan" | "wan" }): {
  protocolVersion: 1; capabilities: PeerCapability[]; localModel: boolean; webrtc: boolean; dataChannel: boolean; link: "unknown" | "lan" | "wan";
} {
  return { protocolVersion: PEER_PROTOCOL_VERSION, capabilities: [...PEER_ALLOWED_CAPABILITIES], ...input };
}

export function isPeerClassificationAllowed(classification: DataClassification): boolean { return classification === "public"; }
