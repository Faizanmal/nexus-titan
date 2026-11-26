import type {
  AgentInvocation,
  AgentResult,
  DataClassification,
  Event,
  EventBatch,
  PolicyDecision,
  SimulationRequest,
  SimulationResult,
  RiskTier,
  WorldAssetPage,
  WorldTopology,
  WorldIncidentPage,
  WorldSnapshot,
} from "./generated.ts";

export interface EventStore {
  append(batch: EventBatch): Promise<readonly Event[]>;
  read(tenantId: string, afterSequence: number, limit: number): Promise<readonly Event[]>;
}

export interface Projection {
  apply(event: Event): Promise<void>;
  get(tenantId: string, projectionId: string): Promise<Readonly<Record<string, unknown>> | undefined>;
}

export interface PolicyContext {
  tenantId: string;
  subjectId: string;
  action: string;
  resourceClassification: DataClassification;
  riskTier: RiskTier;
}

export interface PolicyEngine {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
}

export interface InferenceAdapter {
  infer(invocation: AgentInvocation): Promise<AgentResult>;
}

export interface AgentExecutor {
  execute(invocation: AgentInvocation): Promise<AgentResult>;
}

export interface SimulationSolver {
  solve(request: SimulationRequest): Promise<SimulationResult>;
}

export interface PeerTransport {
  publish(tenantId: string, batch: EventBatch): Promise<string>;
  receive(tenantId: string, cursor?: string): Promise<EventBatch | undefined>;
}

export interface WorkflowLease {
  leaseId: string;
  tenantId: string;
  workflowId: string;
  holderId: string;
  fencingGeneration: number;
  expiresAt: string;
}

export interface WorkflowLeaseClient {
  acquire(tenantId: string, workflowId: string, holderId: string, ttlSeconds: number): Promise<WorkflowLease | undefined>;
  heartbeat(lease: WorkflowLease, ttlSeconds: number): Promise<WorkflowLease>;
  release(lease: WorkflowLease): Promise<void>;
}

export interface WorldOntologyReader {
  listAssets(tenantId: string, siteId: string): Promise<WorldAssetPage>;
  readTopology(tenantId: string, siteId: string): Promise<WorldTopology>;
  listIncidents(tenantId: string, siteId: string): Promise<WorldIncidentPage>;
  readSnapshot(tenantId: string, siteId: string): Promise<WorldSnapshot>;
}

export interface WorldGraphProjection {
  rebuild(tenantId: string, siteId: string, confirmation: string): Promise<Readonly<{
    fixtureId: string;
    graphVersion: string;
    assetCount: number;
    relationCount: number;
  }>>;
}
