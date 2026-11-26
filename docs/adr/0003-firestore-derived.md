# ADR-0003: Firestore contains derived projections only

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
The phase names Firebase as an external trust boundary and asks that Firestore be derived.

## Decision
Firestore is a tenant-scoped read projection rebuilt from canonical Postgres events. Clients cannot write canonical records through Firestore. Projection updates carry source event IDs and schema versions.

## Consequences
Projection lag is observable and can be repaired by replay. Firebase identity does not itself authorize access to a tenant projection. No Firebase project/credentials or production deployment is configured.
