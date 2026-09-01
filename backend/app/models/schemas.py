"""Pydantic models exposed by the API."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field


class AlertType(str, Enum):
    PRICE_SURGE = "price_surge"
    PRICE_DUMP = "price_dump"
    VOLUME_SPIKE = "volume_spike"
    BREAKOUT = "breakout"


class AlertSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class UserTier(str, Enum):
    FREE = "free"
    PREMIUM = "premium"
    PRO = "pro"


class MarketTick(BaseModel):
    coin_id: str
    symbol: str
    name: str
    price_usd: float
    volume_24h_usd: float
    market_cap_usd: Optional[float] = None
    change_1h_pct: float = 0.0
    change_24h_pct: float = 0.0
    timestamp: datetime


class MarketSnapshot(BaseModel):
    tickers: List[MarketTick]
    previous_tickers: List[MarketTick] = Field(default_factory=list)
    generated_at: datetime


class ScoreFactor(BaseModel):
    """One contributing factor in the multi-factor scoring model."""
    key: str  # magnitude | volume | trend | volatility | pattern | timing
    label: str
    value: float  # raw value used
    points: float  # 0..max_points contribution
    max_points: float
    explanation: str  # human-readable, shown to premium only


class ScoreBreakdown(BaseModel):
    """Multi-factor breakdown of the score. Premium feature (free sees only the total)."""
    model_config = {"protected_namespaces": ()}

    total: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)  # model confidence, not user-facing by default
    tier: UserTier = UserTier.PREMIUM  # which tier this breakdown is for
    factors: List[ScoreFactor]
    narrative: str  # 1-sentence summary of the dominant signal
    model_version: str = "v2"


class AlertOutcome(BaseModel):
    """Tracks what actually happened after the alert fired (filled in by outcome tracker)."""
    checked_at: Optional[datetime] = None
    price_after_1h: Optional[float] = None
    price_after_4h: Optional[float] = None
    price_after_24h: Optional[float] = None
    profitable_1h: Optional[bool] = None
    profitable_4h: Optional[bool] = None
    profitable_24h: Optional[bool] = None
    # ML signal: was the score directionally correct?
    score_was_correct: Optional[bool] = None


class Alert(BaseModel):
    id: str
    type: AlertType
    severity: AlertSeverity
    coin_id: str
    symbol: str
    name: str

    price_usd: float
    previous_price_usd: float
    change_pct: float
    volume_24h_usd: float
    volume_ratio: float = 1.0

    # Scoring
    score: int = Field(ge=0, le=100)
    score_breakdown: Optional[ScoreBreakdown] = None  # only included for premium

    # AI copy
    title: str
    summary: str
    explanation: str
    recommended_action: Optional[str] = None

    # Delivery
    visible_to_free: bool = True
    min_tier: UserTier = UserTier.FREE
    premium_only_reason: Optional[str] = None  # why is this premium?

    # Lifecycle
    created_at: datetime
    expires_at: Optional[datetime] = None
    outcome: Optional[AlertOutcome] = None


class AlertGenerationRequest(BaseModel):
    coins: Optional[List[str]] = None
    sensitivity: Literal["low", "medium", "high"] = "medium"
    use_ai: bool = True
    tier: UserTier = UserTier.FREE  # affects which fields are populated


# ---------------------------------------------------------------------------
# Trading Signal models
# ---------------------------------------------------------------------------

class SignalDirection(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    WAIT = "WAIT"


class SignalVote(BaseModel):
    """One indicator's vote in the confluence system."""
    name: str
    vote: str          # "LONG" | "SHORT" | "NEUTRAL"
    weight: int
    value: float
    explanation: str


class TradingSignalAlert(BaseModel):
    """A high-conviction trading signal with full risk management parameters."""
    id: str
    coin_id: str
    symbol: str
    name: str

    direction: SignalDirection
    confluence_score: int        # weighted votes aligned
    confluence_total: int        # total possible weighted votes
    confidence: float = Field(ge=0.0, le=1.0)

    entry_price: float
    leverage: int                # recommended leverage (1-20x)
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    risk_reward: float
    atr: float

    sl_pct: float                # SL distance as % of entry
    tp1_pct: float
    tp2_pct: float

    votes: List[SignalVote] = Field(default_factory=list)

    bias_15m: str = "NEUTRAL"
    bias_1h: str = "NEUTRAL"
    bias_4h: str = "NEUTRAL"

    funding_rate: float = 0.0
    open_interest: float = 0.0

    signal_type: str = ""

    created_at: datetime
    expires_at: Optional[datetime] = None
    min_tier: UserTier = UserTier.FREE


class AlertGenerationResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    generated_at: datetime
    count: int
    alerts: List[Alert]
    trading_signals: List[TradingSignalAlert] = Field(default_factory=list)
    provider: str
    ai_provider: str
    model_version: str


class ConversionStats(BaseModel):
    """Return value for the conversion stats callable."""
    user_id: str
    tier: UserTier
    period_days: int

    # Counts
    total_alerts_seen: int
    premium_alerts_locked: int       # alerts they couldn't see in full
    missed_alerts: int               # alerts that fired while they were on free

    # Value estimation
    estimated_missed_pct: float      # sum of profitable outcomes they missed
    winrate_premium_avg: float       # win rate of premium alerts in the period
    winrate_free_avg: float          # win rate of free alerts

    # A/B test
    ab_variant: str
    cta_impressions: int
    cta_clicks: int
    cta_conversions: int


# --- Pure helpers (no external deps) ---

PREMIUM_SCORE_THRESHOLD = 80
PREMIUM_TYPE_GATE = {AlertType.BREAKOUT}


def is_premium_only_predicate(alert_type: AlertType, score: int) -> Tuple[bool, Optional[str]]:
    """Module-level version of `is_premium_only` for callers that don't want
    to import from the scoring module (avoids circular imports)."""
    if score >= PREMIUM_SCORE_THRESHOLD:
        return True, "Top score — solo Premium"
    if alert_type in PREMIUM_TYPE_GATE:
        return True, "Setup avanzado — solo Premium"
    return False, None


class HealthResponse(BaseModel):
    status: str
    version: str
    data_provider: str
    ai_provider: str
