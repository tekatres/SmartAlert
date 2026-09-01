"""Abstract market data provider."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from app.models.schemas import MarketSnapshot, MarketTick


class MarketDataProvider(ABC):
    """Abstract interface for fetching market data."""

    name: str = "base"

    @abstractmethod
    async def fetch_ticks(self, coin_ids: List[str]) -> List[MarketTick]:
        """Fetch current market data for the given list of coin ids."""

    @abstractmethod
    async def fetch_snapshot(self, coin_ids: List[str]) -> MarketSnapshot:
        """Fetch a complete snapshot (current + previous) for diff-based detection."""
