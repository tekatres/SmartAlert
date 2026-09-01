"""Unit tests for the trading signal outcome evaluator.

Run from backend/:  pip install -r requirements.txt pytest  &&  pytest -q
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.alert_engine.signal_outcome import (
    evaluate_from_candles,
    _price_after,
)
from app.services.binance_futures import Candle


def _mins(n: int) -> timedelta:
    return timedelta(minutes=n)


def _candle(ts: datetime, o, h, l, c) -> Candle:
    return Candle(
        timestamp=ts,
        open=o,
        high=h,
        low=l,
        close=c,
        volume=100.0,
        quote_volume=1000.0,
        taker_buy_volume=60.0,
    )


T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def test_long_win_when_tp1_hit_before_sl():
    entry, sl, tp1 = 100.0, 96.0, 104.0
    candles = [
        _candle(T0 + _mins(15), 100, 102, 99, 101),   # drift up, no touch
        _candle(T0 + _mins(30), 101, 105, 100, 104),  # TP1 touched (high 105 >= 104)
    ]
    out = evaluate_from_candles(
        candles, direction="LONG", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=108.0, created_at=T0,
    )
    assert out.result == "WIN"
    assert out.hit_level == "TP1"


def test_long_loss_when_sl_hit_first():
    entry, sl, tp1 = 100.0, 96.0, 104.0
    candles = [
        _candle(T0 + _mins(15), 100, 101, 95, 96),   # SL touched (low 95 <= 96)
        _candle(T0 + _mins(30), 96, 105, 95, 104),   # TP later - already SL first
    ]
    out = evaluate_from_candles(
        candles, direction="LONG", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=108.0, created_at=T0,
    )
    assert out.result == "LOSS"
    assert out.hit_level == "SL"


def test_short_win_when_tp1_below_entry_hit():
    entry, sl, tp1 = 100.0, 104.0, 96.0
    candles = [
        _candle(T0 + _mins(15), 100, 102, 98, 99),   # drift down, no touch
        _candle(T0 + _mins(30), 99, 101, 95, 96),    # TP1 (low 95 <= 96)
    ]
    out = evaluate_from_candles(
        candles, direction="SHORT", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=92.0, created_at=T0,
    )
    assert out.result == "WIN"
    assert out.hit_level == "TP1"


def test_pending_when_no_level_hit():
    entry, sl, tp1 = 100.0, 96.0, 104.0
    candles = [
        _candle(T0 + _mins(15), 100, 101, 99, 100.5),
        _candle(T0 + _mins(30), 100.5, 102, 99.5, 101),
    ]
    out = evaluate_from_candles(
        candles, direction="LONG", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=108.0, created_at=T0,
    )
    assert out.result == "PENDING"
    assert out.hit_level == "NONE"
    # 1h price should be the closest candle to T0+1h (the second one: 101).
    assert out.price_1h == 101.0
    assert out.profitable_1h is True


def test_same_candle_both_levels_resolved_by_direction():
    # LONG, bullish candle that wicks up to TP1 and down to SL -> TP1 wins.
    entry, sl, tp1 = 100.0, 96.0, 104.0
    candles = [_candle(T0 + _mins(15), 100, 105, 95, 103)]
    out = evaluate_from_candles(
        candles, direction="LONG", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=108.0, created_at=T0,
    )
    assert out.result == "WIN"

    # Bearish candle (open above close) -> SL assumed first -> LOSS.
    candles_bear = [_candle(T0 + _mins(15), 103, 105, 95, 97)]
    out2 = evaluate_from_candles(
        candles_bear, direction="LONG", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=108.0, created_at=T0,
    )
    assert out2.result == "LOSS"


def test_price_after_picks_closest_candle():
    candles = [
        _candle(T0 + _mins(30), 100, 101, 99, 100.0),
        _candle(T0 + _mins(65), 100, 102, 99, 101.5),  # ~1h05 -> closest to T0+1h
        _candle(T0 + _mins(90), 101.5, 103, 101, 102.0),
    ]
    assert _price_after(candles, T0, 1) == 101.5


def test_favorable_adverse_excursions():
    entry, sl, tp1 = 100.0, 96.0, 104.0
    candles = [
        _candle(T0 + _mins(15), 100, 103, 97, 102),  # high 103 (+3%), low 97 (-3%)
    ]
    out = evaluate_from_candles(
        candles, direction="LONG", entry_price=entry,
        stop_loss=sl, take_profit_1=tp1, take_profit_2=108.0, created_at=T0,
    )
    assert out.max_favorable_excursion_pct == 3.0
    assert out.max_adverse_excursion_pct == -3.0