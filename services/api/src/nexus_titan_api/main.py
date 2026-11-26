"""Contract-backed API shell; adapter operations fail explicitly until implemented."""

from __future__ import annotations

import json
import logging
import os
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .agent_routes import router as agent_router
from .causal_routes import router as causal_router
from .contracts import validate_contract
from .database import get_session
from .demo_routes import router as demo_router
from .errors import APIError
from .event_routes import router as event_router
from .event_routes import sync_events
from .generated_contracts import HealthStatus
from .governance_routes import router as governance_router
from .identity import Actor, current_actor, validate_identity_configuration
from .identity_routes import require_membership
from .identity_routes import router as identity_router
from .knowledge_routes import router as knowledge_router
from .mesh_routes import router as mesh_router
from .observability_routes import router as observability_router
from .privacy_routes import router as privacy_router
from .recovery_routes import router as recovery_router
from .replay_routes import router as replay_router
from .simulation_routes import router as simulation_router
from .world_routes import router as world_router

ROOT = next(
    (
        parent
        for parent in Path(__file__).resolve().parents
        if (parent / "docs/api/openapi.json").is_file()
    ),
    Path("/app"),
)
OPENAPI_PATH = ROOT / "docs/api/openapi.json"
OPENAPI_DOCUMENT = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))

app = FastAPI(title="NEXUS TITAN API", version="1.3.0")

_cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] or [
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("nexus_titan_api.request")
app.include_router(identity_router)
app.include_router(event_router)
app.include_router(world_router)
app.include_router(privacy_router)
app.include_router(agent_router)
app.include_router(knowledge_router)
app.include_router(causal_router)
app.include_router(simulation_router)
app.include_router(demo_router)
app.include_router(mesh_router)
app.include_router(governance_router)
app.include_router(replay_router)
app.include_router(observability_router)
app.include_router(recovery_router)


@app.on_event("startup")
def validate_security_startup() -> None:
    validate_identity_configuration()


@app.exception_handler(APIError)
async def api_error_handler(request: Request, error: APIError) -> JSONResponse:
    body: dict[str, Any] = {
        "error": {
            "code": error.code,
            "message": error.message,
            "request_id": getattr(request.state, "request_id", str(uuid4())),
        }
    }
    if error.details:
        body["error"]["details"] = error.details
    return JSONResponse(status_code=error.status, content=body)


@app.middleware("http")
async def request_context(request: Request, call_next: Any):
    started = perf_counter()
    request_id = request.headers.get("x-request-id", "")
    if not request_id or len(request_id) > 128 or any(ord(c) < 32 for c in request_id):
        request_id = str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        json.dumps(
            {
                "event": "request_complete",
                "request_id": request_id,
                "method": request.method,
                "route": (
                    request.scope.get("route").path
                    if request.scope.get("route")
                    else "unmatched"
                ),
                "status_code": response.status_code,
                "duration_ms": round((perf_counter() - started) * 1000, 2),
            },
            separators=(",", ":"),
        )
    )
    return response


def _validate(name: str, payload: Any) -> None:
    violations = validate_contract(name, payload)
    if violations:
        first = violations[0]
        details = [
            {"path": item.path, "message": item.message} for item in violations[:20]
        ]
        raise APIError(
            first.code, first.status, "Request does not match the v1 contract.", details
        )


def _not_implemented(adapter: str) -> None:
    raise APIError("NOT_IMPLEMENTED", 501, f"{adapter} adapter is not configured.")


@app.get("/health", tags=["health"], response_model=None)
def health() -> HealthStatus:
    """Process readiness only; downstream adapters are not probed."""
    return {"status": "ok", "service": "nexus-titan-api"}  # type: ignore[return-value]


