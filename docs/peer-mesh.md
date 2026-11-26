# Authenticated peer mesh — provisional v1 protocol

## Security boundary

Only registered devices in the same active organization can resolve one another's ECDSA P-256 public keys. The API returns a peer key only for an authenticated owner/admin/operator member and an active registered device whose owning member is also active and eligible for peer use. Private signing handles remain nonextractable in browser IndexedDB.

The browser protocol primitives in `packages/hybrid-web/src/peer-mesh.ts` use:

1. A five-minute invitation bound to tenant, site, registered device, protocol version, capabilities, and ECDH P-256 ephemeral public key. The invitation is signed by the registered device key.
2. Explicit recipient consent and a signed acceptance binding the same transcript and a second ECDH key. The receiver verifies the invitation against the public key fetched from the tenant-scoped device registry. Each side derives a directional AES-GCM key/nonce prefix and a short-lived transcript-bound session token with HKDF-SHA-256.
3. Bounded, signed envelopes with tenant/site/session/device binding, monotonically increasing sequence, expiry of at most 60 seconds, deterministic nonce derived from directional key prefix and sequence, and AES-GCM AAD over canonical metadata. Receivers verify signatures, scope, expiry, sequence, nonce, and payload before accepting.
4. Only reviewed, consented, same-tenant PUBLIC ShareArtifacts can be sealed. Payloads are observation/annotation text only. Restricted/confidential classifications, unreviewed bytes, incident actions, unexpected fields, likely identifiers, malformed signatures, and payloads over 64 KiB are rejected. DataChannel transport adds WebRTC's DTLS protection; application AES-GCM and ECDSA signatures remain required.

An accepted peer observation is provisional evidence. It is not a canonical event or incident action. It must be reviewed and submitted later through the existing authenticated device sync path; Phase 05 currently accepts only `source=device`. No peer path can approve or execute an incident action.

## Network and pairing limits

`createPeerDataChannel` provides offerer/answerer DataChannel primitives. Empty ICE server configuration is the default; host candidates support a same-LAN pre-paired scenario where local network policy permits. This build has no authenticated signaling service, TURN credentials, session revocation push, browser pairing UI, DataChannel-to-durable-queue wiring, or canonical resync flow. Any later signaling deployment must use authenticated short-lived signaling, operator-approved ICE/TURN endpoints and credentials, rate limits, expiry, tenant/site membership checks, and message size caps. Do not claim WAN connectivity or offline discovery from registry presence.

Device revocation prevents new public-key lookup and should stop future pairings. Already-derived peer keys live up to five minutes; without signaling/revocation push, revocation cannot instantly terminate a partitioned live connection. Native transports must use OS key custody and separately verify peer identity.

## Migration and contract impact

No shared wire contract version or SQL migration changed. Two authenticated identity API routes were added under `/v1/organizations/{organization_id}/devices`: active registered peer inventory and active peer public-key lookup. Existing privacy policy already defines `peer/event_replication`, PUBLIC ceiling and consent. Existing event sync remains unchanged. Update OpenAPI/API docs if the signaling or event-ingestion protocol is introduced.
