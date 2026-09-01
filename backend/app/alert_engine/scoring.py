"""Multi-factor scoring engine.

The score is a weighted sum of 6 independent factors, each producing a 0..max_points
contribution. The total is clamped to 0-100 and mapped to severity. Each factor
also returns a short human-readable explanation so the premium tier can show
"why this scored 87" instead of an opaque number.

This is the **conversion-critical** piece. Two design choices drive premium
adoption:
  1. The breakdown is only returned to premium users (free sees total + a teaser).
  2. A subset of alerts (top score, unusual setups) is marked `min_tier: premium`
     and hidden behind a paywall — this creates the FOMO that drives upgrades.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from app.core.logging import get_logger
from app.models.schemas import (
    Alert,
    AlertSeverity,
    AlertType,
    MarketTick,
    ScoreBreakdown,
    ScoreFactor,
    UserTier,
)

logger = get_logger(__name__)

MODEL_VERSION = "v2"

# Weighting (sums to 100). Tunable via env if needed in the future.
WEIGHTS = {
    "magnitude": 25,
    "volume": 20,
    "trend": 15,
    "volatility": 15,
    "pattern": 15,
    "timing": 10,
}

# Tier rules — alerts above these thresholds are gated to premium.
# Tuned so free users see ~70% of alerts, premium gets everything + breakdown.
PREMIUM_SCORE_THRESHOLD = 80         # alerts >= 80 → premium-only
PREMIUM_TYPE_GATE = {AlertType.BREAKOUT}  # some alert types are inherently premium


@dataclass
class ScoringContext:
    """Optional context (from outcome tracker / cache) used by advanced factors."""
    # Number of times a similar setup (same coin + alert_type) was profitable in last 30d
    pattern_winrate: float = 0.5
    pattern_sample_size: int = 0
    # Trend strength: 0 (ranging) - 1 (strong trend)
    trend_strength: float = 0.5
    # Realized volatility (annualized) for the asset
    realized_volatility: float = 0.5
    # Hour of day UTC (0-23)
    hour_utc: int = 12
    # Asset liquidity tier: 0 = illiquid, 1 = very liquid
    liquidity_tier: float = 0.5


def compute_score(
    *,
    alert_type: AlertType,
    current: MarketTick,
    previous: MarketTick,
    volume_ratio: float,
    ctx: ScoringContext | None = None,
) -> ScoreBreakdown:
    """Compute the full multi-factor score breakdown for an alert."""
    ctx = ctx or ScoringContext()
    factors: List[ScoreFactor] = []

    # 1) Magnitude — how big is the move
    pct = ((current.price_usd - previous.price_usd) / previous.price_usd) * 100.0
    abs_pct = abs(pct)
    mag_points = min(WEIGHTS["magnitude"], abs_pct * 4.0)  # 6.25% move = full points
    factors.append(ScoreFactor(
        key="magnitude",
        label="Magnitud del movimiento",
        value=round(abs_pct, 3),
        points=round(mag_points, 2),
        max_points=WEIGHTS["magnitude"],
        explanation=_mag_explain(abs_pct, alert_type),
    ))

    # 2) Volume — does volume confirm the move
    vol_excess = max(volume_ratio - 1.0, 0.0)
    vol_points = min(WEIGHTS["volume"], vol_excess * 10.0)  # 2x vol = full
    factors.append(ScoreFactor(
        key="volume",
        label="Confirmación de volumen",
        value=round(volume_ratio, 2),
        points=round(vol_points, 2),
        max_points=WEIGHTS["volume"],
        explanation=_vol_explain(volume_ratio),
    ))

    # 3) Trend alignment
    trend_penalty = 1.0 if _trend_supports(alert_type, current) else 0.55
    trend_points = WEIGHTS["trend"] * ctx.trend_strength * trend_penalty
    factors.append(ScoreFactor(
        key="trend",
        label="Alineación con tendencia",
        value=round(ctx.trend_strength, 2),
        points=round(trend_points, 2),
        max_points=WEIGHTS["trend"],
        explanation=_trend_explain(ctx.trend_strength, alert_type, current),
    ))

    # 4) Volatility regime — penalize moves that are "normal" for the asset
    vol_regime = _volatility_regime_score(abs_pct, ctx.realized_volatility, current)
    vola_points = WEIGHTS["volatility"] * vol_regime
    factors.append(ScoreFactor(
        key="volatility",
        label="Régimen de volatilidad",
        value=round(ctx.realized_volatility, 2),
        points=round(vola_points, 2),
        max_points=WEIGHTS["volatility"],
        explanation=_volatility_explain(abs_pct, ctx.realized_volatility),
    ))

    # 5) Historical pattern (collaborative signal from outcome tracker)
    pattern_score = _pattern_score(ctx.pattern_winrate, ctx.pattern_sample_size)
    pattern_points = WEIGHTS["pattern"] * pattern_score
    factors.append(ScoreFactor(
        key="pattern",
        label="Patrón histórico",
        value=round(ctx.pattern_winrate, 2),
        points=round(pattern_points, 2),
        max_points=WEIGHTS["pattern"],
        explanation=_pattern_explain(ctx.pattern_winrate, ctx.pattern_sample_size),
    ))

    # 6) Timing — high-liquidity windows (UTC overlap) score higher
    timing_score = _timing_score(ctx.hour_utc, ctx.liquidity_tier)
    timing_points = WEIGHTS["timing"] * timing_score
    factors.append(ScoreFactor(
        key="timing",
        label="Ventana de liquidez",
        value=ctx.hour_utc,
        points=round(timing_points, 2),
        max_points=WEIGHTS["timing"],
        explanation=_timing_explain(ctx.hour_utc, ctx.liquidity_tier),
    ))

    total_raw = sum(f.points for f in factors)
    total = int(min(100, max(1, round(total_raw))))
    confidence = _confidence_from_factors(factors, ctx)
    narrative = _narrative(alert_type, factors, total)

    return ScoreBreakdown(
        total=total,
        confidence=round(confidence, 3),
        tier=UserTier.PREMIUM,
        factors=factors,
        narrative=narrative,
        model_version=MODEL_VERSION,
    )


def severity_from_score(score: int) -> AlertSeverity:
    if score >= 80:
        return AlertSeverity.HIGH
    if score >= 55:
        return AlertSeverity.MEDIUM
    return AlertSeverity.LOW


def is_premium_only(alert_type: AlertType, score: int) -> tuple[bool, str | None]:
    """Decide whether an alert is gated to premium.

    Rules (return value: (is_premium_only, reason)):
      - score >= PREMIUM_SCORE_THRESHOLD  → premium, "Top score"
      - alert_type in PREMIUM_TYPE_GATE   → premium, "Advanced setup"
    """
    if score >= PREMIUM_SCORE_THRESHOLD:
        return True, "Top score — solo Premium"
    if alert_type in PREMIUM_TYPE_GATE:
        return True, "Setup avanzado — solo Premium"
    return False, None


# --- Factor helpers ---

def _mag_explain(pct: float, t: AlertType) -> str:
    if pct < 1.5:
        return f"Movimiento pequeño ({pct:.2f}%). Señal débil por sí sola."
    if pct < 3.5:
        return f"Movimiento moderado ({pct:.2f}%). Rango habitual en cripto."
    if pct < 6:
        return f"Movimiento fuerte ({pct:.2f}%). Llama la atención del mercado."
    return f"Movimiento excepcional ({pct:.2f}%). Raro incluso en cripto."


def _vol_explain(vr: float) -> str:
    if vr < 1.2:
        return "Volumen dentro de la media. El movimiento no está confirmado."
    if vr < 1.8:
        return "Volumen elevado. Confirmación parcial del movimiento."
    if vr < 3:
        return "Volumen alto. El mercado está reaccionando con fuerza."
    return "Volumen extremo. Posible evento catalizador detrás del movimiento."


def _trend_explain(strength: float, t: AlertType, current: MarketTick) -> str:
    direction = "alcista" if (current.change_24h_pct or 0) > 0 else "bajista"
    if strength < 0.4:
        return f"Tendencia lateral ({direction}). El movimiento puede no continuar."
    if strength < 0.7:
        return f"Tendencia {direction} moderada. Soporte a la continuación."
    return f"Tendencia {direction} fuerte. Mayor probabilidad de continuación."


def _volatility_explain(abs_pct: float, vol: float) -> str:
    # vol is annualized, ~0.3-1.0 typical for crypto
    typical_move = vol * 1.5  # rough rule of thumb
    if abs_pct < typical_move * 0.5:
        return f"Movimiento dentro del rango típico del activo (vol anual {vol*100:.0f}%)."
    if abs_pct < typical_move:
        return f"Movimiento en el extremo del rango típico. Anómalo pero no raro."
    return f"Movimiento fuera del rango histórico del activo. Evento significativo."


def _pattern_explain(winrate: float, n: int) -> str:
    if n < 5:
        return "Pocas muestras históricas. Señal exploratoria."
    if winrate >= 0.7:
        return f"Setups similares fueron rentables el {winrate*100:.0f}% de las veces ({n} muestras)."
    if winrate >= 0.5:
        return f"Setups similares rentables el {winrate*100:.0f}% de las veces ({n} muestras)."
    return f"Históricamente este patrón tiene winrate bajo ({winrate*100:.0f}%, {n} muestras)."


def _timing_explain(hour_utc: int, liq: float) -> str:
    if 13 <= hour_utc <= 21:
        return "Ventana de alta liquidez (overlap US/EU). Mejor fills."
    if 7 <= hour_utc <= 12:
        return "Ventana de liquidez europea. Aceptable."
    return "Ventana asiática o nocturna. Liquidez reducida, spreads más amplios."


def _trend_supports(t: AlertType, current: MarketTick) -> bool:
    change_24h = current.change_24h_pct or 0.0
    if t in (AlertType.PRICE_SURGE, AlertType.BREAKOUT):
        return change_24h >= -1.0
    if t == AlertType.PRICE_DUMP:
        return change_24h <= 1.0
    return True


def _volatility_regime_score(abs_pct: float, vol: float, current: MarketTick) -> float:
    """Higher score = the move is unusual for this asset's normal volatility."""
    if vol <= 0:
        return 0.5
    # Express abs move in units of daily-realized vol
    z = abs_pct / max(vol * 100 * 0.05, 0.1)  # 0.05 ≈ daily slice
    if z < 0.5:
        return 0.2
    if z < 1.0:
        return 0.5
    if z < 2.0:
        return 0.8
    return 1.0


