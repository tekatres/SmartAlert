"""No-Cloud-Functions engine loop.

Replaces the Firebase Cloud Functions (cron + triggers) by running inside the
FastAPI process: every `signal_scan_interval_s` it generates alerts + trading
signals, persists them to Firestore and sends FCM pushes; every
`outcome_scan_interval_s` it evaluates signal outcomes and updates the
win-rate stats (closed-loop learning).

Requires a Firebase service account (free). If no credentials are configured,
the loop is disabled and the backend keeps working for backtests/dev.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from app.core.config import Settings
from app.core.logging import get_logger
from app.models.schemas import Alert, SignalOutcome, TradingSignalAlert, UserTier

logger = get_logger(__name__)

_available = False
_db = None
_messaging = None

# Backtest-calibrated default thresholds (conf=8, R:R=1.2, ADX=25 → EV≈+0.19R)
DEFAULT_THRESHOLDS = {"min_confluence": 8, "min_risk_reward": 1.2, "min_adx": 25}

FCM_BATCH_SIZE = 500
SIGNAL_CHANNEL_ID = "smart_alerts_signals"


# --- Initialization ---------------------------------------------------------

def is_available() -> bool:
    return _available


def init_firestore(settings: Settings) -> bool:
    """Initialize firebase-admin. Returns False when no credentials are set."""
    global _available, _db, _messaging
    if _available:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore, messaging

        cred_path = settings.firebase_credentials or os.getenv(
            "GOOGLE_APPLICATION_CREDENTIALS", ""
        )
        if not cred_path or not os.path.isfile(cred_path):
            logger.warning(
                "Firestore/FCM disabled: no service account "
                "(set FIREBASE_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS)"
            )
            return False

        opts = {}
        if settings.firebase_project_id:
            opts["projectId"] = settings.firebase_project_id
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, opts)
        _db = firestore.client()
        _messaging = messaging
        _available = True
        logger.info("Firestore/FCM initialized (no-Cloud-Functions mode)")
        return True
    except Exception as e:  # pragma: no cover
        logger.error("Firebase init failed: %s", e)
        return False


# --- Serialization ----------------------------------------------------------

def _to_firestore(obj):
    """Recursively convert datetimes to ISO strings for Firestore."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _to_firestore(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_firestore(i) for i in obj]
    return obj


# --- Persistence ------------------------------------------------------------

def persist_alerts(alerts: List[Alert]) -> int:
    if not _available or not alerts:
        return 0
    batch = _db.batch()
    col = _db.collection("alerts")
    for a in alerts:
        batch.set(col.document(a.id), _to_firestore(a.model_dump()), merge=True)
    batch.commit()
    logger.info("persisted %d alerts", len(alerts))
    return len(alerts)


def persist_signals(signals: List[TradingSignalAlert]) -> int:
    if not _available or not signals:
        return 0
    batch = _db.batch()
    col = _db.collection("trading_signals")
    for s in signals:
        batch.set(col.document(s.id), _to_firestore(s.model_dump()), merge=True)
    batch.commit()
    logger.info("persisted %d trading signals", len(signals))
    return len(signals)


def get_engine_config() -> Dict[str, float]:
    """Read threshold config from engine_config/global, else calibrated defaults."""
    if not _available:
        return dict(DEFAULT_THRESHOLDS)
    snap = _db.collection("engine_config").document("global").get()
    if not snap.exists:
        return dict(DEFAULT_THRESHOLDS)
    d = snap.to_dict() or {}
    return {
        "min_confluence": float(d.get("min_confluence") or DEFAULT_THRESHOLDS["min_confluence"]),
        "min_risk_reward": float(d.get("min_risk_reward") or DEFAULT_THRESHOLDS["min_risk_reward"]),
        "min_adx": float(d.get("min_adx") or DEFAULT_THRESHOLDS["min_adx"]),
    }


# --- FCM push ---------------------------------------------------------------

def _all_tokens() -> List[str]:
    tokens: List[str] = []
    for user in _db.collection("users").stream():
        data = user.to_dict()
        for t in data.get("fcm_tokens") or []:
            if t.get("token") and not t.get("invalid"):
                tokens.append(t["token"])
    return tokens


