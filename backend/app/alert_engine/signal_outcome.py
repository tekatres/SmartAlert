"""Trading signal outcome tracker.

Periodically re-checks what actually happened after a LONG/SHORT signal
fired: which level was hit first (TP1/SL), whether the trade would have
been profitable at 1h/4h, and the max favorable/adverse excursion.

The result feeds the win-rate stats per setup (closed-loop learning) so
the engine can learn which setups actually make money instead of trusting
static thresholds.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx

from app.core.logging import get_logger
from app.services.binance_futures import Candle, fetch_klines

logger = get_logger(__name__)

# How far into the future we look for a TP/SL touch. Signals expire at 4h,
# but a setup can still reach TP later; we cap evaluation to avoid eternal
# "pending" windows and stale reads.
EVALUATION_HOURS = 24
EVALUATION_INTERVAL = "15m"
EVALUATION_LIMIT = 300  # 15m * 300 = 75h of candles — covers the window

# Touches within this tolerance of the level still count as a hit.
HIT_TOLERANCE = 1e-9


@dataclass
class SignalOutcomeResult:
    result: str                       # "WIN" | "LOSS" | "PENDING"
    hit_level: str                    # "TP1" | "TP2" | "SL" | "NONE"
    profitable_1h: Optional[bool]
    profitable_4h: Optional[bool]
    price_1h: Optional[float]
    price_4h: Optional[float]
    max_favorable_excursion_pct: Optional[float]
    max_adverse_excursion_pct: Optional[float]
    evaluated_at: datetime


def evaluate_from_candles(
    candles: List[Candle],
    *,
    direction: str,
    entry_price: float,
    stop_loss: float,
    take_profit_1: float,
    take_profit_2: float,
    created_at: datetime,
) -> SignalOutcomeResult:
    """Determine a signal's outcome from candles that fired after creation.

    Rules:
      - LONG wins if TP1 is touched before SL; SHORT wins if TP1 (below
        entry) is touched before SL.
      - If a single candle touches both levels, order is approximated from
        the candle's own direction (bullish → TP first for LONG).
      - If nothing is hit within the window the result is PENDING and we
        report the 1h/4h directional check as context.
    """
    evaluated_at = datetime.now(timezone.utc)
    if not candles:
        return SignalOutcomeResult(
            "PENDING", "NONE", None, None, None, None, None, None, evaluated_at
        )

    is_long = direction == "LONG"
    future = [c for c in candles if c.timestamp > created_at]
    if not future:
        future = candles

    # First level hit (chronological order across candles).
    first_hit = "NONE"
    for c in future:
        hit = _first_hit_in_candle(
            c, is_long=is_long, tp1=take_profit_1, sl=stop_loss
        )
        if hit is not None:
            first_hit = hit
            break

    if first_hit == "TP1":
        result = "WIN"
    elif first_hit == "SL":
        result = "LOSS"
    else:
        result = "PENDING"

    # Max favorable/adverse excursion (% from entry, in the profitable dir).
    if is_long:
        fav = max(c.high for c in future)
        adv = min(c.low for c in future)
    else:
        fav = min(c.low for c in future)
        adv = max(c.high for c in future)
    max_fav_pct = (fav - entry_price) / entry_price * 100.0 if entry_price else 0.0
    max_adv_pct = (adv - entry_price) / entry_price * 100.0 if entry_price else 0.0

    price_1h = _price_after(candles, created_at, 1)
    price_4h = _price_after(candles, created_at, 4)

    return SignalOutcomeResult(
        result=result,
        hit_level=first_hit,
        profitable_1h=_profitable(price_1h, entry_price, is_long),
        profitable_4h=_profitable(price_4h, entry_price, is_long),
        price_1h=price_1h,
        price_4h=price_4h,
        max_favorable_excursion_pct=round(max_fav_pct, 4),
        max_adverse_excursion_pct=round(max_adv_pct, 4),
        evaluated_at=evaluated_at,
    )


def _first_hit_in_candle(
    candle: Candle,
    *,
    is_long: bool,
    tp1: float,
    sl: float,
) -> Optional[str]:
    """Return "TP1" / "SL" if the candle touches either level, else None.

    When both are touched in the same candle the intra-candle order is
    unknown; we approximate it with the candle's direction (bullish candle
    for LONG → TP reached first).
    """
    tp_hit = candle.high >= tp1 if is_long else candle.low <= tp1
    sl_hit = candle.low <= sl if is_long else candle.high >= sl

    if tp_hit and sl_hit:
        # Same candle — assume the move in the signal's direction came first.
        return "TP1" if (candle.close >= candle.open) == is_long else "SL"
    if tp_hit:
        return "TP1"
    if sl_hit:
        return "SL"
    return None


def _price_after(candles: List[Candle], created_at: datetime, hours: int) -> Optional[float]:
    """Return the close of the candle closest to created_at + hours."""
    if not candles:
        return None
    target = created_at + timedelta(hours=hours)
    best = None
    best_delta = None
    for c in candles:
        if c.timestamp <= created_at:
            continue
        delta = abs((c.timestamp - target).total_seconds())
        if best_delta is None or delta < best_delta:
            best_delta = delta
            best = c
    return best.close if best else None


def _profitable(price: Optional[float], entry: float, is_long: bool) -> Optional[bool]:
    if price is None or entry <= 0:
        return None
    delta = (price - entry) / entry
    if abs(delta) < 0.001:  # < 0.1% move → not meaningful
        return None
    return delta > 0 if is_long else delta < 0


async def evaluate_signal_outcome(
    client: httpx.AsyncClient,
    *,
    symbol: str,
    direction: str,
    entry_price: float,
    stop_loss: float,
    take_profit_1: float,
    take_profit_2: float,
    created_at: datetime,
) -> SignalOutcomeResult:
    """Fetch post-creation klines from Binance Futures and evaluate outcome."""
    try:
        candles = await fetch_klines(
            client,
            symbol,
            EVALUATION_INTERVAL,
            limit=EVALUATION_LIMIT,
            start_time=int(created_at.timestamp() * 1000),
        )
    except Exception as e:
        logger.warning("evaluate_signal_outcome %s failed: %s", symbol, e)
        return SignalOutcomeResult(
            "PENDING", "NONE", None, None, None, None, None, None,
            datetime.now(timezone.utc),
        )

    return evaluate_from_candles(
        candles,
        direction=direction,
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit_1=take_profit_1,
        take_profit_2=take_profit_2,
        created_at=created_at,
    )