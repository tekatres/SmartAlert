"""Outcome tracker.

Periodically re-checks the price of past alerts and records whether they were
profitable at 1h / 4h / 24h. The result feeds the "pattern" factor in the
scoring engine (closed-loop learning) and powers the conversion stats
("you missed X% average" widget in the frontend).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.logging import get_logger
from app.models.schemas import Alert, AlertOutcome, AlertType, MarketTick
from app.services.base import MarketDataProvider

logger = get_logger(__name__)


@dataclass
class CheckpointResult:
    profitable_1h: Optional[bool]
    profitable_4h: Optional[bool]
    profitable_24h: Optional[bool]
    price_1h: Optional[float]
    price_4h: Optional[float]
    price_24h: Optional[float]


class OutcomeTracker:
    """Re-evaluates past alerts using the same data provider."""

    def __init__(self, data_provider: MarketDataProvider) -> None:
        self._data = data_provider

    async def evaluate(self, alert: Alert) -> CheckpointResult:
        """Fetch current price for the alert's coin and compute the
        post-alert delta for the directional bias implied by the alert type."""
        target_coin = alert.coin_id
        snapshot = await self._data.fetch_snapshot([target_coin])
        current_price = next(
            (t.price_usd for t in snapshot.tickers if t.coin_id == target_coin),
            None,
        )
        if current_price is None:
            return CheckpointResult(None, None, None, None, None, None)

        is_bullish = alert.type in (AlertType.PRICE_SURGE, AlertType.BREAKOUT)
        # For VOLUME_SPIKE we determine direction from the actual move
        if alert.type == AlertType.VOLUME_SPIKE:
            is_bullish = alert.change_pct >= 0

        entry = alert.price_usd
        def profitable(price: float) -> bool:
            delta = (price - entry) / entry
            return (delta > 0) == is_bullish and abs(delta) > 0.001  # > 0.1% move

        return CheckpointResult(
            profitable_1h=profitable(current_price) if current_price else None,
            profitable_4h=None,  # would need historical snapshots — left to Pro
            profitable_24h=None,
            price_1h=current_price,
            price_4h=None,
            price_24h=None,
        )

    def to_outcome(self, result: CheckpointResult) -> AlertOutcome:
        return AlertOutcome(
            checked_at=datetime.now(timezone.utc),
            price_after_1h=result.price_1h,
            profitable_1h=result.profitable_1h,
            score_was_correct=result.profitable_1h,
        )

    async def pattern_winrate(
        self,
        *,
        coin_id: str,
        alert_type: AlertType,
        lookback_days: int = 30,
    ) -> tuple[float, int]:
        """In production this would query a Firestore collection of past
        alerts. Here we return a neutral prior so the engine still works
        before the outcome tracker has accumulated data."""
        # TODO(Pro): query `engine_runs` + a separate `alert_outcomes` collection
        return 0.5, 0
