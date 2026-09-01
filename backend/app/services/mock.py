"""Deterministic-ish mock provider (deterministic per minute, oscillates realistically)."""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import List, Optional

from app.core.logging import get_logger
from app.models.schemas import MarketSnapshot, MarketTick
from app.services.base import MarketDataProvider

logger = get_logger(__name__)

# (id, symbol, name, base_price, base_volume)
MOCK_COINS = [
    ("bitcoin", "BTC", "Bitcoin", 67000.0, 25_000_000_000.0),
    ("ethereum", "ETH", "Ethereum", 3500.0, 12_000_000_000.0),
    ("solana", "SOL", "Solana", 165.0, 3_000_000_000.0),
    ("binancecoin", "BNB", "BNB", 610.0, 1_500_000_000.0),
    ("ripple", "XRP", "XRP", 0.58, 2_200_000_000.0),
    ("cardano", "ADA", "Cardano", 0.42, 380_000_000.0),
    ("dogecoin", "DOGE", "Dogecoin", 0.14, 950_000_000.0),
    ("polkadot", "DOT", "Polkadot", 6.7, 240_000_000.0),
]


def _minute_seed() -> int:
    return int(time.time() // 60)


def _osc(seed: int, idx: int, amplitude_pct: float) -> float:
    """Return an oscillation factor for a coin using sine waves (deterministic per minute)."""
    t = (seed + idx) * 0.7
    a = math.sin(t) * 0.6
    b = math.sin(t * 0.37 + idx) * 0.3
    c = math.sin(t * 1.9 + idx * 2.0) * 0.2
    return 1.0 + ((a + b + c) * amplitude_pct / 100.0)


class MockProvider(MarketDataProvider):
    """Generates synthetic but realistic-looking market data.

    Designed for local development, demos, and tests. The oscillation per minute
    is deterministic, so every call within the same minute returns similar values,
    making it easy to validate the detection rules.
    """
    name = "mock"

    def __init__(self, force_event_per_minute: bool = True) -> None:
        self._force_event = force_event_per_minute

    async def fetch_ticks(self, coin_ids: List[str]) -> List[MarketTick]:
        seed = _minute_seed()
        now = datetime.now(timezone.utc)
        ticks: List[MarketTick] = []
        for idx, (cid, sym, name, base_price, base_vol) in enumerate(MOCK_COINS):
            if cid not in coin_ids:
                continue
            # Occasionally force a meaningful move (1 in 3 minutes) for demo
            forced_factor = 1.0
            if self._force_event and (seed + idx) % 3 == 0:
                direction = 1 if (seed + idx) % 2 == 0 else -1
                forced_factor = 1.0 + direction * 0.045  # 4.5% jump

            price_factor = _osc(seed, idx, amplitude_pct=2.5) * forced_factor
            vol_factor = _osc(seed, idx + 100, amplitude_pct=15.0)
            # Make 1 in 5 minutes a clear volume spike
            if (seed + idx) % 5 == 0:
                vol_factor *= 2.5

            price = round(base_price * price_factor, 6 if base_price < 1 else 2)
            volume = round(base_vol * vol_factor, 2)
            change_1h = round((price_factor - 1.0) * 100.0, 3)
            change_24h = round(_osc(seed, idx + 50, amplitude_pct=6.0) * 100.0 - 100.0, 3)

            ticks.append(
                MarketTick(
                    coin_id=cid,
                    symbol=sym,
                    name=name,
                    price_usd=price,
                    volume_24h_usd=volume,
                    market_cap_usd=price * 19_000_000,
                    change_1h_pct=change_1h,
                    change_24h_pct=change_24h,
                    timestamp=now,
                )
            )
        return ticks

    async def fetch_snapshot(self, coin_ids: List[str]) -> MarketSnapshot:
        current = await self.fetch_ticks(coin_ids)
        # Simulate the "previous 5m" snapshot by removing the oscillation phase
        seed = _minute_seed() - 1
        now = datetime.now(timezone.utc)
        previous: List[MarketTick] = []
        for idx, (cid, sym, name, base_price, base_vol) in enumerate(MOCK_COINS):
            if cid not in coin_ids:
                continue
            price_factor = _osc(seed, idx, amplitude_pct=2.5)
            price = round(base_price * price_factor, 6 if base_price < 1 else 2)
            previous.append(
                MarketTick(
                    coin_id=cid,
                    symbol=sym,
                    name=name,
                    price_usd=price,
                    volume_24h_usd=tick.volume_24h_usd if (tick := _find(current, cid)) else base_vol,
                    market_cap_usd=None,
                    change_1h_pct=0.0,
                    change_24h_pct=0.0,
                    timestamp=now,
                )
            )
        return MarketSnapshot(tickers=current, previous_tickers=previous, generated_at=now)


def _find(ticks: List[MarketTick], coin_id: str) -> Optional[MarketTick]:
    for t in ticks:
        if t.coin_id == coin_id:
            return t
    return None
