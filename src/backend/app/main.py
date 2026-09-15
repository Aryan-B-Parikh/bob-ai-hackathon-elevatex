"""FastAPI gateway — mounts every capability router behind one app."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from .config import get_settings
from .db import SessionLocal, ensure_schema
from .models import Terminal
from .routers import ALL_ROUTERS

_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_schema()
    db = SessionLocal()
    try:
        if db.execute(select(func.count()).select_from(Terminal)).scalar() == 0:
            print("[startup] empty database — seeding (real POLB data + SimPy layer)…")
            from .seed import seed
            seed()

        try:
            from sqlalchemy import text
            ais_count = db.execute(text("SELECT COUNT(*) FROM congestion_observation WHERE source='AIS'")).scalar()
            if ais_count == 0:
                print("[startup] no AIS data found — generating synthetic AIS history…")
                from .pipelines.ais_generate import generate_and_load
                stats = generate_and_load(days=14, seed=20240817)
                print(f"[startup] AIS pipeline: {stats}")
        except Exception as _ae:  # noqa: BLE001
            print(f"[startup] AIS pipeline skipped: {_ae}")

        try:
            from .pipelines.weather import run_weather_pipeline
            n = run_weather_pipeline(db, hours=72)
            if n:
                print(f"[startup] weather pipeline: {n} rows from Open-Meteo")
        except Exception as _we:  # noqa: BLE001
            print(f"[startup] weather pipeline skipped: {_we}")
    finally:
        db.close()
    yield


app = FastAPI(
    title="PortPulse AI API",
    version="0.1.0",
    description=(
        "PortPulse AI gateway: SimPy simulation, LightGBM forecasting, Isolation Forest anomalies, "
        "OR-Tools CP-SAT berth/crane optimisation, and IBM Bob agent orchestration."
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


if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="spa")
