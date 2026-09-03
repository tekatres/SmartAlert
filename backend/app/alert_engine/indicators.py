"""Technical indicators — pure Python, zero external dependencies.

All functions operate on plain Python lists of floats (OHLCV data from
Binance klines). Each function returns either a scalar (the most recent
value) or a small named tuple when multiple values are needed (e.g. MACD).

Design choices:
- No numpy / pandas — keeps the Docker image light and builds fast.
- All algorithms are standard, battle-tested formulations.
- Functions return None / empty when there is not enough data.
- O(n) time for all indicators.
"""
from __future__ import annotations

import math
from typing import List, NamedTuple, Optional

from app.services.binance_futures import Candle


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _closes(candles: List[Candle]) -> List[float]:
    return [c.close for c in candles]

def _highs(candles: List[Candle]) -> List[float]:
    return [c.high for c in candles]

def _lows(candles: List[Candle]) -> List[float]:
    return [c.low for c in candles]

def _volumes(candles: List[Candle]) -> List[float]:
    return [c.volume for c in candles]

def _quote_volumes(candles: List[Candle]) -> List[float]:
    return [c.quote_volume for c in candles]

def _taker_buy_volumes(candles: List[Candle]) -> List[float]:
    return [c.taker_buy_volume for c in candles]


# ---------------------------------------------------------------------------
# EMA — Exponential Moving Average
# ---------------------------------------------------------------------------

def ema(values: List[float], period: int) -> List[float]:
    """Compute EMA for a list of values. Returns list of same length (NaN-padded at start)."""
    if len(values) < period:
        return []
    k = 2.0 / (period + 1)
    result: List[float] = []
    # Seed with SMA of first `period` values
    sma = sum(values[:period]) / period
    result.append(sma)
    for v in values[period:]:
        result.append(v * k + result[-1] * (1 - k))
    # Prepend NaN placeholders so indices align with input
    return [float("nan")] * (period - 1) + result


def ema_value(values: List[float], period: int) -> Optional[float]:
    """Return only the most recent EMA value."""
    series = ema(values, period)
    if not series:
        return None
    # Find last non-nan
    for v in reversed(series):
        if not math.isnan(v):
            return v
    return None


# ---------------------------------------------------------------------------
# RSI — Relative Strength Index (Wilder smoothing)
# ---------------------------------------------------------------------------

class RSIResult(NamedTuple):
    value: float          # 0-100
    is_oversold: bool     # < 30
    is_overbought: bool   # > 70
    is_near_oversold: bool   # 30-40 — pre-señal alcista
    is_near_overbought: bool  # 60-70 — pre-señal bajista
    divergence_bullish: bool  # precio hace mínimo más bajo pero RSI no → reversión alcista
    divergence_bearish: bool  # precio hace máximo más alto pero RSI no → reversión bajista


