"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.ai.factory import get_ai_provider
from app.alert_engine.engine import AlertEngine
from app.alert_engine.outcome import OutcomeTracker
from app.alert_engine.signal_orchestrator import SignalOrchestrator
from app.core.config import get_settings
from app.core.logging import get_logger, setup_logging
from app.routers import alerts_router, health_router, signals_router
from app.services import get_provider
from app.services.engine_loop import EngineLoop

settings = get_settings()
setup_logging(settings.log_level)
log = get_logger("smart_alerts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Booting %s (env=%s)", settings.app_name, settings.app_env)

    data_provider = get_provider(settings.data_provider)
    ai_provider = get_ai_provider(settings)
    outcome_tracker = OutcomeTracker(data_provider)
    signal_orchestrator = SignalOrchestrator()

    app.state.data_provider = data_provider
    app.state.ai_provider = ai_provider
    app.state.outcome_tracker = outcome_tracker
    app.state.signal_orchestrator = signal_orchestrator
    app.state.alert_engine = AlertEngine(
        data_provider=data_provider,
        ai_provider=ai_provider,
        outcome_tracker=outcome_tracker,
    )

    # No-Cloud-Functions loop: persists + pushes from this process.
    engine_loop = EngineLoop(settings, app.state.alert_engine, signal_orchestrator)
    engine_loop.start()
    app.state.engine_loop = engine_loop

    log.info(
        "Alert engine ready. data=%s ai=%s coins=%d loop=%s",
        data_provider.name,
        ai_provider.name,
        len(settings.coin_list),
        engine_loop.available,
    )
    yield
    await engine_loop.stop()
    log.info("Shutting down.")


app = FastAPI(
    title="Smart Alerts AI - Engine",
    description="Alert detection + AI enrichment microservice for the Smart Alerts platform.",
    version="0.2.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(alerts_router)
app.include_router(signals_router)


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {
        "service": settings.app_name,
        "status": "ok",
        "docs": "/docs",
    }
