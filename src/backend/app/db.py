"""Database engine, session factory and declarative base (SQLAlchemy 2.0 + psycopg3)."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, echo=settings.db_echo, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables (idempotent). Used by the seed script and on startup."""
    from . import models  # noqa: F401  (register mappers)

    Base.metadata.create_all(bind=engine)


def drop_all() -> None:
    from . import models  # noqa: F401

    Base.metadata.drop_all(bind=engine)
