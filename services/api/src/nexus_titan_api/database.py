"""Application database sessions for canonical PostgreSQL state."""

from __future__ import annotations

import os
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


def database_url() -> str:
    value = os.getenv("DATABASE_URL", "")
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    if value.startswith("postgresql://"):
        value = value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


@lru_cache(maxsize=4)
def engine_for(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def get_session() -> Iterator[Session]:
    factory = sessionmaker(bind=engine_for(database_url()), expire_on_commit=False)
    with factory() as session:
        yield session
