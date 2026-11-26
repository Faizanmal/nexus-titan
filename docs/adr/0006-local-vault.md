# ADR-0006: Device secrets stay in the local OS vault

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
The architecture includes mobile/device clients and authenticated access to external services.

## Decision
If a client must persist refresh material, use the platform secure store (Android Keystore-backed encrypted storage, Apple Keychain, or the relevant desktop vault). Do not store raw secrets in app preferences, logs, analytics, or the API database.

## Consequences
Credential lifecycle and recovery are device-specific. Native apps are not present; no vault code or secret is included in this repository. Token format and rotation policy remain subject to official requirements.
