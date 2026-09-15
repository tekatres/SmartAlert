"""Smoke tests for the analyze_bar / decide refactor (backtest path)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.alert_engine.btc_guard import BtcGuardState, evaluate_btc_guard
from app.alert_engine.signal_engine import (
    SignalThresholds,
    analyze,
    analyze_bar,
    decide,
)
from app.services.binance_futures import Candle, MultiTimeframeKlines

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _candles(n: int, interval_min: int = 60, step: float = 0.1) -> list:
    candles = []
    price = 100.0
    for i in range(n):
        ts = T0 + timedelta(minutes=i * interval_min)
        o = price
        c = price + step
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


def _alt_mtf(n_1h: int) -> MultiTimeframeKlines:
    """Ethereum snapshot (an altcoin that the BTC Beta Guard can gate)."""
    return MultiTimeframeKlines(
        symbol="ETHUSDT",
        coin_id="ethereum",
        candles_15m=_candles(n_1h * 4 + 20, 15),
        candles_1h=_candles(n_1h, 60),
        candles_4h=_candles(max(8, n_1h // 4 + 5), 240),
    )


def _low_gates() -> SignalThresholds:
    """Gates loose enough that any trending bar emits a signal."""
    return SignalThresholds(min_confluence=1, min_risk_reward=0.5, min_adx=0.0)


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


# ---------------------------------------------------------------------------
# BTC Beta Guard
# ---------------------------------------------------------------------------

def test_btc_guard_evaluate_bullish():
    state = evaluate_btc_guard(
        _candles(120, 15),
        _candles(200, 60),
    )
    assert state.btc_direction == "LONG"
    assert 5 <= state.btc_strength <= 10


def test_btc_guard_evaluate_bearish():
    state = evaluate_btc_guard(
        _candles(120, 15, step=-0.1),
        _candles(200, 60, step=-0.1),
    )
    assert state.btc_direction == "SHORT"
    assert 5 <= state.btc_strength <= 10


def test_btc_guard_blocks_counter_trend_altcoin():
    mtf = _alt_mtf(300)
    bar = analyze_bar(mtf)
    assert bar is not None

    gates = _low_gates()
    free_sig = decide(mtf, "Ethereum", bar, gates)
    assert free_sig is not None

    opposing = BtcGuardState(
        "SHORT" if free_sig.direction == "LONG" else "LONG", 9
    )
    assert decide(mtf, "Ethereum", bar, gates, opposing) is None


def test_btc_guard_attaches_aligned_metadata():
    mtf = _alt_mtf(300)
    bar = analyze_bar(mtf)
    assert bar is not None

    gates = _low_gates()
    free_sig = decide(mtf, "Ethereum", bar, gates)
    assert free_sig is not None

    same_dir = BtcGuardState(free_sig.direction, 7)
    sig = decide(mtf, "Ethereum", bar, gates, same_dir)
    assert sig is not None
    assert sig.btc_guard is not None
    assert sig.btc_guard.status == "ALIGNED"
    assert sig.btc_guard.btc_direction == free_sig.direction
    assert sig.btc_guard.btc_strength == 7


def test_btc_guard_never_gates_bitcoin():
    mtf = _mtf(300)
    bar = analyze_bar(mtf)
    assert bar is not None

    gates = _low_gates()
    free_sig = decide(mtf, "Bitcoin", bar, gates)
    if free_sig is None:
        return  # no signal emitted anyway

    opposing = BtcGuardState(
        "SHORT" if free_sig.direction == "LONG" else "LONG", 9
    )
    sig = decide(mtf, "Bitcoin", bar, gates, opposing)
    assert sig is not None  # Bitcoin itself is never gated