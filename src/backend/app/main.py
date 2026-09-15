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

        # NOTE: Auto-replace of SimPy history with AIS-generated data is intentionally
        # disabled here.  The ais_generate pipeline concentrates all vessels in 2 anchorage
        # rectangles, causing Z-LBCT and Z-TTI to receive zero queue records which collapses
        # LightGBM feature importances and breaks forecast drivers.  The SimPy layer
        # (source="DEMO_AIS") produces balanced per-zone variance needed for training.
        # Use POST /api/ais/generate or `python -m app.pipelines.ais_generate` to
        # opt-in to AIS data manually once zone assignment is corrected.

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
