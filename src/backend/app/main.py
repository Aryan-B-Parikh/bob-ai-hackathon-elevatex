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

# Resolve the frontend dist/ directory relative to this file so the path works
# regardless of the working directory the server is launched from.
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

        # Load AIS-generated data on startup if the DB has no AIS observations yet.
        # The generator now uses all 4 terminal anchor points so every zone receives
        # balanced vessel records — the zone assignment bug is fixed.
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

        # Refresh weather on every startup so forecasting has the latest Open-Meteo data.
        # Non-fatal: if network is unavailable the forecast falls back to weather_used=False.
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


# ── Static file serving for production ────────────────────────────────────────
# Mount the Vite dist/ output so `uvicorn app.main:app` serves both the API
# and the SPA without a separate nginx process.  In development the Vite dev
# server handles this instead (see vite.config.ts proxy rules).
# The mount is skipped when dist/ doesn't exist (e.g. a fresh backend-only
# install that hasn't run `npm run build` yet).
if _DIST.is_dir():
    # SPA fallback: serve index.html for any path not already matched by an API route.
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="spa")
