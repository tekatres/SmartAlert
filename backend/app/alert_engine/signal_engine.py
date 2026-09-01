"""Trading Signal Engine — the decision-making brain.

Takes multi-timeframe kline data + futures market data, runs all 12
technical indicators, applies a confluence voting system, and emits
a structured LONG or SHORT trading signal when at least 7/12 indicators
agree. If confluence is below threshold, or Risk/Reward < 1.5, or there
is no trend (ADX < 20), no signal is emitted.

Signal quality philosophy:
  - Never enter a ranging (non-trending) market: ADX gate first.
  - Require broad agreement across timeframes and indicator families.
  - Size the trade to the asset's actual volatility (ATR-based TP/SL).
  - Recommend leverage inversely proportional to volatility.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

from app.alert_engine.indicators import (
    ADXResult,
    AllIndicators,
    compute_all,
)
from app.core.logging import get_logger
from app.services.binance_futures import MultiTimeframeKlines

logger = get_logger(__name__)

# --- Configuration ----------------------------------------------------------

MIN_CONFLUENCE = 8          # minimum votes needed out of 12 (institutional high-conviction)
MIN_RISK_REWARD = 1.8       # minimum R:R to emit a signal (positive expected value)
MIN_ADX = 20                # market must be trending
MIN_VOLUME_RATIO = 1.4      # minimum volume ratio vs 20-period average
ATR_SL_MULTIPLIER = 1.5     # stop-loss = entry ± ATR * 1.5
ATR_TP1_MULTIPLIER = 2.2    # take-profit 1 = entry ± ATR * 2.2 (50% close)
ATR_TP2_MULTIPLIER = 3.8    # take-profit 2 = entry ± ATR * 3.8 (100% close)
MAX_LEVERAGE = 20
MIN_LEVERAGE = 1
SIGNAL_EXPIRY_HOURS = 4     # signals older than 4h should be re-evaluated


@dataclass(frozen=True)
class SignalThresholds:
    """Engine gates. All values are tunable from the UI (engine_config).

    Lowering them emits more signals; raising them filters more out.
    """
    min_confluence: int = MIN_CONFLUENCE
    min_risk_reward: float = MIN_RISK_REWARD
    min_adx: float = MIN_ADX
    min_volume_ratio: float = MIN_VOLUME_RATIO


# --- Data structures --------------------------------------------------------

SignalDirection = Literal["LONG", "SHORT", "WAIT"]


@dataclass
class VoteResult:
    """One indicator's vote in the confluence system."""
    name: str              # e.g. "RSI Multi-Timeframe"
    vote: Literal["LONG", "SHORT", "NEUTRAL"]
    weight: int            # 1 (normal) or 2 (high-conviction indicator)
    value: float           # the raw indicator value shown to user
    explanation: str       # human-readable reason for the vote


@dataclass
class TradingSignal:
    """A fully analyzed trading signal ready for persistence and notification."""
    # Identity
    id: str
    coin_id: str
    symbol: str
    name: str

    # Decision
    direction: SignalDirection
    confluence_score: int       # number of weighted votes aligned
    confluence_total: int       # total possible weighted votes
    confidence: float           # confluence_score / confluence_total (0-1)

    # Entry & risk management
    entry_price: float
    leverage: int               # recommended leverage (1-20x)
    stop_loss: float
    take_profit_1: float        # partial close (50%)
    take_profit_2: float        # full close
    risk_reward: float
    atr: float                  # ATR used for level calculation

    # Stop-loss & TP as percentages (for easy display)
    sl_pct: float
    tp1_pct: float
    tp2_pct: float

    # Indicator breakdown (all 12 voters)
    votes: List[VoteResult] = field(default_factory=list)

    # Timeframe bias summary
    bias_15m: str = "NEUTRAL"
    bias_1h: str = "NEUTRAL"
    bias_4h: str = "NEUTRAL"

    # Futures-specific
    funding_rate: float = 0.0
    open_interest: float = 0.0

    # Setup label (for display / notification title)
    signal_type: str = ""

    # Lifecycle
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(hours=SIGNAL_EXPIRY_HOURS))

    # Tier (always free for personal use)
    min_tier: str = "free"


