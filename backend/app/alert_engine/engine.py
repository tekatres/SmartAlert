"""Alert engine: orchestrates fetching, rule application, scoring, and AI enrichment."""
from __future__ import annotations

from typing import List, Optional

from app.ai.base import AIProvider
from app.alert_engine.outcome import OutcomeTracker
from app.alert_engine.rules import RawEvent, Rule, default_rules
from app.alert_engine.scoring import (
    MODEL_VERSION,
    ScoringContext,
    compute_score,
    severity_from_score,
)
from app.core.logging import get_logger
from app.models.schemas import (
    Alert,
    AlertSeverity,
    MarketSnapshot,
    ScoreBreakdown,
    UserTier,
)
from app.services.base import MarketDataProvider

logger = get_logger(__name__)


class AlertEngine:
    def __init__(
        self,
        *,
        data_provider: MarketDataProvider,
        ai_provider: AIProvider,
        outcome_tracker: Optional[OutcomeTracker] = None,
        rules: Optional[List[Rule]] = None,
    ) -> None:
        self._data = data_provider
        self._ai = ai_provider
        self._outcome = outcome_tracker or OutcomeTracker(data_provider)
        self._rules = rules or default_rules()

    async def generate_alerts(
        self,
        coin_ids: List[str],
        *,
        sensitivity: str = "medium",
        use_ai: bool = True,
        tier: UserTier = UserTier.FREE,
    ) -> List[Alert]:
        snapshot: MarketSnapshot = await self._data.fetch_snapshot(coin_ids)
        events = self._detect_events(snapshot, sensitivity=sensitivity)
        logger.info("Detected %d raw events from %s", len(events), self._data.name)

        if not use_ai:
            return []

        alerts: List[Alert] = []
        for ev in events:
            try:
                # 1) Build scoring context for this specific event
                ctx = await self._build_context(ev, coin_ids)

                # 2) Compute the multi-factor breakdown
                breakdown = compute_score(
                    alert_type=ev.alert_type,
                    current=ev.current,
                    previous=ev.previous,
                    volume_ratio=ev.volume_ratio,
                    ctx=ctx,
                )

                # 3) Derive severity from the new score
                severity = severity_from_score(breakdown.total)

                # 4) Enrich with AI (mock or OpenAI)
                include_breakdown = tier != UserTier.FREE
                alert = await self._ai.enrich(
                    alert_type=ev.alert_type,
                    severity=severity,
                    current=ev.current,
                    previous=ev.previous,
                    change_pct=ev.change_pct,
                    volume_ratio=ev.volume_ratio,
                    score_breakdown=breakdown,
                    include_breakdown=include_breakdown,
                )
                alerts.append(alert)
            except Exception as e:
                logger.exception("AI enrichment failed for %s: %s", ev.current.coin_id, e)

        alerts.sort(key=lambda a: a.score, reverse=True)
        return alerts

    def _detect_events(self, snapshot: MarketSnapshot, *, sensitivity: str) -> List[RawEvent]:
        prev_map = {t.coin_id: t for t in snapshot.previous_tickers}
        events: List[RawEvent] = []
        seen: set = set()
        for current in snapshot.tickers:
            previous = prev_map.get(current.coin_id)
            for rule in self._rules:
                if not rule.applies_to(current, previous):
                    continue
                event = rule.evaluate(current, previous, sensitivity)
                if event is None:
                    continue
                key = event.key()
                if key in seen:
                    continue
                seen.add(key)
                events.append(event)
        return events

    async def _build_context(self, ev: RawEvent, coin_ids: List[str]) -> ScoringContext:
        """Build the scoring context (trend, vol regime, pattern) for an event."""
        winrate, n = await self._outcome.pattern_winrate(
            coin_id=ev.current.coin_id,
            alert_type=ev.alert_type,
        )
        # Trend strength: combine 24h change and 1h change (capped)
        change_24h = ev.current.change_24h_pct or 0.0
        change_1h = ev.current.change_1h_pct or 0.0
        trend_strength = min(1.0, (abs(change_24h) * 0.05 + abs(change_1h) * 0.1))

        # Realized vol proxy: 24h change magnitude normalized (rough)
        realized_vol = min(1.0, max(0.2, abs(change_24h) * 0.1 + 0.3))

        # Hour from current tick timestamp
        hour_utc = ev.current.timestamp.hour

        # Liquidity proxy: volume relative to a $5B baseline
        liquidity_tier = min(1.0, ev.current.volume_24h_usd / 5_000_000_000.0)

        return ScoringContext(
            pattern_winrate=winrate,
            pattern_sample_size=n,
            trend_strength=trend_strength,
            realized_volatility=realized_vol,
            hour_utc=hour_utc,
            liquidity_tier=liquidity_tier,
        )