def _pattern_score(winrate: float, n: int) -> float:
    if n == 0:
        return 0.5  # neutral prior
    # Bayesian-ish smoothing: pull toward 0.5 when n is small
    smoothed = (winrate * n + 0.5 * 5) / (n + 5)
    # Map [0, 1] to a points-friendly curve
    if smoothed < 0.45:
        return 0.3
    if smoothed < 0.55:
        return 0.5
    if smoothed < 0.65:
        return 0.7
    if smoothed < 0.75:
        return 0.85
    return 1.0


def _timing_score(hour_utc: int, liq_tier: float) -> float:
    base = 0.4
    if 13 <= hour_utc <= 21:
        base = 0.95
    elif 7 <= hour_utc <= 12:
        base = 0.75
    elif 21 < hour_utc <= 23:
        base = 0.55
    # Liquid assets still get good timing in low hours; illiquid ones don't
    return min(1.0, base * (0.6 + 0.4 * liq_tier))


def _confidence_from_factors(factors: List[ScoreFactor], ctx: ScoringContext) -> float:
    """Confidence in the score itself (not in the trade outcome)."""
    # High when factors agree (most points come from the same 2-3 factors).
    pts = sorted([f.points for f in factors], reverse=True)
    top_share = sum(pts[:2]) / max(sum(pts), 1)
    pattern_support = 1.0 if ctx.pattern_sample_size >= 10 else 0.6
    return round(min(1.0, 0.5 + top_share * 0.4 + pattern_support * 0.1), 3)


def _narrative(alert_type: AlertType, factors: List[ScoreFactor], total: int) -> str:
    # Identify the dominant factor(s)
    sorted_f = sorted(factors, key=lambda f: f.points, reverse=True)
    top = sorted_f[0]
    second = sorted_f[1] if len(sorted_f) > 1 else None
    if second and second.points > top.points * 0.6:
        return f"Setup dominado por {top.label.lower()} y {second.label.lower()}."
    return f"Setup dominado por {top.label.lower()}."
