"""Mock AI provider (no external API). Generates deterministic, high-quality copy."""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.ai.base import AIProvider
from app.core.logging import get_logger
from app.models.schemas import (
    Alert,
    AlertSeverity,
    AlertType,
    MarketTick,
    ScoreBreakdown,
    UserTier,
    is_premium_only_predicate,
)

logger = get_logger(__name__)


class MockAIProvider(AIProvider):
    name = "mock"

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
        score = score_breakdown.total
        title, summary, explanation, action = self._compose_copy(
            alert_type, current, change_pct, volume_ratio, score
        )
        premium_only, reason = is_premium_only_predicate(alert_type, score)

        return Alert(
            id=_make_id(current.coin_id, alert_type, current.timestamp),
            type=alert_type,
            severity=severity,
            coin_id=current.coin_id,
            symbol=current.symbol,
            name=current.name,
            price_usd=current.price_usd,
            previous_price_usd=previous.price_usd,
            change_pct=round(change_pct, 3),
            volume_24h_usd=current.volume_24h_usd,
            volume_ratio=round(volume_ratio, 2),
            score=score,
            score_breakdown=score_breakdown if include_breakdown else None,
            title=title,
            summary=summary,
            explanation=explanation,
            recommended_action=action,
            visible_to_free=not premium_only,
            min_tier=UserTier.PREMIUM if premium_only else UserTier.FREE,
            premium_only_reason=reason,
            created_at=current.timestamp,
            expires_at=current.timestamp + timedelta(hours=2),
        )

    def _compose_copy(
        self,
        alert_type: AlertType,
        current: MarketTick,
        change_pct: float,
        volume_ratio: float,
        score: int,
    ):
        sym = current.symbol
        direction_word = "sube" if change_pct > 0 else "cae"
        abs_change = abs(change_pct)
        vol_descriptor = (
            "con volumen alto"
            if volume_ratio > 1.8
            else "con volumen elevado"
            if volume_ratio > 1.2
            else "con volumen normal"
        )

        if alert_type == AlertType.PRICE_SURGE:
            title = f"🚀 {sym} repunta {abs_change:.2f}%"
            summary = f"{sym} {direction_word} un {abs_change:.2f}% en los últimos minutos, {vol_descriptor}."
            explanation = (
                "Movimiento alcista con confirmación de volumen. "
                "Posible continuación si el precio mantiene el nivel actual."
            )
            action = "Considera entry en retroceso hacia soporte cercano con stop ajustado."
        elif alert_type == AlertType.PRICE_DUMP:
            title = f"🔻 {sym} cae {abs_change:.2f}%"
            summary = f"{sym} {direction_word} un {abs_change:.2f}% en los últimos minutos, {vol_descriptor}."
            explanation = (
                "Presión vendedora detectada. "
                "Podría tratarse de una toma de liquidez antes de un rebote o continuación bajista."
            )
            action = "Evita comprar en caída fuerte. Espera confirmación de reversión."
        elif alert_type == AlertType.VOLUME_SPIKE:
            title = f"📊 {sym} registra pico de volumen"
            summary = (
                f"Volumen 24h de {sym} multiplicado por {volume_ratio:.2f}x respecto a la media."
            )
            explanation = (
                "Pico de actividad inusual. Frecuentemente precede a movimientos direccionales fuertes."
            )
            action = "Observa el precio en los próximos minutos para confirmar dirección."
        else:  # BREAKOUT
            title = f"💥 {sym} rompe estructura"
            summary = f"{sym} {direction_word} un {abs_change:.2f}% rompiendo rango reciente."
            explanation = (
                "Ruptura de rango con volumen. La estructura técnica sugiere un nuevo tramo direccional."
            )
            action = "Valida el volumen en el cierre de la vela antes de operar."

        if score >= 75:
            explanation += " Alta calidad estadística: prioriza esta alerta."
        elif score >= 50:
            explanation += " Calidad moderada: monitoriza evolución."

        return title, summary, explanation, action


def _make_id(coin_id: str, alert_type: AlertType, ts: datetime) -> str:
    raw = f"{coin_id}-{alert_type.value}-{ts.isoformat()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]
