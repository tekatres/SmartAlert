"""CoinGecko market data provider (free public API, no key required)."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx

from app.core.logging import get_logger
from app.models.schemas import MarketSnapshot, MarketTick
from app.services.base import MarketDataProvider

logger = get_logger(__name__)

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# Map commonly-used Binance-style symbols to CoinGecko IDs
SYMBOL_TO_ID = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
    "DOT": "polkadot",
    "MATIC": "matic-network",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "UNI": "uniswap",
}

ID_TO_SYMBOL = {v: k for k, v in SYMBOL_TO_ID.items()}

_last_call_ts: float = 0.0
_MIN_INTERVAL_S: float = 1.2  # CoinGecko free tier ~10-30 req/min


async def _rate_limit() -> None:
    global _last_call_ts
    elapsed = time.time() - _last_call_ts
    if elapsed < _MIN_INTERVAL_S:
        import asyncio
        await asyncio.sleep(_MIN_INTERVAL_S - elapsed)
    _last_call_ts = time.time()


class CoinGeckoProvider(MarketDataProvider):
    name = "coingecko"

    def __init__(self, timeout: float = 15.0) -> None:
        self._timeout = timeout

    async def fetch_ticks(self, coin_ids: List[str]) -> List[MarketTick]:
        await _rate_limit()
        params = {
            "vs_currency": "usd",
            "ids": ",".join(coin_ids),
            "order": "market_cap_desc",
            "per_page": max(len(coin_ids), 10),
            "page": 1,
            "sparkline": "false",
            "price_change_percentage": "1h,24h",
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.get(f"{COINGECKO_BASE}/coins/markets", params=params)
            r.raise_for_status()
            data = r.json()

        ticks: List[MarketTick] = []
        now = datetime.now(timezone.utc)
        for item in data:
            ticks.append(
                MarketTick(
                    coin_id=item["id"],
                    symbol=item.get("symbol", "").upper(),
                    name=item.get("name", item["id"]),
                    price_usd=float(item.get("current_price") or 0.0),
                    volume_24h_usd=float(item.get("total_volume") or 0.0),
                    market_cap_usd=_to_float(item.get("market_cap")),
                    change_1h_pct=_to_float(item.get("price_change_percentage_1h_in_currency")) or 0.0,
                    change_24h_pct=_to_float(item.get("price_change_percentage_24h_in_currency")) or 0.0,
                    timestamp=now,
                )
            )
        return ticks

    async def fetch_snapshot(self, coin_ids: List[str]) -> MarketSnapshot:
        current = await self.fetch_ticks(coin_ids)
        # CoinGecko free tier has no historical endpoint with fine resolution
        # We approximate "previous" by emulating a slight price drift using 1h change.
        # In production you would use a paid plan or local cache (Redis/Postgres).
        previous: List[MarketTick] = []
        now = datetime.now(timezone.utc)
        for t in current:
            prev_price = t.price_usd / (1.0 + t.change_1h_pct / 100.0) if t.change_1h_pct else t.price_usd
            previous.append(
                MarketTick(
                    coin_id=t.coin_id,
                    symbol=t.symbol,
                    name=t.name,
                    price_usd=round(prev_price, 8),
                    volume_24h_usd=t.volume_24h_usd,
                    market_cap_usd=t.market_cap_usd,
                    change_1h_pct=0.0,
                    change_24h_pct=0.0,
                    timestamp=now,
                )
            )
        return MarketSnapshot(tickers=current, previous_tickers=previous, generated_at=now)


def _to_float(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
