"""Capability routers — one per engine, mounted behind the FastAPI gateway."""

from . import bob, catalog, forecast, optimise, overview, plan, routing

ALL_ROUTERS = [
    overview.router, forecast.router, optimise.router, routing.router,
    plan.router, catalog.router, bob.router,
]
