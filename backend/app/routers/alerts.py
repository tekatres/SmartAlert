"""Alerts endpoints (called by Firebase Cloud Functions and admin tools)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, status

import httpx

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.models.schemas import (
    Alert,
    AlertGenerationRequest,
    AlertGenerationResponse,
    SignalEvaluationRequest,
    SignalEvaluationResponse,
    SignalOutcome,
    SignalThresholdConfig,
    TradingSignalAlert,
    UserTier,
)
from app.alert_engine.scoring import MODEL_VERSION

logger = get_logger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])
signals_router = APIRouter(prefix="/signals", tags=["signals"])


def _to_signal_thresholds(
    cfg: Optional["SignalThresholdConfig"],
) -> Optional["SignalThresholds"]:
    """Convert the API threshold config into the engine's dataclass (or None)."""
    from app.alert_engine.signal_engine import SignalThresholds

    if cfg is None:
        return None
    return SignalThresholds(
        min_confluence=cfg.min_confluence,
        min_risk_reward=cfg.min_risk_reward,
        min_adx=cfg.min_adx,
    )


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
    thresholds = _to_signal_thresholds(payload.signal_thresholds)
    trading_signals: list[TradingSignalAlert] = await orchestrator.generate_signals(
        coins, thresholds=thresholds
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


@signals_router.post("/evaluate", response_model=SignalEvaluationResponse)
async def evaluate_signal(
    payload: SignalEvaluationRequest,
) -> SignalEvaluationResponse:
    """Re-evaluate a past trading signal against post-creation klines.

    Used by the scoreOutcomeJob Cloud Function. Returns whether TP1 was hit
    before SL (WIN/LOSS/PENDING) plus 1h/4h profitability and excursions.
    """
    from app.alert_engine.signal_outcome import evaluate_signal_outcome

    async with httpx.AsyncClient(timeout=20.0) as client:
        outcome = await evaluate_signal_outcome(
            client=client,
            symbol=payload.symbol,
            direction=payload.direction.value,
            entry_price=payload.entry_price,
            stop_loss=payload.stop_loss,
            take_profit_1=payload.take_profit_1,
            take_profit_2=payload.take_profit_2,
            created_at=payload.created_at,
        )

    return SignalEvaluationResponse(
        signal_id=payload.signal_id,
        outcome=SignalOutcome(
            result=outcome.result,
            hit_level=outcome.hit_level,
            profitable_1h=outcome.profitable_1h,
            profitable_4h=outcome.profitable_4h,
            price_1h=outcome.price_1h,
            price_4h=outcome.price_4h,
            max_favorable_excursion_pct=outcome.max_favorable_excursion_pct,
            max_adverse_excursion_pct=outcome.max_adverse_excursion_pct,
            checked_at=outcome.evaluated_at,
        ),
    )
