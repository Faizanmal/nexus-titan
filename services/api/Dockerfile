FROM ghcr.io/astral-sh/uv:0.8.3 AS uv
FROM python:3.13.1-slim-bookworm

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

COPY services/api/pyproject.toml services/api/uv.lock ./services/api/
RUN uv sync --project services/api --locked --no-dev --no-install-project

COPY services/api/src ./src
COPY services/api/migrations ./migrations
COPY services/api/alembic.ini ./alembic.ini
COPY services/api/alembic ./alembic
COPY contracts/schemas/v1.0.0/contracts.schema.json ./contracts/schemas/v1.0.0/contracts.schema.json
COPY contracts/schemas/v1.1.0/contracts.schema.json ./contracts/schemas/v1.1.0/contracts.schema.json
COPY contracts/schemas/v1.2.0/contracts.schema.json ./contracts/schemas/v1.2.0/contracts.schema.json
COPY contracts/schemas/v1.3.0/contracts.schema.json ./contracts/schemas/v1.3.0/contracts.schema.json
COPY contracts/privacy/policy-v1.json ./contracts/privacy/policy-v1.json
COPY tests/fixtures/world/TITAN-WTP-01 ./tests/fixtures/world/TITAN-WTP-01
COPY docs/api/openapi.json ./docs/api/openapi.json

ENV PYTHONPATH=/app/src
EXPOSE 8000
CMD ["uvicorn", "nexus_titan_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
