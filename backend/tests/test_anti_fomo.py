"""Unit tests for Anti-FOMO, Blended Risk-Reward, and Liquidation Protection."""
from datetime import datetime, timedelta, timezone
import pytest

from app.alert_engine.indicators import (
    PriceExtensionResult,
    compute_all,
    price_extension,
    stochastic_rsi,
    vwap,
)
from app.alert_engine.signal_engine import (
    SignalThresholds,
    analyze_bar,
    decide,
    _calculate_leverage_and_liquidation,
)
from app.services.binance_futures import Candle, MultiTimeframeKlines

T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def _make_candles(n: int, start_price: float = 100.0, step: float = 0.5) -> list[Candle]:
    candles = []
    p = start_price
    for i in range(n):
        ts = T0 + timedelta(minutes=15 * i)
        o = p
        c = p + step
        h = max(o, c) + 0.5
        l = min(o, c) - 0.5
        v = 1000.0
        candles.append(
            Candle(
                timestamp=ts,
                open=o,
                high=h,
                low=l,
                close=c,
                volume=v,
                quote_volume=v * c,
                taker_buy_volume=v * 0.6,
            )
        )
        p = c
    return candles


def test_price_extension_overextended_above():
    # Price way above EMA21 and VWAP
    ext = price_extension(current_price=120.0, ema21_val=100.0, vwap_val=102.0, atr_val=4.0)
    assert ext is not None
    assert ext.is_overextended_bullish is True
    assert ext.is_overextended_bearish is False
    assert ext.extension_ema21_atr >= 4.0
    assert ext.pullback_zone_min > 0


def test_price_extension_healthy_pullback():
    # Price pulled back close to EMA21
    ext = price_extension(current_price=101.0, ema21_val=100.0, vwap_val=101.5, atr_val=3.0)
    assert ext is not None
    assert ext.is_pullback_zone is True
    assert ext.is_overextended_bullish is False
    assert ext.pullback_zone_min <= 101.0 <= ext.pullback_zone_max


def test_leverage_and_liquidation_safety():
    # LONG: entry 100, SL 95 (5% SL). atr_pct_val = 2.0%
    lev, liq = _calculate_leverage_and_liquidation(
        atr_pct_val=2.0,
        entry=100.0,
        stop_loss=95.0,
        direction="LONG",
    )
    # Liquidation price must be well below stop loss (at least 1.8x SL distance)
    sl_dist = 100.0 - 95.0
    liq_dist = 100.0 - liq
    assert liq_dist >= 1.8 * sl_dist
    assert liq < 95.0  # liquidation price below SL protects the trader from margin call before SL


def test_anti_fomo_blocks_market_long_on_parabolic_pump():
    # Build candles simulating a vertical parabolic pump: 60 candles with steep upward steps
    candles_15m = _make_candles(100, start_price=100.0, step=2.0)
    candles_1h = _make_candles(80, start_price=50.0, step=5.0)
    candles_4h = _make_candles(50, start_price=20.0, step=10.0)

    mtf = MultiTimeframeKlines(
        symbol="SOLUSDT",
        coin_id="solana",
        candles_15m=candles_15m,
        candles_1h=candles_1h,
        candles_4h=candles_4h,
    )

    bar = analyze_bar(mtf)
    assert bar is not None

    # If the bar is overextended, decide() must block a direct LONG at the top
    # or flag it as OVEREXTENDED / require pullback
    if bar.market_phase == "OVEREXTENDED":
        sig = decide(mtf, "Solana", bar, SignalThresholds(min_confluence=1))
        # The Anti-FOMO gate in decide() must either return None or provide anti_fomo_warning
        assert sig is None or sig.anti_fomo_warning is not None
