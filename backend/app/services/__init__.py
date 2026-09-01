"""Market data providers (CoinGecko, Binance, mock)."""
from .base import MarketDataProvider
from .coingecko import CoinGeckoProvider
from .binance import BinanceProvider
from .mock import MockProvider


def get_provider(name: str) -> MarketDataProvider:
    name = (name or "mock").lower()
    if name == "coingecko":
        return CoinGeckoProvider()
    if name == "binance":
        return BinanceProvider()
    return MockProvider()


__all__ = ["MarketDataProvider", "get_provider"]
