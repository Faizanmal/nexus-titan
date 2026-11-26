"""Typed application ports. Adapters own persistence and external side effects."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any, Protocol

from .generated_contracts import (
    AgentInvocation,
    AgentResult,
    DataClassification,
    Event,
    EventBatch,
    PolicyDecision,
    RiskTier,
    SimulationRequest,
    SimulationResult,
)


class EventStore(Protocol):
    async def append(self, batch: EventBatch) -> list[Event]: ...
    async def read(
        self, tenant_id: str, after_sequence: int, limit: int
    ) -> list[Event]: ...


class Projection(Protocol):
    async def apply(self, event: Event) -> None: ...
    async def get(
        self, tenant_id: str, projection_id: str
    ) -> Mapping[str, Any] | None: ...


class PolicyContext(Protocol):
    tenant_id: str
    subject_id: str
    action: str
    resource_classification: DataClassification
    risk_tier: RiskTier


class PolicyEngine(Protocol):
    async def evaluate(self, context: PolicyContext) -> PolicyDecision: ...


class InferenceAdapter(Protocol):
    async def infer(self, invocation: AgentInvocation) -> AgentResult: ...


class AgentExecutor(Protocol):
    async def execute(self, invocation: AgentInvocation) -> AgentResult: ...


class SimulationSolver(Protocol):
    async def solve(self, request: SimulationRequest) -> SimulationResult: ...


class PeerTransport(Protocol):
    async def publish(self, tenant_id: str, batch: EventBatch) -> str: ...
    async def receive(
        self, tenant_id: str, cursor: str | None
    ) -> EventBatch | None: ...


class WorkflowLease(Protocol):
    lease_id: str
    tenant_id: str
    workflow_id: str
    holder_id: str
    fencing_generation: int
    expires_at: datetime


class WorkflowLeaseClient(Protocol):
    async def acquire(
        self, tenant_id: str, workflow_id: str, holder_id: str, ttl_seconds: int
    ) -> WorkflowLease | None: ...
    async def heartbeat(
        self, lease: WorkflowLease, ttl_seconds: int
    ) -> WorkflowLease: ...
    async def release(self, lease: WorkflowLease) -> None: ...