def _send_multicast(message) -> None:
    for i in range(0, len(message.tokens), FCM_BATCH_SIZE):
        batch_msg = _messaging.MulticastMessage(
            tokens=message.tokens[i : i + FCM_BATCH_SIZE],
            notification=message.notification,
            data=message.data,
            android=message.android,
            apns=message.apns,
        )
        resp = _messaging.send_each_for_multicast(batch_msg)
        logger.info("FCM push: success=%d failure=%d", resp.success_count, resp.failure_count)


def send_alert_push(alerts: List[Alert]) -> int:
    if not _available or not alerts or _messaging is None:
        return 0
    tokens = _all_tokens()
    if not tokens:
        return 0
    for a in alerts:
        emoji = "🟢" if a.score >= 75 else "🟡" if a.score >= 50 else "🔴"
        _send_multicast(
            _messaging.MulticastMessage(
                tokens=tokens,
                notification=_messaging.Notification(title=f"{emoji} {a.title}", body=a.summary),
                data={
                    "alertId": a.id,
                    "coinId": a.coin_id,
                    "symbol": a.symbol,
                    "score": str(a.score),
                    "type": "alert",
                },
            )
        )
    return len(alerts)


def send_signal_push(signals: List[TradingSignalAlert]) -> int:
    if not _available or not signals or _messaging is None:
        return 0
    tokens = _all_tokens()
    if not tokens:
        return 0
    for s in signals:
        emoji = "🟢" if s.direction == "LONG" else "🔴"
        title = f"{emoji} {s.direction} {s.symbol} · {s.leverage}x"
        body = (
            f"Entrada ${s.entry_price:,.4f}  ·  SL -{s.sl_pct:.2f}%  ·  "
            f"TP1 +{s.tp1_pct:.2f}%  ·  Confluencia {s.confluence_score}/{s.confluence_total}"
        )
        _send_multicast(
            _messaging.MulticastMessage(
                tokens=tokens,
                notification=_messaging.Notification(title=title, body=body),
                data={
                    "signalId": s.id,
                    "coinId": s.coin_id,
                    "symbol": s.symbol,
                    "direction": s.direction,
                    "leverage": str(s.leverage),
                    "entryPrice": str(s.entry_price),
                    "stopLoss": str(s.stop_loss),
                    "takeProfit1": str(s.take_profit_1),
                    "takeProfit2": str(s.take_profit_2),
                    "type": "trading_signal",
                },
                android=_messaging.AndroidConfig(
                    notification=_messaging.AndroidNotification(channel_id=SIGNAL_CHANNEL_ID)
                ),
            )
        )
    return len(signals)


# --- Outcome evaluation (closed-loop) ---------------------------------------