# --- Voting functions -------------------------------------------------------

def _vote_rsi_multi(ind: AllIndicators) -> VoteResult:
    """RSI agreement across 3 timeframes — weight 2 (most reliable)."""
    bullish = 0
    bearish = 0
    vals = []

    for label, r in [("15m", ind.rsi_15m), ("1h", ind.rsi_1h), ("4h", ind.rsi_4h)]:
        if r is None:
            continue
        vals.append(f"{label}={r.value:.0f}")
        if r.is_oversold:
            bullish += 1
        elif r.is_overbought:
            bearish += 1

    if bullish >= 2:
        vote, expl = "LONG", f"RSI sobrevendido en {bullish}/3 timeframes ({', '.join(vals)}). Presión vendedora agotada."
    elif bearish >= 2:
        vote, expl = "SHORT", f"RSI sobrecomprado en {bearish}/3 timeframes ({', '.join(vals)}). Presión compradora agotada."
    else:
        vote, expl = "NEUTRAL", f"RSI en zona neutral ({', '.join(vals)}). Sin señal clara."

    val = ind.rsi_1h.value if ind.rsi_1h else 50.0
    return VoteResult(name="RSI Multi-Timeframe", vote=vote, weight=2, value=val, explanation=expl)


def _vote_macd(ind: AllIndicators) -> VoteResult:
    """MACD crossover and histogram momentum — weight 2."""
    m = ind.macd_1h
    if m is None:
        return VoteResult("MACD 1h", "NEUTRAL", 2, 0.0, "MACD no disponible.")

    if m.is_bullish_cross:
        vote = "LONG"
        expl = f"MACD cruza al alza la señal (hist={m.histogram:+.6f}). Momentum alcista confirmado."
    elif m.is_bearish_cross:
        vote = "SHORT"
        expl = f"MACD cruza a la baja la señal (hist={m.histogram:+.6f}). Momentum bajista confirmado."
    elif m.histogram > 0 and m.histogram_rising:
        vote = "LONG"
        expl = f"Histograma MACD positivo y creciendo ({m.histogram:+.6f}). Momentum alcista."
    elif m.histogram < 0 and not m.histogram_rising:
        vote = "SHORT"
        expl = f"Histograma MACD negativo y cayendo ({m.histogram:+.6f}). Momentum bajista."
    else:
        vote = "NEUTRAL"
        expl = f"MACD sin señal clara (hist={m.histogram:+.6f}, línea={m.macd_line:.6f})."

    return VoteResult("MACD 1h", vote, 2, m.histogram, expl)


def _vote_ema_cross(ind: AllIndicators) -> VoteResult:
    """EMA alignment and golden/death cross — weight 2."""
    e = ind.ema_cross_1h
    if e is None:
        return VoteResult("EMA 9/21/50/200", "NEUTRAL", 2, 0.0, "Datos insuficientes para EMA 200.")

    if e.is_golden_cross:
        vote = "LONG"
        expl = f"Golden cross: EMA9 ({e.ema9:.2f}) cruzó sobre EMA50 ({e.ema50:.2f}). Señal alcista fuerte."
    elif e.is_death_cross:
        vote = "SHORT"
        expl = f"Death cross: EMA9 ({e.ema9:.2f}) cruzó bajo EMA50 ({e.ema50:.2f}). Señal bajista fuerte."
    elif e.is_bullish_alignment:
        vote = "LONG"
        expl = f"Alineación alcista EMA9>{e.ema9:.2f} > EMA21>{e.ema21:.2f} > EMA50>{e.ema50:.2f}. Tendencia alcista activa."
    elif e.is_bearish_alignment:
        vote = "SHORT"
        expl = f"Alineación bajista EMA9<{e.ema9:.2f} < EMA21<{e.ema21:.2f} < EMA50<{e.ema50:.2f}. Tendencia bajista activa."
    else:
        vote = "NEUTRAL"
        expl = "EMAs sin alineación clara. Mercado lateral o en transición."

    val = e.ema9
    return VoteResult("EMA 9/21/50/200", vote, 2, val, expl)


