from __future__ import annotations

import pytest

from nexus_titan_api.demo_routes import validate_demo_reset
from nexus_titan_api.errors import APIError
from nexus_titan_api.main import app


def valid(**updates):
    values = {
        "role": "owner",
        "tenant_id": "demo-nexus",
        "confirmation": "RESET demo-nexus",
        "app_env": "local",
        "database_url": "postgresql://localhost/nexus",
    }
    values.update(updates)
    return validate_demo_reset(**values)


def test_demo_reset_requires_owner_exact_phrase_local_environment_and_local_database():
    assert valid() is None
    for override, code in [
        ({"role": "admin"}, "ROLE_FORBIDDEN"),
        ({"tenant_id": "another-tenant"}, "DEMO_RESET_CONFIRMATION_REQUIRED"),
        ({"confirmation": "demo-nexus"}, "DEMO_RESET_CONFIRMATION_REQUIRED"),
        ({"app_env": "production"}, "DEMO_RESET_LOCAL_ONLY"),
        (
            {"database_url": "postgresql://db.example.com/nexus"},
            "DEMO_RESET_REMOTE_DATABASE",
        ),
    ]:
        with pytest.raises(APIError) as error:
            valid(**override)
        assert error.value.code == code


def test_demo_reset_runtime_openapi_operation_is_registered():
    operation = app.openapi()["paths"]["/v1/demo/reset"]["post"]
    assert operation["requestBody"]["required"] is True
