"""Alerts endpoints (called by Firebase Cloud Functions and admin tools)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.models.schemas import (
    Alert,
    AlertGenerationRequest,
    AlertGenerationResponse,
    TradingSignalAlert,
    UserTier,
)
from app.alert_engine.scoring import MODEL_VERSION

logger = get_logger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])
signals_router = APIRouter(prefix="/signals", tags=["signals"])


async def _verify_internal_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    x_user_tier: Optional[str] = Header(default=None, alias="X-User-Tier"),
    settings: Settings = Depends(get_settings),
) -> UserTier:
    """Verify the shared secret and extract the caller's tier from headers.

    Tier is passed by the Cloud Function (which knows the user's plan) so
    that the engine can return premium-only fields when appropriate.
    """
    if settings.internal_api_key and settings.internal_api_key != "change-me":
        if x_api_key != settings.internal_api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key",
            )

    tier = (x_user_tier or "free").lower()
    if tier not in ("free", "premium", "pro"):
        tier = "free"
    return UserTier(tier)


@router.post("/generate", response_model=AlertGenerationResponse)
async def generate_alerts(
    payload: AlertGenerationRequest,
    request: Request,
    tier: UserTier = Depends(_verify_internal_key),
    settings: Settings = Depends(get_settings),
) -> AlertGenerationResponse:
    engine = request.app.state.alert_engine
    coins = payload.coins or settings.coin_list
    effective_tier = payload.tier if payload.tier != UserTier.FREE else tier

    alerts: list[Alert] = await engine.generate_alerts(
        coin_ids=coins,
        sensitivity=payload.sensitivity,
        use_ai=payload.use_ai,
        tier=effective_tier,
    )

    # Run trading signal engine in parallel with alert generation
    orchestrator = request.app.state.signal_orchestrator
    trading_signals: list[TradingSignalAlert] = await orchestrator.generate_signals(coins)

    return AlertGenerationResponse(
        generated_at=datetime.now(timezone.utc),
        count=len(alerts),
        alerts=alerts,
        trading_signals=trading_signals,
        provider=settings.data_provider,
        ai_provider=settings.ai_provider,
        model_version=MODEL_VERSION,
    )


@router.get("/recent", response_model=AlertGenerationResponse)
async def recent_alerts(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> AlertGenerationResponse:
    """Force a regeneration (useful for debugging/admin). Returns free-tier view."""
    engine = request.app.state.alert_engine
    alerts = await engine.generate_alerts(
        coin_ids=settings.coin_list,
        sensitivity="medium",
        use_ai=True,
        tier=UserTier.FREE,
    )
    orchestrator = request.app.state.signal_orchestrator
    trading_signals: list[TradingSignalAlert] = await orchestrator.generate_signals(
        settings.coin_list
    )
    return AlertGenerationResponse(
        generated_at=datetime.now(timezone.utc),
        count=len(alerts),
        alerts=alerts,
        trading_signals=trading_signals,
        provider=settings.data_provider,
        ai_provider=settings.ai_provider,
        model_version=MODEL_VERSION,
    )


@router.post("/evaluate")
async def evaluate_alert(
    request: Request,
    alert_id: str = Body(..., embed=True),
) -> dict:
    """Re-evaluate a past alert and return its outcome (used by the outcome
    tracker Cloud Function)."""
    outcome_tracker = request.app.state.outcome_tracker
    # In production, fetch the alert from Firestore. Here we return a stub
    # so the endpoint is testable without a live DB.
    return {
        "alert_id": alert_id,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "status": "queued",
    }


# ---------------------------------------------------------------------------
# Signals endpoints
# ---------------------------------------------------------------------------

@signals_router.get("/recent", response_model=List[TradingSignalAlert])
async def recent_signals(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> List[TradingSignalAlert]:
    """Generate and return fresh trading signals for all configured coins."""
    orchestrator = request.app.state.signal_orchestrator
    return await orchestrator.generate_signals(settings.coin_list)