def _vote_bollinger(ind: AllIndicators, current_price: float) -> VoteResult:
    """Bollinger Bands squeeze and band touch — weight 1."""
    bb = ind.bollinger_1h
    if bb is None:
        return VoteResult("Bollinger Bands 1h", "NEUTRAL", 1, current_price, "Bollinger no disponible.")

    if bb.is_squeeze and bb.price_near_lower:
        vote = "LONG"
        expl = f"Squeeze + precio en banda inferior ({bb.lower:.2f}). Compresión → posible ruptura alcista."
    elif bb.is_squeeze and bb.price_near_upper:
        vote = "SHORT"
        expl = f"Squeeze + precio en banda superior ({bb.upper:.2f}). Compresión → posible ruptura bajista."
    elif bb.price_near_lower and not bb.is_squeeze:
        vote = "LONG"
        expl = f"Precio tocando banda inferior ({bb.lower:.2f}, %B={bb.percent_b:.2f}). Zona de soporte estadístico."
    elif bb.price_near_upper and not bb.is_squeeze:
        vote = "SHORT"
        expl = f"Precio tocando banda superior ({bb.upper:.2f}, %B={bb.percent_b:.2f}). Zona de resistencia estadística."
    else:
        vote = "NEUTRAL"
        expl = f"Precio en zona media de Bollinger (%B={bb.percent_b:.2f}). Sin señal en bandas."

    return VoteResult("Bollinger Bands 1h", vote, 1, bb.percent_b, expl)


def _vote_stoch_rsi(ind: AllIndicators) -> VoteResult:
    """Stochastic RSI — weight 1."""
    sr = ind.stoch_rsi_15m
    if sr is None:
        return VoteResult("Stochastic RSI 15m", "NEUTRAL", 1, 50.0, "StochRSI no disponible.")

    if sr.is_bullish_cross:
        vote = "LONG"
        expl = f"StochRSI cruce alcista desde zona sobrevendida (K={sr.k:.1f}, D={sr.d:.1f}). Setup de reversión."
    elif sr.is_bearish_cross:
        vote = "SHORT"
        expl = f"StochRSI cruce bajista desde zona sobrecomprada (K={sr.k:.1f}, D={sr.d:.1f}). Setup de reversión."
    elif sr.is_oversold:
        vote = "LONG"
        expl = f"StochRSI sobrevendido (K={sr.k:.1f}). Momentum a punto de girar al alza."
    elif sr.is_overbought:
        vote = "SHORT"
        expl = f"StochRSI sobrecomprado (K={sr.k:.1f}). Momentum a punto de girar a la baja."
    else:
        vote = "NEUTRAL"
        expl = f"StochRSI en zona neutral (K={sr.k:.1f}, D={sr.d:.1f})."

    return VoteResult("Stochastic RSI 15m", vote, 1, sr.k, expl)


def _vote_adx(adx_result: Optional[ADXResult], min_adx: float = MIN_ADX) -> VoteResult:
    """ADX trend filter — weight 2. Acts as gate: NEUTRAL if ADX < threshold."""
    if adx_result is None:
        return VoteResult("ADX 1h", "NEUTRAL", 2, 0.0, "ADX no disponible.")

    if not adx_result.has_trend or adx_result.adx < min_adx:
        vote = "NEUTRAL"
        expl = f"ADX={adx_result.adx:.1f} < {min_adx:.0f}. Mercado lateral. Sin tendencia — señal descartada."
    elif adx_result.is_bullish_trend:
        vote = "LONG"
        expl = f"ADX={adx_result.adx:.1f} con +DI={adx_result.plus_di:.1f} > -DI={adx_result.minus_di:.1f}. Tendencia alcista confirmada."
    elif adx_result.is_bearish_trend:
        vote = "SHORT"
        expl = f"ADX={adx_result.adx:.1f} con -DI={adx_result.minus_di:.1f} > +DI={adx_result.plus_di:.1f}. Tendencia bajista confirmada."
    else:
        vote = "NEUTRAL"
        expl = f"ADX={adx_result.adx:.1f}. Tendencia sin dirección clara."

    return VoteResult("ADX 1h", vote, 2, adx_result.adx, expl)