@app.get("/health/ready", tags=["health"])
def readiness() -> dict[str, str]:
    """Verify PostgreSQL connectivity and the required core migration."""
    import os

    import psycopg

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise APIError("DEPENDENCY_UNAVAILABLE", 503, "Database is not configured.")
    try:
        with psycopg.connect(database_url, connect_timeout=2) as connection:
            row = connection.execute(
                "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '001_core'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '002_event_store_sync'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '003_world_ontology'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '004_synthetic_telemetry'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '005_privacy_approvals'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '006_agent_runtime'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '007_knowledge_retrieval_memory'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '008_causal_investigations'), "
                "EXISTS (SELECT 1 FROM schema_migrations WHERE version = '009_numerical_simulation'), "
                "to_regclass('organizations') IS NOT NULL, to_regclass('memberships') IS NOT NULL, "
                "to_regclass('sites') IS NOT NULL, to_regclass('devices') IS NOT NULL, "
                "to_regclass('organization_invites') IS NOT NULL, to_regclass('upload_authorizations') IS NOT NULL, "
                "to_regclass('aggregate_heads') IS NOT NULL, to_regclass('aggregate_projections') IS NOT NULL, "
                "to_regclass('projection_cursors') IS NOT NULL, "
                "to_regclass('world_fixture_seeds') IS NOT NULL, to_regclass('world_documents') IS NOT NULL, "
                "to_regclass('world_document_chunks') IS NOT NULL, "
                "to_regclass('event_inbox') IS NOT NULL, to_regclass('event_dead_letters') IS NOT NULL, "
                "to_regclass('projection_outbox') IS NOT NULL, "
                "to_regclass('telemetry_samples') IS NOT NULL, to_regclass('telemetry_alerts') IS NOT NULL"
                ", to_regclass('privacy_approvals') IS NOT NULL, to_regclass('agent_runs') IS NOT NULL, "
                "to_regclass('agent_run_roles') IS NOT NULL, to_regclass('agent_role_attempts') IS NOT NULL, "
                "to_regclass('agent_run_events') IS NOT NULL, to_regclass('agent_client_tasks') IS NOT NULL"
                ", to_regclass('knowledge_document_versions') IS NOT NULL, to_regclass('knowledge_chunks') IS NOT NULL, "
                "to_regclass('knowledge_embeddings') IS NOT NULL, to_regclass('knowledge_memory_facts') IS NOT NULL"
                ", to_regclass('knowledge_source_audit') IS NOT NULL, to_regclass('causal_investigations') IS NOT NULL, "
                "to_regclass('simulation_runs') IS NOT NULL, to_regclass('simulation_approvals') IS NOT NULL, to_regclass('simulation_audit') IS NOT NULL"
            ).fetchone()
    except psycopg.Error as error:
        raise APIError(
            "DEPENDENCY_UNAVAILABLE", 503, "Database readiness check failed."
        ) from error
    if row is None or not all(row):
        raise APIError(
            "MIGRATIONS_PENDING", 503, "Required database migrations are not applied."
        )
    return {"status": "ready", "service": "nexus-titan-api"}


@app.post("/v1/events", tags=["events"], deprecated=True)
async def append_events(
    request: Request,
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
    x_nexus_device_signature: str | None = Header(default=None),
) -> dict[str, object]:
    return await sync_events(request, actor, session, x_nexus_device_signature)


@app.post("/v1/simulations", tags=["simulations"])
async def submit_simulation(
    payload: dict[str, Any],
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> None:
    _validate("SimulationRequest", payload)
    member = require_membership(session, str(payload["tenant_id"]), actor)
    if member.role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN", 403, "Viewer memberships cannot submit simulations."
        )
    _not_implemented("SimulationSolver")


@app.post("/v1/agents/execute", tags=["agents"])
async def execute_agent(
    payload: dict[str, Any],
    actor: Actor = Depends(current_actor),
    session: Session = Depends(get_session),
) -> None:
    _validate("AgentInvocation", payload)
    member = require_membership(session, str(payload["tenant_id"]), actor)
    if member.role not in {"owner", "admin", "operator"}:
        raise APIError(
            "ROLE_FORBIDDEN", 403, "Viewer memberships cannot execute agents."
        )
    _not_implemented("AgentExecutor")


def _contract_openapi() -> dict[str, Any]:
    """Keep contract paths canonical while adding documented identity endpoints."""
    document = deepcopy(OPENAPI_DOCUMENT)
    generated = get_openapi(title=app.title, version=app.version, routes=app.routes)
    for path, operations in generated.get("paths", {}).items():
        if path == "/v1/me" or path.startswith(
            (
                "/v1/organizations/",
                "/v1/invites/",
                "/v1/agents/",
                "/v1/knowledge/",
                "/v1/causal/",
                "/v1/simulations/scenarios",
                "/v1/demo/",
                "/v1/observability/",
                "/v1/recovery/",
            )
        ):
            document.setdefault("paths", {})[path] = operations
        elif path in {
            "/sync/events",
            "/sync/snapshot/{tenant_id}",
            "/v1/events",
        } or path.startswith("/v1/world/"):
            for method, generated_operation in operations.items():
                contract_operation = (
                    document.setdefault("paths", {}).setdefault(path, {}).get(method)
                )
                if contract_operation is None:
                    document["paths"][path][method] = generated_operation
                    continue
                parameters = contract_operation.setdefault("parameters", [])
                existing = {parameter.get("name") for parameter in parameters}
                parameters.extend(
                    parameter
                    for parameter in generated_operation.get("parameters", [])
                    if parameter.get("name") not in existing
                )
    components = document.setdefault("components", {}).setdefault("schemas", {})
    components.update(generated.get("components", {}).get("schemas", {}))
    for path in ("/v1/events", "/v1/simulations", "/v1/agents/execute"):
        generated_post = generated.get("paths", {}).get(path, {}).get("post", {})
        contract_post = document.get("paths", {}).get(path, {}).get("post", {})
        if contract_post:
            parameters = contract_post.setdefault("parameters", [])
            existing = {parameter.get("name") for parameter in parameters}
            parameters.extend(
                parameter
                for parameter in generated_post.get("parameters", [])
                if parameter.get("name") not in existing
            )
    return document


app.openapi = _contract_openapi  # type: ignore[method-assign]
