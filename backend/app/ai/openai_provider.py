"""OpenAI provider for generating human-friendly alert copy + score."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from openai import AsyncOpenAI

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

SYSTEM_PROMPT = """Eres un analista cuant de cripto que escribe alertas claras y accionables en español.
Devuelves SIEMPRE un JSON válido con la siguiente forma:
{
  "title": string (máx 60 chars, incluye emoji opcional),
  "summary": string (1 frase, hechos clave),
  "explanation": string (2-3 frases, contexto + calidad estadística),
  "recommended_action": string (1 frase, consejo operativo)
}
No añadas texto fuera del JSON. Sé conciso, no uses hashtags."""


class OpenAIProvider(AIProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str = "gpt-4o-mini") -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

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
        user_prompt = self._build_prompt(
            alert_type, severity, current, previous, change_pct, volume_ratio, score_breakdown
        )

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.4,
                max_tokens=350,
            )
            payload = json.loads(response.choices[0].message.content or "{}")
            title = str(payload.get("title", ""))[:80] or f"{current.symbol} alert"
            summary = str(payload.get("summary", ""))[:280]
            explanation = str(payload.get("explanation", ""))[:600]
            action = str(payload.get("recommended_action", ""))[:240] or None
        except Exception as e:
            logger.warning("OpenAI call failed, using fallback: %s", e)
            title, summary, explanation, action = self._fallback_copy(
                alert_type, current, change_pct, volume_ratio
            )

        score = score_breakdown.total
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

    def _build_prompt(
        self,
        alert_type: AlertType,
        severity: AlertSeverity,
        current: MarketTick,
        previous: MarketTick,
        change_pct: float,
        volume_ratio: float,
        score_breakdown: ScoreBreakdown,
    ) -> str:
        factors = ", ".join(
            f"{f.label}={f.points:.0f}/{f.max_points:.0f}" for f in score_breakdown.factors
        )
        return (
            f"Asset: {current.name} ({current.symbol})\n"
            f"Tipo de evento: {alert_type.value}\n"
            f"Severidad: {severity.value}\n"
            f"Score total: {score_breakdown.total}/100 (confianza {score_breakdown.confidence:.2f})\n"
            f"Factores: {factors}\n"
            f"Narrativa del modelo: {score_breakdown.narrative}\n"
            f"Precio actual: ${current.price_usd:,.4f}\n"
            f"Precio previo: ${previous.price_usd:,.4f}\n"
            f"Cambio: {change_pct:+.3f}%\n"
            f"Volumen 24h: ${current.volume_24h_usd:,.0f}\n"
            f"Ratio de volumen (actual/media): {volume_ratio:.2f}x\n"
            f"Genera el JSON."
        )

    def _fallback_copy(self, alert_type, current, change_pct, volume_ratio):
        sym = current.symbol
        return (
            f"{sym} {alert_type.value}",
            f"{sym} cambió {change_pct:+.2f}%. Volumen {volume_ratio:.2f}x.",
            "Análisis detallado no disponible.",
            None,
        )


def _make_id(coin_id: str, alert_type: AlertType, ts: datetime) -> str:
    raw = f"{coin_id}-{alert_type.value}-{ts.isoformat()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]