def _vote_obv(ind: AllIndicators) -> VoteResult:
    """OBV trend and divergence — weight 1."""
    o = ind.obv_1h
    if o is None:
        return VoteResult("OBV 1h", "NEUTRAL", 1, 0.0, "OBV no disponible.")

    if o.divergence_bullish:
        vote = "LONG"
        expl = "Divergencia alcista OBV: precio cae pero volumen acumula. Dinero inteligente comprando."
    elif o.divergence_bearish:
        vote = "SHORT"
        expl = "Divergencia bajista OBV: precio sube pero volumen distribuye. Dinero inteligente vendiendo."
    elif o.is_rising:
        vote = "LONG"
        expl = f"OBV en tendencia alcista (slope={o.slope:.2f}). Presión compradora dominante."
    else:
        vote = "SHORT"
        expl = f"OBV en tendencia bajista (slope={o.slope:.2f}). Presión vendedora dominante."

    return VoteResult("OBV 1h", vote, 1, o.slope, expl)


def _vote_vwap(ind: AllIndicators) -> VoteResult:
    """Price vs VWAP — weight 1."""
    v = ind.vwap_1h
    if v is None:
        return VoteResult("VWAP 1h", "NEUTRAL", 1, 0.0, "VWAP no disponible.")

    if v.price_above_vwap:
        vote = "LONG"
        expl = f"Precio ({v.current_price:.4f}) sobre VWAP ({v.vwap:.4f}, +{v.distance_pct:.2f}%). Mercado en zona compradora."
    else:
        vote = "SHORT"
        expl = f"Precio ({v.current_price:.4f}) bajo VWAP ({v.vwap:.4f}, {v.distance_pct:.2f}%). Mercado en zona vendedora."

    return VoteResult("VWAP 1h", vote, 1, v.distance_pct, expl)


def _vote_funding_rate(funding_rate: Optional[float]) -> VoteResult:
    """Funding rate sentiment — weight 1. Negative = shorts dominant → contrarian LONG."""
    if funding_rate is None:
        return VoteResult("Funding Rate", "NEUTRAL", 1, 0.0, "Funding rate no disponible.")

    fr_pct = funding_rate * 100.0
    if funding_rate <= -0.01:
        vote = "LONG"
        expl = f"Funding rate muy negativo ({fr_pct:.4f}%). Shorts atrapados → presión de cierre alcista."
    elif funding_rate < -0.005:
        vote = "LONG"
        expl = f"Funding rate negativo ({fr_pct:.4f}%). Más shorts que longs en el mercado."
    elif funding_rate >= 0.01:
        vote = "SHORT"
        expl = f"Funding rate muy positivo ({fr_pct:.4f}%). Longs atrapados → presión de cierre bajista."
    elif funding_rate > 0.005:
        vote = "SHORT"
        expl = f"Funding rate positivo ({fr_pct:.4f}%). Más longs que shorts en el mercado."
    else:
        vote = "NEUTRAL"
        expl = f"Funding rate neutro ({fr_pct:.4f}%). Sin sesgo claro de mercado."

    return VoteResult("Funding Rate", vote, 1, fr_pct, expl)


def _vote_open_interest(oi: Optional[float], oi_prev: Optional[float], price_change_pct: float) -> VoteResult:
    """Open Interest trend — weight 1. Rising OI + price = real trend."""
    if oi is None:
        return VoteResult("Open Interest", "NEUTRAL", 1, 0.0, "Open Interest no disponible.")

    if oi_prev and oi_prev > 0:
        oi_change_pct = ((oi - oi_prev) / oi_prev) * 100.0
    else:
        oi_change_pct = 0.0

    if oi_change_pct > 2.0 and price_change_pct > 0:
        vote = "LONG"
        expl = f"OI creciendo +{oi_change_pct:.2f}% con precio al alza. Nuevas posiciones largas entrando."
    elif oi_change_pct > 2.0 and price_change_pct < 0:
        vote = "SHORT"
        expl = f"OI creciendo +{oi_change_pct:.2f}% con precio a la baja. Nuevas posiciones cortas entrando."
    elif oi_change_pct < -2.0:
        vote = "NEUTRAL"
        expl = f"OI cayendo {oi_change_pct:.2f}%. Cierre de posiciones, tendencia puede estar agotándose."
    else:
        vote = "NEUTRAL"
        expl = f"OI sin cambios significativos ({oi_change_pct:+.2f}%). Mercado en equilibrio."

    return VoteResult("Open Interest", vote, 1, oi_change_pct, expl)


