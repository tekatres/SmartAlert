"""Abstract AI provider used to enrich raw events with summary/explanation/score."""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.models.schemas import (
    Alert,
    AlertSeverity,
    AlertType,
    MarketTick,
    ScoreBreakdown,
)


class AIProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def enrich(
        self,
        *,
        alert_type: AlertType,
        severity: AlertSeverity,
        current: MarketTick,
        previous: MarketTick,
        change_pct: float,
        volume_ratio: float,
        score_breakdown: ScoreBreakdown,
        include_breakdown: bool = True,
    ) -> Alert:
        """Build a fully populated Alert object with AI-generated copy + score.
        `include_breakdown` controls whether the breakdown is attached (premium only)."""