async def evaluate_signal_outcomes() -> None:
    """Score signals fired 1-4h ago: WIN if TP1 touched before SL, then update
    the signal doc and the per-setup win-rate stats."""
    if not _available:
        return

    import httpx

    from app.alert_engine.signal_outcome import evaluate_signal_outcome

    now = datetime.now(timezone.utc)
    one_hour_ago = (now - timedelta(hours=1)).isoformat()
    four_hours_ago = (now - timedelta(hours=4)).isoformat()

    candidates = (
        _db.collection("trading_signals")
        .where("created_at", "<=", one_hour_ago)
        .where("created_at", ">", four_hours_ago)
        .stream()
    )

    async with httpx.AsyncClient(timeout=20.0) as client:
        for doc in candidates:
            data = doc.to_dict()
            if (data.get("outcome") or {}).get("result"):
                continue
            try:
                symbol = data["symbol"]
                if not symbol.endswith("USDT"):
                    symbol = f"{symbol}USDT"
                created_at = datetime.fromisoformat(data["created_at"])
                outcome = await evaluate_signal_outcome(
                    client=client,
                    symbol=symbol,
                    direction=data["direction"],
                    entry_price=float(data["entry_price"]),
                    stop_loss=float(data["stop_loss"]),
                    take_profit_1=float(data["take_profit_1"]),
                    take_profit_2=float(data["take_profit_2"]),
                    created_at=created_at,
                )
                doc.reference.update(
                    {
                        "outcome": _to_firestore(
                            SignalOutcome(
                                result=outcome.result,
                                hit_level=outcome.hit_level,
                                profitable_1h=outcome.profitable_1h,
                                profitable_4h=outcome.profitable_4h,
                                price_1h=outcome.price_1h,
                                price_4h=outcome.price_4h,
                                max_favorable_excursion_pct=outcome.max_favorable_excursion_pct,
                                max_adverse_excursion_pct=outcome.max_adverse_excursion_pct,
                                checked_at=outcome.evaluated_at,
                            ).model_dump()
                        )
                    }
                )
                if outcome.result in ("WIN", "LOSS"):
                    _record_outcome(
                        coin_id=data.get("coin_id", ""),
                        signal_type=data.get("signal_type") or "unknown",
                        direction=data["direction"],
                        result=outcome.result,
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning("outcome eval failed for %s: %s", doc.id, e)


def _record_outcome(coin_id: str, signal_type: str, direction: str, result: str) -> None:
    col = _db.collection("signal_stats")
    inc_wins = 1 if result == "WIN" else 0
    inc_losses = 1 if result == "LOSS" else 0

    def _payload():
        return {
            "wins": _db.Increment(inc_wins),
            "losses": _db.Increment(inc_losses),
            "total": _db.Increment(1),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    col.document(f"setup_{signal_type}").set(_payload(), merge=True)
    col.document(f"coin_{coin_id}_{signal_type}").set(
        {**_payload(), "coin_id": coin_id, "signal_type": signal_type, "direction": direction},
        merge=True,
    )
    col.document("_meta").set(_payload(), merge=True)


# --- Scheduling loop --------------------------------------------------------

class EngineLoop:
    """Background tasks replacing the Cloud Functions cron."""

    def __init__(self, settings: Settings, alert_engine, orchestrator) -> None:
        self.settings = settings
        self.alert_engine = alert_engine
        self.orchestrator = orchestrator
        self._tasks: List[asyncio.Task] = []
        self.available = init_firestore(settings)

    def start(self) -> None:
        if not self.available:
            logger.warning(
                "EngineLoop disabled (no Firebase credentials). "
                "Signals won't be generated/persisted automatically."
            )
            return
        loop = asyncio.get_running_loop()
        self._tasks.append(loop.create_task(self._signal_cycle()))
        self._tasks.append(loop.create_task(self._outcome_cycle()))
        logger.info("EngineLoop started (signal=%ds, outcome=%ds)",
                    self.settings.signal_scan_interval_s,
                    self.settings.outcome_scan_interval_s)

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _signal_cycle(self) -> None:
        while True:
            try:
                await self._run_generation()
            except Exception as e:  # noqa: BLE001
                logger.error("signal cycle error: %s", e)
            await asyncio.sleep(self.settings.signal_scan_interval_s)

    async def _outcome_cycle(self) -> None:
        while True:
            try:
                await evaluate_signal_outcomes()
            except Exception as e:  # noqa: BLE001
                logger.error("outcome cycle error: %s", e)
            await asyncio.sleep(self.settings.outcome_scan_interval_s)

    async def _run_generation(self) -> None:
        from app.alert_engine.signal_engine import SignalThresholds

        coins = self.settings.coin_list
        cfg = get_engine_config()
        thresholds = SignalThresholds(
            min_confluence=int(cfg["min_confluence"]),
            min_risk_reward=float(cfg["min_risk_reward"]),
            min_adx=float(cfg["min_adx"]),
        )

        alerts = await self.alert_engine.generate_alerts(
            coin_ids=coins, sensitivity="medium", use_ai=True, tier=UserTier.FREE
        )
        signals = await self.orchestrator.generate_signals(coins, thresholds=thresholds)

        persist_alerts(alerts)
        persist_signals(signals)
        send_alert_push(alerts)
        send_signal_push(signals)

        logger.info(
            "generation cycle: %d alerts, %d signals (thresholds=%s)",
            len(alerts), len(signals), cfg,
        )