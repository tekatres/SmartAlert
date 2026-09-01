"""Smoke tests for the analyze_bar / decide refactor (backtest path)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.alert_engine.signal_engine import (
    SignalThresholds,
    analyze,
    analyze_bar,
    decide,
)
from app.services.binance_futures import Candle, MultiTimeframeKlines

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _candles(n: int, interval_min: int = 60) -> list:
    candles = []
    price = 100.0
    for i in range(n):
        ts = T0 + timedelta(minutes=i * interval_min)
        o = price
        c = price + 0.1
        h = max(o, c) + 0.2
        l = min(o, c) - 0.2
        candles.append(
            Candle(
                timestamp=ts, open=o, high=h, low=l, close=c,
                volume=1000.0, quote_volume=100000.0, taker_buy_volume=600.0,
            )
        )
        price = c
    return candles


def _mtf(n_1h: int) -> MultiTimeframeKlines:
    return MultiTimeframeKlines(
        symbol="BTCUSDT",
        coin_id="bitcoin",
        candles_15m=_candles(n_1h * 4 + 20, 15),
        candles_1h=_candles(n_1h, 60),
        candles_4h=_candles(max(8, n_1h // 4 + 5), 240),
    )


def test_analyze_returns_none_with_insufficient_data():
    assert analyze(_mtf(20), "Bitcoin") is None


def test_analyze_bar_decide_consistency():
    bar = analyze_bar(_mtf(300))
    assert bar is not None
    assert bar.confluence_total > 0

    sig = decide(_mtf(300), "Bitcoin", bar, SignalThresholds())
    # Gates may reject the bar; the important part is the path runs.
    if sig is not None:
        assert sig.direction in ("LONG", "SHORT")
        assert 0 <= sig.confluence_score <= sig.confluence_total


def test_analyze_bar_uses_default_adx_vote():
    bar = analyze_bar(_mtf(300))
    assert bar is not None
    adx_votes = [v for v in bar.votes if v.name == "ADX 1h"]
    assert len(adx_votes) == 1