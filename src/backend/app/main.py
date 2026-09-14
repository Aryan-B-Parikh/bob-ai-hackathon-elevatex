"""FastAPI gateway — mounts every capability router behind one app."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from .config import get_settings
from .db import SessionLocal, ensure_schema
from .models import Terminal
from .routers import ALL_ROUTERS


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_schema()
    db = SessionLocal()
    try:
        if db.execute(select(func.count()).select_from(Terminal)).scalar() == 0:
            print("[startup] empty database — seeding (real POLB data + SimPy layer)…")
            from .seed import seed

            seed()
    finally:
        db.close()
    yield


app = FastAPI(
    title="PortFlow SBX API",
    version="0.1.0",
    description=(
        "FastAPI gateway: SimPy simulation, LightGBM forecasting, Isolation Forest anomalies, "
        "OR-Tools CP-SAT berth/crane optimisation, Claude plan narrative."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in ALL_ROUTERS:
    app.include_router(r)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
