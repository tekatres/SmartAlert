"""BTC Beta Guard — the market-leader correlation shield.

Bitcoin drives the whole crypto market (~55%+ of dominance). The
institutional rule is: never open a LONG on an altcoin while BTC is
bearish, and never open a SHORT while BTC is breaking out to the upside.

This module evaluates Bitcoin's master health (price vs EMA50, RSI on
1h/15m) ahead of every altcoin analysis and returns a guard state that
the signal engine uses to BLOCK opposing trades.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import List, Literal, Optional

import httpx

from app.alert_engine.indicators import ema_value, rsi
from app.core.logging import get_logger
from app.services.binance_futures import Candle, fetch_klines

logger = get_logger(__name__)

BTC_SYMBOL = "BTCUSDT"
BTC_COIN_ID = "bitcoin"

BtcDirection = Literal["LONG", "SHORT", "NEUTRAL"]


@dataclass(frozen=True)
class BtcGuardState:
    """Bitcoin's master-health snapshot used to gate altcoin signals."""
    btc_direction: BtcDirection
    btc_strength: int      # 0-10 (conviction of the BTC trend)


@dataclass(frozen=True)
class BtcGuardMeta:
    """Per-signal guard metadata persisted for display in the UI."""
    status: Literal["ALIGNED", "BLOCKED", "NEUTRAL"]
    btc_direction: BtcDirection
    btc_strength: int
    explanation: str


def evaluate_btc_guard(
    candles_15m: List[Candle],
    candles_1h: List[Candle],
) -> BtcGuardState:
    """Evaluate Bitcoin's master health from 15m and 1h klines.

    Mirrors the frontend liveScanner logic:
    - LONG:  price > EMA50(1h)  and RSI(1h) > 50 and RSI(15m) > 46
    - SHORT: price < EMA50(1h)  and RSI(1h) < 50 and RSI(15m) < 54
    - otherwise NEUTRAL (range-bound → no gate)
    Strength scales 5-10 with the distance of RSI(1h) from 50.
    """
    closes_1h = [c.close for c in candles_1h]
    if len(closes_1h) < 50 or not candles_15m:
        return BtcGuardState("NEUTRAL", 5)

    price = closes_1h[-1]
    ema50 = ema_value(closes_1h, 50)
    rsi_1h = rsi(candles_1h, 14)
    rsi_15m = rsi(candles_15m, 14)

    if (
        ema50 is None
        or rsi_1h is None
        or rsi_15m is None
        or price <= 0
    ):
        return BtcGuardState("NEUTRAL", 5)

    if price > ema50 and rsi_1h.value > 50 and rsi_15m.value > 46:
        strength = min(10, round(5 + (rsi_1h.value - 50) / 5))
        return BtcGuardState("LONG", strength)

    if price < ema50 and rsi_1h.value < 50 and rsi_15m.value < 54:
        strength = min(10, round(5 + (50 - rsi_1h.value) / 5))
        return BtcGuardState("SHORT", strength)

    return BtcGuardState("NEUTRAL", 5)


async def fetch_btc_guard(timeout: float = 15.0) -> Optional[BtcGuardState]:
    """Fetch BTCUSDT 15m/1h klines and evaluate the master-health guard.

    Returns None on failure so the engine degrades gracefully (no gate).
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            c15m, c1h = await asyncio.gather(
                fetch_klines(client, BTC_SYMBOL, "15m", limit=100),
                fetch_klines(client, BTC_SYMBOL, "1h", limit=200),
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("fetch_btc_guard failed: %s", e)
        return None

    if not c1h or not c15m:
        logger.warning("fetch_btc_guard: insufficient BTC klines")
        return None

    return evaluate_btc_guard(c15m, c1h)


def build_btc_guard_meta(
    state: BtcGuardState,
    signal_direction: str,
) -> BtcGuardMeta:
    """Build the per-signal metadata (status + explanation) for a signal.

    BLOCKED signals are never emitted by the engine, so published signals
    are either ALIGNED (BTC trend matches) or NEUTRAL (BTC range-bound).
    """
    if state.btc_direction == signal_direction:
        status = "ALIGNED"
        explanation = (
            f"🛡️ BTC Beta Guard: Alineado con el líder. Bitcoin está "
            f"{state.btc_direction} ({state.btc_strength}/10) impulsando el mercado."
        )
    else:
        status = "NEUTRAL"
        explanation = (
            f"🛡️ BTC Beta Guard: Bitcoin en rango neutral ({state.btc_strength}/10)."
        )

    return BtcGuardMeta(
        status=status,
        btc_direction=state.btc_direction,
        btc_strength=state.btc_strength,
        explanation=explanation,
    )