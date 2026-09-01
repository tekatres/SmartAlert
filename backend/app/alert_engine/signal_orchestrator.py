"""Signal orchestrator — coordinates kline fetching and signal analysis.

Called once per cron cycle, after the regular alert engine runs.
Fetches multi-timeframe data from Binance Futures for all configured
coins and runs the TradingSignalEngine on each one.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from app.alert_engine.signal_engine import TradingSignal, analyze
from app.core.logging import get_logger
from app.models.schemas import SignalVote, TradingSignalAlert, UserTier
from app.services.binance_futures import MultiTimeframeKlines, fetch_multi_timeframe

logger = get_logger(__name__)

# Coin display names (coin_id → human name)
COIN_NAMES: Dict[str, str] = {
    "bitcoin": "Bitcoin",
    "ethereum": "Ethereum",
    "solana": "Solana",
    "binancecoin": "BNB",
    "ripple": "XRP",
    "cardano": "Cardano",
    "dogecoin": "Dogecoin",
    "polkadot": "Polkadot",
    "matic-network": "Polygon",
    "avalanche-2": "Avalanche",
    "chainlink": "Chainlink",
    "uniswap": "Uniswap",
    "pepe": "Pepe",
}


class SignalOrchestrator:
    """Runs the full signal generation pipeline for a list of coins."""

    def __init__(self) -> None:
        # Store previous OI values per symbol to detect OI changes
        self._prev_oi: Dict[str, float] = {}

    async def generate_signals(
        self,
        coin_ids: List[str],
    ) -> List[TradingSignalAlert]:
        """Fetch multi-timeframe klines and return trading signals.

        Only LONG/SHORT signals (confluence >= 7/12) are returned.
        WAIT decisions are filtered out.
        """
        logger.info("SignalOrchestrator: fetching klines for %d coins", len(coin_ids))

        try:
            mtf_map: Dict[str, MultiTimeframeKlines] = await fetch_multi_timeframe(coin_ids)
        except Exception as e:
            logger.error("SignalOrchestrator: fetch_multi_timeframe failed: %s", e)
            return []

        signals: List[TradingSignalAlert] = []

        for coin_id, mtf in mtf_map.items():
            try:
                coin_name = COIN_NAMES.get(coin_id, coin_id.title())
                prev_oi = self._prev_oi.get(mtf.symbol)

                signal = analyze(mtf, coin_name, previous_oi=prev_oi)

                # Update stored OI for next cycle
                if mtf.open_interest:
                    self._prev_oi[mtf.symbol] = mtf.open_interest.open_interest

                if signal is None:
                    continue

                # Convert internal TradingSignal → Pydantic TradingSignalAlert
                schema_signal = _to_schema(signal)
                signals.append(schema_signal)

            except Exception as e:
                logger.warning("SignalOrchestrator: error analyzing %s: %s", coin_id, e)

        logger.info(
            "SignalOrchestrator: %d signal(s) generated from %d coins",
            len(signals), len(mtf_map),
        )
        return signals


def _to_schema(signal: TradingSignal) -> TradingSignalAlert:
    """Convert internal TradingSignal dataclass → Pydantic TradingSignalAlert."""
    from app.models.schemas import SignalDirection

    votes_schema = [
        SignalVote(
            name=v.name,
            vote=v.vote,
            weight=v.weight,
            value=v.value,
            explanation=v.explanation,
        )
        for v in signal.votes
    ]

    return TradingSignalAlert(
        id=signal.id,
        coin_id=signal.coin_id,
        symbol=signal.symbol,
        name=signal.name,
        direction=SignalDirection(signal.direction),
        confluence_score=signal.confluence_score,
        confluence_total=signal.confluence_total,
        confidence=signal.confidence,
        entry_price=signal.entry_price,
        leverage=signal.leverage,
        stop_loss=signal.stop_loss,
        take_profit_1=signal.take_profit_1,
        take_profit_2=signal.take_profit_2,
        risk_reward=signal.risk_reward,
        atr=signal.atr,
        sl_pct=signal.sl_pct,
        tp1_pct=signal.tp1_pct,
        tp2_pct=signal.tp2_pct,
        votes=votes_schema,
        bias_15m=signal.bias_15m,
        bias_1h=signal.bias_1h,
        bias_4h=signal.bias_4h,
        funding_rate=signal.funding_rate,
        open_interest=signal.open_interest,
        signal_type=signal.signal_type,
        created_at=signal.created_at,
        expires_at=signal.expires_at,
        min_tier=UserTier.FREE,
    )
