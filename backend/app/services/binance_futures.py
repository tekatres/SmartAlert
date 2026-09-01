"""Binance USD-M Futures public data provider.

Fetches OHLCV klines (candlestick data) across multiple timeframes plus
futures-specific data (funding rate, open interest) from the public
Binance Futures REST API. No API key required.

Endpoints base: https://fapi.binance.com
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx

from app.core.logging import get_logger
from app.services.binance import ID_TO_BINANCE  # reuse coin_id → symbol mapping

logger = get_logger(__name__)

FUTURES_BASE = "https://fapi.binance.com"

# Timeframes we fetch for multi-timeframe analysis
TIMEFRAMES = ("15m", "1h", "4h")

# Number of candles to fetch per timeframe (enough for all indicators)
KLINE_LIMIT = 200


@dataclass
class Candle:
    """A single OHLCV candlestick."""
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    quote_volume: float   # USDT volume — more reliable for crypto
    taker_buy_volume: float   # buy-side volume (used for CVD)


@dataclass
class FundingRate:
    symbol: str
    funding_rate: float       # e.g. 0.0001 = 0.01%
    funding_time: datetime
    next_funding_time: Optional[datetime] = None


@dataclass
class OpenInterest:
    symbol: str
    open_interest: float      # current OI in contracts
    open_interest_value: float  # current OI in USDT


@dataclass
class MultiTimeframeKlines:
    """Container for klines across all timeframes for a single symbol."""
    symbol: str
    coin_id: str
    candles_15m: List[Candle] = field(default_factory=list)
    candles_1h: List[Candle] = field(default_factory=list)
    candles_4h: List[Candle] = field(default_factory=list)
    funding_rate: Optional[FundingRate] = None
    open_interest: Optional[OpenInterest] = None


def _parse_candles(raw: list) -> List[Candle]:
    """Parse raw Binance kline response into Candle objects.

    Binance kline format:
    [open_time, open, high, low, close, volume, close_time,
     quote_asset_volume, num_trades, taker_buy_base_vol, taker_buy_quote_vol, ignore]
    """
    candles: List[Candle] = []
    for row in raw:
        try:
            candles.append(Candle(
                timestamp=datetime.fromtimestamp(row[0] / 1000, tz=timezone.utc),
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]),
                quote_volume=float(row[7]),
                taker_buy_volume=float(row[9]),
            ))
        except (IndexError, ValueError) as e:
            logger.warning("Failed to parse candle row: %s", e)
    return candles


async def fetch_klines(
    client: httpx.AsyncClient,
    symbol: str,
    interval: str,
    limit: int = KLINE_LIMIT,
) -> List[Candle]:
    """Fetch OHLCV klines for a futures symbol from Binance Futures API."""
    try:
        resp = await client.get(
            f"{FUTURES_BASE}/fapi/v1/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
        )
        resp.raise_for_status()
        return _parse_candles(resp.json())
    except Exception as e:
        logger.warning("fetch_klines %s %s failed: %s", symbol, interval, e)
        return []


async def fetch_funding_rate(
    client: httpx.AsyncClient,
    symbol: str,
) -> Optional[FundingRate]:
    """Fetch the latest funding rate for a futures symbol."""
    try:
        resp = await client.get(
            f"{FUTURES_BASE}/fapi/v1/premiumIndex",
            params={"symbol": symbol},
        )
        resp.raise_for_status()
        data = resp.json()
        return FundingRate(
            symbol=symbol,
            funding_rate=float(data.get("lastFundingRate", 0.0)),
            funding_time=datetime.fromtimestamp(
                data.get("time", 0) / 1000, tz=timezone.utc
            ),
            next_funding_time=datetime.fromtimestamp(
                data.get("nextFundingTime", 0) / 1000, tz=timezone.utc
            ) if data.get("nextFundingTime") else None,
        )
    except Exception as e:
        logger.warning("fetch_funding_rate %s failed: %s", symbol, e)
        return None


async def fetch_open_interest(
    client: httpx.AsyncClient,
    symbol: str,
) -> Optional[OpenInterest]:
    """Fetch current open interest for a futures symbol."""
    try:
        resp = await client.get(
            f"{FUTURES_BASE}/fapi/v1/openInterest",
            params={"symbol": symbol},
        )
        resp.raise_for_status()
        data = resp.json()
        return OpenInterest(
            symbol=symbol,
            open_interest=float(data.get("openInterest", 0.0)),
            open_interest_value=float(data.get("openInterest", 0.0)),  # contracts
        )
    except Exception as e:
        logger.warning("fetch_open_interest %s failed: %s", symbol, e)
        return None


async def fetch_multi_timeframe(
    coin_ids: List[str],
    timeout: float = 15.0,
) -> Dict[str, MultiTimeframeKlines]:
    """Fetch klines for all timeframes + futures data for every coin in parallel.

    Returns a dict keyed by coin_id.
    """
    symbols = [
        (coin_id, ID_TO_BINANCE[coin_id])
        for coin_id in coin_ids
        if coin_id in ID_TO_BINANCE
    ]
    if not symbols:
        return {}

    results: Dict[str, MultiTimeframeKlines] = {}

    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = []
        for coin_id, symbol in symbols:
            tasks.append(_fetch_all_for_symbol(client, coin_id, symbol))

        fetched = await asyncio.gather(*tasks, return_exceptions=True)

    for (coin_id, symbol), result in zip(symbols, fetched):
        if isinstance(result, Exception):
            logger.warning("fetch_multi_timeframe %s failed: %s", symbol, result)
            continue
        results[coin_id] = result

    logger.info(
        "fetch_multi_timeframe: fetched data for %d/%d symbols",
        len(results), len(symbols),
    )
    return results


async def _fetch_all_for_symbol(
    client: httpx.AsyncClient,
    coin_id: str,
    symbol: str,
) -> MultiTimeframeKlines:
    """Fetch all data for a single symbol concurrently."""
    candles_15m, candles_1h, candles_4h, funding, oi = await asyncio.gather(
        fetch_klines(client, symbol, "15m"),
        fetch_klines(client, symbol, "1h"),
        fetch_klines(client, symbol, "4h"),
        fetch_funding_rate(client, symbol),
        fetch_open_interest(client, symbol),
        return_exceptions=False,
    )
    return MultiTimeframeKlines(
        symbol=symbol,
        coin_id=coin_id,
        candles_15m=candles_15m,
        candles_1h=candles_1h,
        candles_4h=candles_4h,
        funding_rate=funding,
        open_interest=oi,
    )