def _vote_cvd(ind: AllIndicators) -> VoteResult:
    """CVD (Cumulative Volume Delta) pressure — weight 1."""
    c = ind.cvd_1h
    if c is None:
        return VoteResult("CVD 1h", "NEUTRAL", 1, 0.0, "CVD no disponible.")

    if c.divergence_bullish:
        vote = "LONG"
        expl = "Divergencia alcista CVD: precio bajando pero compradores absorbiendo. Acumulación silenciosa."
    elif c.divergence_bearish:
        vote = "SHORT"
        expl = "Divergencia bajista CVD: precio subiendo pero vendedores presionando. Distribución encubierta."
    elif c.is_rising:
        vote = "LONG"
        expl = f"CVD en acumulación (slope={c.slope:.2f}). Más volumen comprador que vendedor."
    else:
        vote = "SHORT"
        expl = f"CVD en distribución (slope={c.slope:.2f}). Más volumen vendedor que comprador."

    return VoteResult("CVD 1h", vote, 1, c.slope, expl)


# --- Risk / trade management ------------------------------------------------

def _calculate_leverage(atr_pct_val: float) -> int:
    """Recommend leverage inversely proportional to volatility.

    Formula: leverage = floor(10 / atr_pct)
    - atr_pct = 0.5% → 20x  (very low volatility, tight asset)
    - atr_pct = 1.0% → 10x
    - atr_pct = 2.0% →  5x
    - atr_pct = 5.0% →  2x
    """
    if atr_pct_val <= 0:
        return MIN_LEVERAGE
    leverage = math.floor(10.0 / atr_pct_val)
    return max(MIN_LEVERAGE, min(MAX_LEVERAGE, leverage))


def _calculate_levels(
    entry: float,
    atr_val: float,
    direction: str,
) -> tuple[float, float, float, float]:
    """Compute stop-loss, TP1, TP2 and risk/reward ratio.

    Returns: (stop_loss, take_profit_1, take_profit_2, risk_reward)
    """
    sl_dist = atr_val * ATR_SL_MULTIPLIER
    tp1_dist = atr_val * ATR_TP1_MULTIPLIER
    tp2_dist = atr_val * ATR_TP2_MULTIPLIER

    if direction == "LONG":
        sl = entry - sl_dist
        tp1 = entry + tp1_dist
        tp2 = entry + tp2_dist
    else:  # SHORT
        sl = entry + sl_dist
        tp1 = entry - tp1_dist
        tp2 = entry - tp2_dist

    rr = tp1_dist / sl_dist if sl_dist > 0 else 0.0
    return sl, tp1, tp2, round(rr, 2)


def _pct_distance(entry: float, target: float) -> float:
    """Percentage distance between entry and a level."""
    if entry <= 0:
        return 0.0
    return round(abs((target - entry) / entry) * 100.0, 2)


def _timeframe_bias(
    rsi_val: Optional[object],
    macd_val: Optional[object],
) -> str:
    bullish = 0
    bearish = 0
    if rsi_val is not None:
        if rsi_val.is_oversold:
            bullish += 1
        elif rsi_val.is_overbought:
            bearish += 1
    if macd_val is not None:
        if macd_val.histogram > 0:
            bullish += 1
        else:
            bearish += 1
    if bullish > bearish:
        return "LONG"
    if bearish > bullish:
        return "SHORT"
    return "NEUTRAL"


def _label_signal(votes: List[VoteResult], direction: str) -> str:
    """Generate a short textual label describing the dominant setup."""
    aligned = [v for v in votes if v.vote == direction]
    names = [v.name for v in sorted(aligned, key=lambda x: x.weight, reverse=True)[:2]]
    label = " + ".join(n.split()[0].upper() for n in names)
    return f"{direction}_{label}" if label else direction