def rsi(candles: List[Candle], period: int = 14) -> Optional[RSIResult]:
    """Compute RSI using Wilder's smoothing method with divergence detection."""
    closes = _closes(candles)
    if len(closes) < period + 1:
        return None

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]

    # Initial averages (simple mean for seed)
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    # Wilder smoothing — build full RSI series for divergence detection
    rsi_series: List[float] = []
    # Seed value
    if avg_loss == 0:
        rsi_series.append(100.0)
    else:
        rs = avg_gain / avg_loss
        rsi_series.append(100.0 - (100.0 / (1.0 + rs)))

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            rsi_series.append(100.0)
        else:
            rs = avg_gain / avg_loss
            rsi_series.append(100.0 - (100.0 / (1.0 + rs)))

    value = rsi_series[-1]

    # Divergence detection: compare last 2 swing lows/highs (price vs RSI)
    # Use last 10 candles to find recent price extremes vs RSI extremes
    div_bullish = False
    div_bearish = False
    lookback = min(20, len(closes) - 1, len(rsi_series) - 1)
    if lookback >= 10:
        recent_closes = closes[-lookback:]
        recent_rsi = rsi_series[-lookback:]
        # Bullish divergence: price makes lower low but RSI makes higher low
        price_low_1 = min(recent_closes[:lookback // 2])
        price_low_2 = min(recent_closes[lookback // 2:])
        rsi_low_1 = min(recent_rsi[:lookback // 2])
        rsi_low_2 = min(recent_rsi[lookback // 2:])
        div_bullish = (price_low_2 < price_low_1 and rsi_low_2 > rsi_low_1 and value < 50)
        # Bearish divergence: price makes higher high but RSI makes lower high
        price_high_1 = max(recent_closes[:lookback // 2])
        price_high_2 = max(recent_closes[lookback // 2:])
        rsi_high_1 = max(recent_rsi[:lookback // 2])
        rsi_high_2 = max(recent_rsi[lookback // 2:])
        div_bearish = (price_high_2 > price_high_1 and rsi_high_2 < rsi_high_1 and value > 50)

    return RSIResult(
        value=round(value, 2),
        is_oversold=value < 30,
        is_overbought=value > 70,
        is_near_oversold=(30 <= value < 40),
        is_near_overbought=(60 < value <= 70),
        divergence_bullish=div_bullish,
        divergence_bearish=div_bearish,
    )


# ---------------------------------------------------------------------------
# MACD — Moving Average Convergence/Divergence
# ---------------------------------------------------------------------------

class MACDResult(NamedTuple):
    macd_line: float
    signal_line: float
    histogram: float
    is_bullish_cross: bool   # macd just crossed above signal
    is_bearish_cross: bool   # macd just crossed below signal
    histogram_rising: bool   # histogram increasing (momentum building)
    histogram_significant: bool  # abs(histogram) > 0.05% of price — filters ghost votes


def macd(
    candles: List[Candle],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Optional[MACDResult]:
    """Compute MACD line, signal line and histogram."""
    closes = _closes(candles)
    if len(closes) < slow + signal:
        return None

    fast_ema = ema(closes, fast)
    slow_ema = ema(closes, slow)

    # MACD line = fast EMA - slow EMA (only where both are valid)
    macd_line_series: List[float] = []
    for f, s in zip(fast_ema, slow_ema):
        if math.isnan(f) or math.isnan(s):
            macd_line_series.append(float("nan"))
        else:
            macd_line_series.append(f - s)

    # Remove leading nans for signal EMA calculation
    valid_macd = [v for v in macd_line_series if not math.isnan(v)]
    if len(valid_macd) < signal:
        return None

    signal_series = ema(valid_macd, signal)
    valid_signal = [v for v in signal_series if not math.isnan(v)]
    if not valid_signal:
        return None

    macd_val = valid_macd[-1]
    signal_val = valid_signal[-1]
    hist = macd_val - signal_val

    # Detect crossover using previous values
    prev_macd = valid_macd[-2] if len(valid_macd) >= 2 else macd_val
    prev_signal = valid_signal[-2] if len(valid_signal) >= 2 else signal_val
    prev_hist = prev_macd - prev_signal

    # Histogram significance: must be > 0.05% of MACD line magnitude to avoid ghost votes
    # Use the slow EMA as a price proxy for relative magnitude
    valid_slow = [v for v in slow_ema if not math.isnan(v)]
    price_proxy = abs(valid_slow[-1]) if valid_slow else 1.0
    hist_pct = (abs(hist) / price_proxy * 100.0) if price_proxy > 0 else 0.0
    significant = hist_pct > 0.01  # > 0.01% of slow EMA value

    return MACDResult(
        macd_line=round(macd_val, 6),
        signal_line=round(signal_val, 6),
        histogram=round(hist, 6),
        is_bullish_cross=(prev_macd < prev_signal and macd_val >= signal_val),
        is_bearish_cross=(prev_macd > prev_signal and macd_val <= signal_val),
        histogram_rising=(hist > prev_hist),
        histogram_significant=significant,
    )


# ---------------------------------------------------------------------------
# Bollinger Bands
# ---------------------------------------------------------------------------

class BollingerResult(NamedTuple):
    upper: float
    middle: float   # SMA
    lower: float
    bandwidth: float         # (upper - lower) / middle — squeeze indicator
    percent_b: float         # 0=at lower, 1=at upper, >1 or <0 = breakout
    is_squeeze: bool         # bandwidth < historical avg (compression)
    price_near_lower: bool   # price within 1% of lower band
    price_near_upper: bool   # price within 1% of upper band


def bollinger_bands(
    candles: List[Candle],
    period: int = 20,
    std_dev: float = 2.0,
) -> Optional[BollingerResult]:
    """Compute Bollinger Bands and derived signals."""
    closes = _closes(candles)
    if len(closes) < period:
        return None

    window = closes[-period:]
    sma = sum(window) / period
    variance = sum((x - sma) ** 2 for x in window) / period
    std = math.sqrt(variance)

    upper = sma + std_dev * std
    lower = sma - std_dev * std
    bandwidth = (upper - lower) / sma if sma > 0 else 0.0

    # percent_b: where is current price relative to the bands
    current = closes[-1]
    band_range = upper - lower
    percent_b = (current - lower) / band_range if band_range > 0 else 0.5

    # Squeeze: compare current bandwidth to average bandwidth of last 50 candles
    squeeze_window = closes[-50:] if len(closes) >= 50 else closes
    bandwidths: List[float] = []
    for i in range(period, len(squeeze_window) + 1):
        w = squeeze_window[max(0, i - period):i]
        if len(w) < period:
            continue
        m = sum(w) / period
        v = sum((x - m) ** 2 for x in w) / period
        bw = (math.sqrt(v) * 2 * std_dev) / m if m > 0 else 0.0
        bandwidths.append(bw)
    avg_bw = sum(bandwidths) / len(bandwidths) if bandwidths else bandwidth
    is_squeeze = bandwidth < avg_bw * 0.75  # bandwidth compressed to <75% of avg

    return BollingerResult(
        upper=round(upper, 6),
        middle=round(sma, 6),
        lower=round(lower, 6),
        bandwidth=round(bandwidth, 4),
        percent_b=round(percent_b, 4),
        is_squeeze=is_squeeze,
        price_near_lower=current <= lower * 1.01,
        price_near_upper=current >= upper * 0.99,
    )


# ---------------------------------------------------------------------------
# ATR — Average True Range
# ---------------------------------------------------------------------------

def atr(candles: List[Candle], period: int = 14) -> Optional[float]:
    """Compute ATR using Wilder's smoothing. Returns the current ATR value."""
    if len(candles) < period + 1:
        return None

    highs = _highs(candles)
    lows = _lows(candles)
    closes = _closes(candles)

    true_ranges: List[float] = []
    for i in range(1, len(candles)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        true_ranges.append(tr)

    # Seed with simple average
    atr_val = sum(true_ranges[:period]) / period
    for tr in true_ranges[period:]:
        atr_val = (atr_val * (period - 1) + tr) / period

    return round(atr_val, 6)


def atr_pct(candles: List[Candle], period: int = 14) -> Optional[float]:
    """ATR as percentage of current price (used for leverage calculation)."""
    atr_val = atr(candles, period)
    if atr_val is None or not candles:
        return None
    current_price = candles[-1].close
    if current_price <= 0:
        return None
    return round((atr_val / current_price) * 100.0, 4)


# ---------------------------------------------------------------------------
# Stochastic RSI
# ---------------------------------------------------------------------------

class StochRSIResult(NamedTuple):
    k: float    # fast %K (0-100)
    d: float    # slow %D — signal line
    is_oversold: bool    # k < 20
    is_overbought: bool  # k > 80
    is_bullish_cross: bool   # k crossed above d from oversold
    is_bearish_cross: bool   # k crossed below d from overbought


def stochastic_rsi(
    candles: List[Candle],
    rsi_period: int = 14,
    stoch_period: int = 14,
    smooth_k: int = 3,
    smooth_d: int = 3,
) -> Optional[StochRSIResult]:
    """Compute Stochastic RSI."""
    closes = _closes(candles)
    min_len = rsi_period + stoch_period + smooth_k + smooth_d + 5
    if len(closes) < min_len:
        return None

    # Compute rolling RSI series
    rsi_series: List[float] = []
    for i in range(rsi_period, len(closes)):
        subset = [Candle(
            timestamp=candles[j].timestamp,
            open=candles[j].open, high=candles[j].high,
            low=candles[j].low, close=closes[j],
            volume=candles[j].volume, quote_volume=candles[j].quote_volume,
            taker_buy_volume=candles[j].taker_buy_volume,
        ) for j in range(i - rsi_period, i + 1)]
        r = rsi(subset, rsi_period)
        if r is not None:
            rsi_series.append(r.value)

    if len(rsi_series) < stoch_period:
        return None

    # Stochastic of RSI
    stoch_k_raw: List[float] = []
    for i in range(stoch_period - 1, len(rsi_series)):
        window = rsi_series[i - stoch_period + 1:i + 1]
        lowest = min(window)
        highest = max(window)
        rng = highest - lowest
        k = ((rsi_series[i] - lowest) / rng * 100.0) if rng > 0 else 50.0
        stoch_k_raw.append(k)

    if len(stoch_k_raw) < smooth_k + smooth_d:
        return None

    # Smooth %K
    smooth_k_series = ema(stoch_k_raw, smooth_k)
    valid_k = [v for v in smooth_k_series if not math.isnan(v)]
    if len(valid_k) < smooth_d:
        return None

    # Smooth %D (signal of %K)
    smooth_d_series = ema(valid_k, smooth_d)
    valid_d = [v for v in smooth_d_series if not math.isnan(v)]
    if not valid_d:
        return None

    k_val = valid_k[-1]
    d_val = valid_d[-1]
    prev_k = valid_k[-2] if len(valid_k) >= 2 else k_val
    prev_d = valid_d[-2] if len(valid_d) >= 2 else d_val

    return StochRSIResult(
        k=round(k_val, 2),
        d=round(d_val, 2),
        is_oversold=k_val < 20,
        is_overbought=k_val > 80,
        is_bullish_cross=(prev_k < prev_d and k_val >= d_val and k_val < 50),
        is_bearish_cross=(prev_k > prev_d and k_val <= d_val and k_val > 50),
    )


# ---------------------------------------------------------------------------
# ADX — Average Directional Index (Wilder)
# ---------------------------------------------------------------------------

class ADXResult(NamedTuple):
    adx: float     # 0-100, >20 = trending, >40 = strong trend
    plus_di: float   # +DI — bullish directional indicator
    minus_di: float  # -DI — bearish directional indicator
    has_trend: bool  # ADX > 20
    is_bullish_trend: bool   # +DI > -DI and ADX > 20
    is_bearish_trend: bool   # -DI > +DI and ADX > 20


def adx(candles: List[Candle], period: int = 14) -> Optional[ADXResult]:
    """Compute ADX, +DI and -DI using Wilder's method."""
    if len(candles) < period * 2 + 1:
        return None

    highs = _highs(candles)
    lows = _lows(candles)
    closes = _closes(candles)

    plus_dm: List[float] = []
    minus_dm: List[float] = []
    true_ranges: List[float] = []

    for i in range(1, len(candles)):
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0.0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0.0)
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        true_ranges.append(tr)

    # Wilder smoothing
    def _wilder_sum(values: List[float], p: int) -> List[float]:
        result = [sum(values[:p])]
        for v in values[p:]:
            result.append(result[-1] - result[-1] / p + v)
        return result

    atr_smooth = _wilder_sum(true_ranges, period)
    plus_smooth = _wilder_sum(plus_dm, period)
    minus_smooth = _wilder_sum(minus_dm, period)

    if not atr_smooth:
        return None

    plus_di_series: List[float] = []
    minus_di_series: List[float] = []
    dx_series: List[float] = []

    for a, p, m in zip(atr_smooth, plus_smooth, minus_smooth):
        if a == 0:
            continue
        pdi = (p / a) * 100.0
        mdi = (m / a) * 100.0
        plus_di_series.append(pdi)
        minus_di_series.append(mdi)
        di_diff = abs(pdi - mdi)
        di_sum = pdi + mdi
        dx_series.append((di_diff / di_sum * 100.0) if di_sum > 0 else 0.0)

    if len(dx_series) < period:
        return None

    # ADX = smoothed DX
    adx_val = sum(dx_series[:period]) / period
    for dx in dx_series[period:]:
        adx_val = (adx_val * (period - 1) + dx) / period

    pdi = plus_di_series[-1]
    mdi = minus_di_series[-1]

    return ADXResult(
        adx=round(adx_val, 2),
        plus_di=round(pdi, 2),
        minus_di=round(mdi, 2),
        has_trend=adx_val > 20,
        is_bullish_trend=(pdi > mdi and adx_val > 20),
        is_bearish_trend=(mdi > pdi and adx_val > 20),
    )


# ---------------------------------------------------------------------------
# OBV — On-Balance Volume
# ---------------------------------------------------------------------------

class OBVResult(NamedTuple):
    current: float
    slope: float           # linear slope of last 10 OBV values (positive = accumulation)
    is_rising: bool        # OBV trending up
    divergence_bullish: bool   # price falling but OBV rising
    divergence_bearish: bool   # price rising but OBV falling


def obv(candles: List[Candle]) -> Optional[OBVResult]:
    """Compute On-Balance Volume and detect divergences."""
    if len(candles) < 20:
        return None

    closes = _closes(candles)
    volumes = _volumes(candles)

    obv_series: List[float] = [0.0]
    for i in range(1, len(candles)):
        if closes[i] > closes[i - 1]:
            obv_series.append(obv_series[-1] + volumes[i])
        elif closes[i] < closes[i - 1]:
            obv_series.append(obv_series[-1] - volumes[i])
        else:
            obv_series.append(obv_series[-1])

    # Linear slope of last 10 OBV values
    window = 10
    recent_obv = obv_series[-window:]
    n = len(recent_obv)
    x_mean = (n - 1) / 2.0
    y_mean = sum(recent_obv) / n
    numerator = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent_obv))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    slope = numerator / denominator if denominator != 0 else 0.0

    # Divergence: compare price direction vs OBV direction over last 10 candles
    price_change = closes[-1] - closes[-window]
    obv_change = obv_series[-1] - obv_series[-window]

    # Neutral zone: slope is insignificant relative to the OBV magnitude
    obv_magnitude = abs(obv_series[-1]) if obv_series[-1] != 0 else 1.0
    slope_threshold = obv_magnitude * 0.005  # 0.5% of current OBV value
    is_rising_meaningful = slope > slope_threshold
    is_falling_meaningful = slope < -slope_threshold

    return OBVResult(
        current=round(obv_series[-1], 2),
        slope=round(slope, 4),
        is_rising=is_rising_meaningful,
        divergence_bullish=(price_change < 0 and obv_change > 0),
        divergence_bearish=(price_change > 0 and obv_change < 0),
    )


# ---------------------------------------------------------------------------
# VWAP — Volume Weighted Average Price
# ---------------------------------------------------------------------------

class VWAPResult(NamedTuple):
    vwap: float
    current_price: float
    price_above_vwap: bool   # bullish: price > VWAP
    distance_pct: float      # % distance from VWAP (positive = above)


def vwap(candles: List[Candle]) -> Optional[VWAPResult]:
    """Compute VWAP over the provided candles (intraday session)."""
    if not candles:
        return None

    total_pv = 0.0
    total_vol = 0.0
    for c in candles:
        typical_price = (c.high + c.low + c.close) / 3.0
        total_pv += typical_price * c.quote_volume
        total_vol += c.quote_volume

    if total_vol == 0:
        return None

    vwap_val = total_pv / total_vol
    current = candles[-1].close
    distance = ((current - vwap_val) / vwap_val * 100.0) if vwap_val > 0 else 0.0

    return VWAPResult(
        vwap=round(vwap_val, 6),
        current_price=round(current, 6),
        price_above_vwap=current > vwap_val,
        distance_pct=round(distance, 4),
    )


# ---------------------------------------------------------------------------
# CVD — Cumulative Volume Delta
# ---------------------------------------------------------------------------

class CVDResult(NamedTuple):
    cumulative: float     # total buy pressure minus sell pressure
    slope: float          # trend of CVD over last 10 candles
    is_rising: bool       # more buying than selling recently
    divergence_bullish: bool  # price down but CVD rising
    divergence_bearish: bool  # price up but CVD falling


def cvd(candles: List[Candle]) -> Optional[CVDResult]:
    """Compute Cumulative Volume Delta.

    CVD = sum(buy_volume - sell_volume) per candle.
    Approximation: taker_buy_volume = buy_vol; (volume - taker_buy) = sell_vol.
    """
    if len(candles) < 20:
        return None

    closes = _closes(candles)
    delta_series: List[float] = []
    for c in candles:
        sell_vol = c.volume - c.taker_buy_volume
        delta_series.append(c.taker_buy_volume - sell_vol)

    # Cumulative sum
    cvd_series: List[float] = []
    running = 0.0
    for d in delta_series:
        running += d
        cvd_series.append(running)

    # Slope of last 10 values
    window = 10
    recent = cvd_series[-window:]
    n = len(recent)
    x_mean = (n - 1) / 2.0
    y_mean = sum(recent) / n
    num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent))
    den = sum((i - x_mean) ** 2 for i in range(n))
    slope = num / den if den != 0 else 0.0

    price_change = closes[-1] - closes[-window]
    cvd_change = cvd_series[-1] - cvd_series[-window]

    # Neutral zone: slope insignificant relative to CVD magnitude
    cvd_magnitude = abs(cvd_series[-1]) if cvd_series[-1] != 0 else 1.0
    slope_threshold = cvd_magnitude * 0.005  # 0.5% of current CVD value
    is_rising_meaningful = slope > slope_threshold

    return CVDResult(
        cumulative=round(cvd_series[-1], 2),
        slope=round(slope, 4),
        is_rising=is_rising_meaningful,
        divergence_bullish=(price_change < 0 and cvd_change > 0),
        divergence_bearish=(price_change > 0 and cvd_change < 0),
    )


# ---------------------------------------------------------------------------
# EMA Cross (Golden / Death Cross)
# ---------------------------------------------------------------------------

class EMACrossResult(NamedTuple):
    ema9: float
    ema21: float
    ema50: float
    ema200: float
    is_golden_cross: bool     # ema9 crossed above ema50 recently
    is_death_cross: bool      # ema9 crossed below ema50 recently
    is_bullish_alignment: bool  # ema9 > ema21 > ema50 (uptrend structure)
    is_bearish_alignment: bool  # ema9 < ema21 < ema50 (downtrend structure)
    price_above_ema200: bool  # long-term trend filter


def ema_cross(candles: List[Candle]) -> Optional[EMACrossResult]:
    """Compute EMA 9/21/50/200 and detect cross signals."""
    closes = _closes(candles)
    if len(closes) < 200:
        return None

    e9 = ema(closes, 9)
    e21 = ema(closes, 21)
    e50 = ema(closes, 50)
    e200 = ema(closes, 200)

    def _last_valid(series: List[float]) -> Optional[float]:
        for v in reversed(series):
            if not math.isnan(v):
                return v
        return None

    def _prev_valid(series: List[float]) -> Optional[float]:
        found = 0
        for v in reversed(series):
            if not math.isnan(v):
                found += 1
                if found == 2:
                    return v
        return None

    v9 = _last_valid(e9)
    v21 = _last_valid(e21)
    v50 = _last_valid(e50)
    v200 = _last_valid(e200)
    p9 = _prev_valid(e9)
    p50 = _prev_valid(e50)

    if any(v is None for v in [v9, v21, v50, v200]):
        return None

    golden = (p9 is not None and p50 is not None and p9 < p50 and v9 >= v50)
    death = (p9 is not None and p50 is not None and p9 > p50 and v9 <= v50)

    return EMACrossResult(
        ema9=round(v9, 6),
        ema21=round(v21, 6),
        ema50=round(v50, 6),
        ema200=round(v200, 6),
        is_golden_cross=golden,
        is_death_cross=death,
        is_bullish_alignment=(v9 > v21 > v50),
        is_bearish_alignment=(v9 < v21 < v50),
        price_above_ema200=(closes[-1] > v200),
    )


# ---------------------------------------------------------------------------
# Volume ratio: current vs recent average (volume confirmation gate)
# ---------------------------------------------------------------------------

def volume_ratio(candles: List[Candle], lookback: int = 20) -> Optional[float]:
    """Ratio of current candle volume vs average of last `lookback` candles.

    Returns > 1.0 when volume is above average (confirms moves).
    Returns None when there's not enough data.
    """
    if len(candles) < lookback + 1:
        return None
    recent_volumes = [c.volume for c in candles[-(lookback + 1):-1]]
    avg_vol = sum(recent_volumes) / len(recent_volumes)
    if avg_vol <= 0:
        return None
    current_vol = candles[-1].volume
    return round(current_vol / avg_vol, 4)


# ---------------------------------------------------------------------------
# Convenience: compute all indicators at once
# ---------------------------------------------------------------------------

class AllIndicators(NamedTuple):
    rsi_15m: Optional[RSIResult]
    rsi_1h: Optional[RSIResult]
    rsi_4h: Optional[RSIResult]
    macd_1h: Optional[MACDResult]
    bollinger_1h: Optional[BollingerResult]
    atr_1h: Optional[float]
    atr_pct_1h: Optional[float]
    stoch_rsi_15m: Optional[StochRSIResult]
    adx_1h: Optional[ADXResult]
    obv_1h: Optional[OBVResult]
    vwap_1h: Optional[VWAPResult]
    cvd_1h: Optional[CVDResult]
    ema_cross_1h: Optional[EMACrossResult]
    volume_ratio_1h: Optional[float]    # current vol vs 20-period avg (confirmation gate)
    volume_ratio_15m: Optional[float]   # same for 15m (entry timing)


def compute_all(
    candles_15m: list,
    candles_1h: list,
    candles_4h: list,
) -> AllIndicators:
    """Compute all indicators from multi-timeframe candle data."""
    return AllIndicators(
        rsi_15m=rsi(candles_15m),
        rsi_1h=rsi(candles_1h),
        rsi_4h=rsi(candles_4h),
        macd_1h=macd(candles_1h),
        bollinger_1h=bollinger_bands(candles_1h),
        atr_1h=atr(candles_1h),
        atr_pct_1h=atr_pct(candles_1h),
        stoch_rsi_15m=stochastic_rsi(candles_15m),
        adx_1h=adx(candles_1h),
        obv_1h=obv(candles_1h),
        vwap_1h=vwap(candles_1h),
        cvd_1h=cvd(candles_1h),
        ema_cross_1h=ema_cross(candles_1h),
        volume_ratio_1h=volume_ratio(candles_1h),
        volume_ratio_15m=volume_ratio(candles_15m),
    )
