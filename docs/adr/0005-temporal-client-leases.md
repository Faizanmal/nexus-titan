# ADR-0005: Temporal workflows use fenced client leases

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
Long-running workflows need resumable ownership while workers can crash, pause, or be replaced.

## Decision
Lease acquisition is tenant-scoped and returns an opaque lease ID, holder, expiry, and monotonically increasing fencing generation. Clients heartbeat before expiry and release explicitly. Temporal workflow IDs include or reference tenant scope; only server-side workers may acquire leases.

## Consequences
Expired holders cannot commit after a newer generation acquires the lease. Lease state and workflow history must not be exposed cross-tenant. TTL, retry, and workflow semantics require confirmation from the missing master spec. No Temporal client is wired.