# --- Bar analysis (threshold-independent) ----------------------------------

@dataclass
class BarAnalysis:
    """Raw per-bar analysis: votes, levels and score, BEFORE applying gates.

    Threshold-independent so the backtester can compute it once per bar and
    then grid-search over signal thresholds cheaply.
    """
    coin_id: str
    symbol: str
    direction: str
    confluence_score: int
    confluence_total: int
    long_score: int
    short_score: int
    entry_price: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    risk_reward: float
    atr: float
    atr_pct: float
    leverage: int
    adx: float
    adx_result: Optional[ADXResult]
    votes: List[VoteResult] = field(default_factory=list)
    bias_15m: str = "NEUTRAL"
    bias_1h: str = "NEUTRAL"
    bias_4h: str = "NEUTRAL"
    funding_rate: float = 0.0
    open_interest: float = 0.0


def analyze_bar(
    mtf: MultiTimeframeKlines,
    previous_oi: Optional[float] = None,
) -> Optional[BarAnalysis]:
    """Compute the full indicator/vote breakdown for a single bar snapshot.

    Unlike `analyze`, this NEVER applies signal gates (ADX/confluence/RR),
    so it can be reused for backtesting and grid search.
    """
    if not mtf.candles_1h or len(mtf.candles_1h) < 50:
        return None

    ind = compute_all(mtf.candles_15m, mtf.candles_1h, mtf.candles_4h)
    current_price = mtf.candles_1h[-1].close

    atr_val = ind.atr_1h
    atr_pct_val = ind.atr_pct_1h
    if atr_val is None or atr_pct_val is None or atr_val <= 0:
        return None

    funding_rate = mtf.funding_rate.funding_rate if mtf.funding_rate else None
    oi_current = mtf.open_interest.open_interest if mtf.open_interest else None

    price_change_pct = 0.0
    if len(mtf.candles_1h) >= 2:
        prev_close = mtf.candles_1h[-2].close
        if prev_close > 0:
            price_change_pct = ((current_price - prev_close) / prev_close) * 100.0

    votes: List[VoteResult] = [
        _vote_rsi_multi(ind),
        _vote_macd(ind),
        _vote_ema_cross(ind),
        _vote_bollinger(ind, current_price),
        _vote_stoch_rsi(ind),
        _vote_adx(ind.adx_1h, MIN_ADX),  # default ADX vote; `decide` recomputes it
        _vote_obv(ind),
        _vote_vwap(ind),
        _vote_funding_rate(funding_rate),
        _vote_open_interest(oi_current, previous_oi, price_change_pct),
        _vote_cvd(ind),
    ]

    long_score = sum(v.weight for v in votes if v.vote == "LONG")
    short_score = sum(v.weight for v in votes if v.vote == "SHORT")
    total_weight = sum(v.weight for v in votes)

    direction: SignalDirection = "LONG" if long_score >= short_score else "SHORT"
    confluence_score = long_score if direction == "LONG" else short_score

    sl, tp1, tp2, rr = _calculate_levels(current_price, atr_val, direction)
    leverage = _calculate_leverage(atr_pct_val)

    return BarAnalysis(
        coin_id=mtf.coin_id,
        symbol=mtf.symbol,
        direction=direction,
        confluence_score=confluence_score,
        confluence_total=total_weight,
        long_score=long_score,
        short_score=short_score,
        entry_price=current_price,
        stop_loss=sl,
        take_profit_1=tp1,
        take_profit_2=tp2,
        risk_reward=rr,
        atr=atr_val,
        atr_pct=atr_pct_val,
        leverage=leverage,
        adx=ind.adx_1h.adx if ind.adx_1h else 0.0,
        adx_result=ind.adx_1h,
        votes=votes,
        bias_15m=_timeframe_bias(ind.rsi_15m, None),
        bias_1h=_timeframe_bias(ind.rsi_1h, ind.macd_1h),
        bias_4h=_timeframe_bias(ind.rsi_4h, None),
        funding_rate=funding_rate or 0.0,
        open_interest=oi_current or 0.0,
    )


# --- Decision (applies thresholds to a BarAnalysis) -------------------------

