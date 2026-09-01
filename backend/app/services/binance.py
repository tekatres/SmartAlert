"""Binance public market data provider (no key required for public endpoints)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import httpx

from app.core.logging import get_logger
from app.models.schemas import MarketSnapshot, MarketTick
from app.services.base import MarketDataProvider

logger = get_logger(__name__)

BINANCE_BASE = "https://api.binance.com"

# Map coin id (slugs) → Binance trading pair symbol
ID_TO_BINANCE = {
    "bitcoin": "BTCUSDT",
    "ethereum": "ETHUSDT",
    "solana": "SOLUSDT",
    "binancecoin": "BNBUSDT",
    "ripple": "XRPUSDT",
    "cardano": "ADAUSDT",
    "dogecoin": "DOGEUSDT",
    "polkadot": "DOTUSDT",
    "matic-network": "MATICUSDT",
    "avalanche-2": "AVAXUSDT",
    "chainlink": "LINKUSDT",
    "uniswap": "UNIUSDT",
    "pepe": "PEPEUSDT",
}

BINANCE_TO_INFO = {
    "BTCUSDT": ("bitcoin", "BTC", "Bitcoin"),
    "ETHUSDT": ("ethereum", "ETH", "Ethereum"),
    "SOLUSDT": ("solana", "SOL", "Solana"),
    "BNBUSDT": ("binancecoin", "BNB", "BNB"),
    "XRPUSDT": ("ripple", "XRP", "XRP"),
    "ADAUSDT": ("cardano", "ADA", "Cardano"),
    "DOGEUSDT": ("dogecoin", "DOGE", "Dogecoin"),
    "DOTUSDT": ("polkadot", "DOT", "Polkadot"),
    "MATICUSDT": ("matic-network", "POL", "Polygon"),
    "AVAXUSDT": ("avalanche-2", "AVAX", "Avalanche"),
    "LINKUSDT": ("chainlink", "LINK", "Chainlink"),
    "UNIUSDT": ("uniswap", "UNI", "Uniswap"),
    "PEPEUSDT": ("pepe", "PEPE", "Pepe"),
}


class BinanceProvider(MarketDataProvider):
    name = "binance"

    def __init__(self, timeout: float = 10.0) -> None:
        self._timeout = timeout

    async def fetch_ticks(self, coin_ids: List[str]) -> List[MarketTick]:
        symbols = [ID_TO_BINANCE[c] for c in coin_ids if c in ID_TO_BINANCE]
        if not symbols:
            return []

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            # 24h ticker for price + volume
            t24 = await client.get(
                f"{BINANCE_BASE}/api/v3/ticker/24hr",
                params={"symbols": _json_array(symbols)},
            )
            t24.raise_for_status()
            t24_data = t24.json()

            # Fetch kline (5m) for short-term change
            kline_tasks = [
                client.get(
                    f"{BINANCE_BASE}/api/v3/klines",
                    params={"symbol": s, "interval": "5m", "limit": 2},
                )
                for s in symbols
            ]
            kline_responses = await asyncio.gather(*kline_tasks, return_exceptions=True)

        kline_map = {}
        for s, resp in zip(symbols, kline_responses):
            if isinstance(resp, Exception):
                continue
            if resp.status_code != 200:
                continue
            arr = resp.json()
            if len(arr) >= 2:
                kline_map[s] = (float(arr[-2][4]), float(arr[-1][4]))

        now = datetime.now(timezone.utc)
        ticks: List[MarketTick] = []
        for item in t24_data:
            symbol = item["symbol"]
            if symbol not in BINANCE_TO_INFO:
                continue
            coin_id, sym, name = BINANCE_TO_INFO[symbol]
            prev_price, last_price = kline_map.get(symbol, (None, None))
            change_pct = 0.0
            if prev_price and last_price and prev_price > 0:
                change_pct = ((last_price - prev_price) / prev_price) * 100.0
            ticks.append(
                MarketTick(
                    coin_id=coin_id,
                    symbol=sym,
                    name=name,
                    price_usd=float(item["lastPrice"]),
                    volume_24h_usd=float(item["quoteVolume"]),
                    market_cap_usd=None,
                    change_1h_pct=change_pct,
                    change_24h_pct=float(item["priceChangePercent"]),
                    timestamp=now,
                )
            )
        return ticks

    async def fetch_snapshot(self, coin_ids: List[str]) -> MarketSnapshot:
        current = await self.fetch_ticks(coin_ids)
        # Build a synthetic "previous" by rolling the price back by the 5m kline
        symbols = [ID_TO_BINANCE[c] for c in coin_ids if c in ID_TO_BINANCE]
        previous_map: dict = {}
        if symbols:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                tasks = [
                    client.get(
                        f"{BINANCE_BASE}/api/v3/klines",
                        params={"symbol": s, "interval": "5m", "limit": 2},
                    )
                    for s in symbols
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for s, r in zip(symbols, results):
                    if isinstance(r, Exception) or r.status_code != 200:
                        continue
                    arr = r.json()
                    if len(arr) >= 2:
                        previous_map[s] = float(arr[-2][4])

        now = datetime.now(timezone.utc)
        previous: List[MarketTick] = []
        for t in current:
            sym_key = ID_TO_BINANCE.get(t.coin_id)
            prev_price = previous_map.get(sym_key, t.price_usd)
            previous.append(
                MarketTick(
                    coin_id=t.coin_id,
                    symbol=t.symbol,
                    name=t.name,
                    price_usd=prev_price,
                    volume_24h_usd=t.volume_24h_usd,
                    market_cap_usd=t.market_cap_usd,
                    timestamp=now,
                )
            )
        return MarketSnapshot(tickers=current, previous_tickers=previous, generated_at=now)


def _json_array(symbols: List[str]) -> str:
    import json
    return json.dumps(symbols)
