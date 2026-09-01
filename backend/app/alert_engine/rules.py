"""Detection rules. Each rule inspects a (current, previous) tick pair and returns raw events."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional

from app.core.logging import get_logger
from app.models.schemas import AlertSeverity, AlertType, MarketTick

logger = get_logger(__name__)


@dataclass
class RawEvent:
    alert_type: AlertType
    severity: AlertSeverity
    current: MarketTick
    previous: MarketTick
    change_pct: float
    volume_ratio: float
    rule_name: str

    def key(self) -> str:
        return f"{self.alert_type.value}:{self.current.coin_id}"


class Rule(ABC):
    name: str = "base"

    @abstractmethod
    def applies_to(self, current: MarketTick, previous: Optional[MarketTick]) -> bool:
        ...

    @abstractmethod
    def evaluate(
        self, current: MarketTick, previous: MarketTick, sensitivity: str
    ) -> Optional[RawEvent]:
        ...


def _sensitivity_multiplier(sensitivity: str) -> float:
    return {"low": 1.5, "medium": 1.0, "high": 0.6}[sensitivity]


class PriceSurgeRule(Rule):
    name = "price_surge"

    def applies_to(self, current: MarketTick, previous: Optional[MarketTick]) -> bool:
        return previous is not None and previous.price_usd > 0

    def evaluate(self, current, previous, sensitivity):
        mult = _sensitivity_multiplier(sensitivity)
        threshold = 3.0 * mult
        change = ((current.price_usd - previous.price_usd) / previous.price_usd) * 100.0
        if change >= threshold:
            severity = _severity_for(change, threshold)
            vol_ratio = _volume_ratio(current)
            return RawEvent(
                alert_type=AlertType.PRICE_SURGE,
                severity=severity,
                current=current,
                previous=previous,
                change_pct=change,
                volume_ratio=vol_ratio,
                rule_name=self.name,
            )
        return None


class PriceDumpRule(Rule):
    name = "price_dump"

    def applies_to(self, current: MarketTick, previous: Optional[MarketTick]) -> bool:
        return previous is not None and previous.price_usd > 0

    def evaluate(self, current, previous, sensitivity):
        mult = _sensitivity_multiplier(sensitivity)
        threshold = 3.0 * mult
        change = ((current.price_usd - previous.price_usd) / previous.price_usd) * 100.0
        if change <= -threshold:
            severity = _severity_for(abs(change), threshold)
            vol_ratio = _volume_ratio(current)
            return RawEvent(
                alert_type=AlertType.PRICE_DUMP,
                severity=severity,
                current=current,
                previous=previous,
                change_pct=change,
                volume_ratio=vol_ratio,
                rule_name=self.name,
            )
        return None


class VolumeSpikeRule(Rule):
    """Flags a coin when its 24h volume is materially above recent baseline."""

    name = "volume_spike"

    def __init__(self, baseline_factor: float = 1.0) -> None:
        # When CoinGecko is the provider we don't have intra-day history; we
        # use the static baseline (volume_24h_usd vs market_cap proxy). When
        # Binance is the provider we can pass a more accurate baseline later.
        self._baseline_factor = baseline_factor

    def applies_to(self, current: MarketTick, previous: Optional[MarketTick]) -> bool:
        return current.volume_24h_usd > 0

    def evaluate(self, current, previous, sensitivity):
        mult = _sensitivity_multiplier(sensitivity)
        # Heuristic: in healthy markets vol/mcap ~ 0.05-0.20. We flag vol > 0.30
        # of market cap (very high turnover) or when 24h volume explodes.
        if not current.market_cap_usd or current.market_cap_usd <= 0:
            return None
        turnover = current.volume_24h_usd / current.market_cap_usd
        if turnover >= 0.30 * mult:
            change = ((current.price_usd - previous.price_usd) / previous.price_usd) * 100.0 if previous else 0.0
            return RawEvent(
                alert_type=AlertType.VOLUME_SPIKE,
                severity=_severity_for(turnover * 100, 30 * mult),
                current=current,
                previous=previous or current,
                change_pct=change,
                volume_ratio=turnover / 0.10,
                rule_name=self.name,
            )
        return None


class BreakoutRule(Rule):
    """Flags a breakout when price move > 1.5x the surge threshold AND volume is elevated."""

    name = "breakout"

    def applies_to(self, current: MarketTick, previous: Optional[MarketTick]) -> bool:
        return previous is not None and previous.price_usd > 0

    def evaluate(self, current, previous, sensitivity):
        mult = _sensitivity_multiplier(sensitivity)
        change = ((current.price_usd - previous.price_usd) / previous.price_usd) * 100.0
        vol_ratio = _volume_ratio(current)
        if abs(change) >= 4.5 * mult and vol_ratio >= 1.5:
            return RawEvent(
                alert_type=AlertType.BREAKOUT,
                severity=_severity_for(abs(change), 4.5 * mult),
                current=current,
                previous=previous,
                change_pct=change,
                volume_ratio=vol_ratio,
                rule_name=self.name,
            )
        return None


def _severity_for(magnitude: float, threshold: float) -> AlertSeverity:
    ratio = magnitude / threshold if threshold else 1.0
    if ratio >= 2.0:
        return AlertSeverity.HIGH
    if ratio >= 1.3:
        return AlertSeverity.MEDIUM
    return AlertSeverity.LOW


def _volume_ratio(tick: MarketTick) -> float:
    if not tick.market_cap_usd or tick.market_cap_usd <= 0:
        return 1.0
    turnover = tick.volume_24h_usd / tick.market_cap_usd
    return turnover / 0.10  # 10% turnover = baseline 1.0x


def default_rules() -> List[Rule]:
    return [
        PriceSurgeRule(),
        PriceDumpRule(),
        VolumeSpikeRule(),
        BreakoutRule(),
    ]