def decide(
    mtf: MultiTimeframeKlines,
    coin_name: str,
    bar: BarAnalysis,
    thresholds: Optional[SignalThresholds] = None,
) -> Optional[TradingSignal]:
    """Turn a BarAnalysis into a TradignSignal if it passes the configured gates."""
    t = thresholds or SignalThresholds()

    if bar.adx < t.min_adx:
        logger.debug("analyze %s: ADX=%.1f < %.1f, no trend", mtf.symbol, bar.adx, t.min_adx)
        return None

    # Recomputed ADX vote so the vote reflects the configured ADX threshold.
    votes = [v for v in bar.votes if v.name != "ADX 1h"]
    votes.append(_vote_adx(bar.adx_result, t.min_adx))

    long_score = sum(v.weight for v in votes if v.vote == "LONG")
    short_score = sum(v.weight for v in votes if v.vote == "SHORT")
    total_weight = sum(v.weight for v in votes)

    direction: SignalDirection = "LONG" if long_score >= short_score else "SHORT"
    confluence_score = long_score if direction == "LONG" else short_score

    if confluence_score < t.min_confluence:
        logger.debug(
            "analyze %s: confluence %d/%d < %d threshold",
            mtf.symbol, confluence_score, total_weight, t.min_confluence,
        )
        return None

    if bar.risk_reward < t.min_risk_reward:
        logger.debug("analyze %s: R:R=%.2f < %.2f", mtf.symbol, bar.risk_reward, t.min_risk_reward)
        return None

    confidence = confluence_score / total_weight if total_weight > 0 else 0.0
    signal_type = _label_signal(votes, direction)
    now = datetime.now(timezone.utc)

    signal = TradingSignal(
        id=_make_signal_id(mtf.coin_id, direction, now),
        coin_id=mtf.coin_id,
        symbol=mtf.symbol.replace("USDT", ""),
        name=coin_name,
        direction=direction,
        confluence_score=confluence_score,
        confluence_total=total_weight,
        confidence=round(confidence, 3),
        entry_price=round(bar.entry_price, 6),
        leverage=bar.leverage,
        stop_loss=round(bar.stop_loss, 6),
        take_profit_1=round(bar.take_profit_1, 6),
        take_profit_2=round(bar.take_profit_2, 6),
        risk_reward=bar.risk_reward,
        atr=round(bar.atr, 6),
        sl_pct=_pct_distance(bar.entry_price, bar.stop_loss),
        tp1_pct=_pct_distance(bar.entry_price, bar.take_profit_1),
        tp2_pct=_pct_distance(bar.entry_price, bar.take_profit_2),
        votes=votes,
        bias_15m=bar.bias_15m,
        bias_1h=bar.bias_1h,
        bias_4h=bar.bias_4h,
        funding_rate=bar.funding_rate,
        open_interest=bar.open_interest,
        signal_type=signal_type,
    )

    logger.info(
        "Signal %s %s | confluence=%d/%d | lev=%dx | RR=%.2f | entry=%.4f SL=%.4f TP1=%.4f",
        direction, mtf.symbol, confluence_score, total_weight,
        bar.leverage, bar.risk_reward, bar.entry_price, bar.stop_loss, bar.take_profit_1,
    )
    return signal


# --- Main entry point -------------------------------------------------------

def analyze(
    mtf: MultiTimeframeKlines,
    coin_name: str,
    previous_oi: Optional[float] = None,
    thresholds: Optional[SignalThresholds] = None,
) -> Optional[TradingSignal]:
    """Analyze a coin's multi-timeframe data and return a TradingSignal or None.

    Returns None when:
    - Not enough data to compute indicators
    - ADX < threshold (no trend — never trade a ranging market)
    - Confluence < threshold (weighted votes)
    - Risk/Reward < threshold
    """
    bar = analyze_bar(mtf, previous_oi=previous_oi)
    if bar is None:
        return None
    return decide(mtf, coin_name, bar, thresholds)


def _make_signal_id(coin_id: str, direction: str, ts: datetime) -> str:
    import hashlib
    raw = f"signal:{coin_id}:{direction}:{ts.strftime('%Y%m%d%H%M')}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]
