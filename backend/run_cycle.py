"""One-shot generation cycle for shared hosting (cPanel cron, every ~5 min).

Runs a single cycle: fetch market data, generate alerts + trading signals,
persist to Firestore and send FCM pushes, then exits. Designed to be called
from cPanel "Cron Jobs" instead of a long-running process.

Example cron (every 5 minutes) with your venv python:
    cd /home/USER/smartalert && /home/USER/smartalert/venv/bin/python3 run_cycle.py
"""
from __future__ import annotations

import asyncio
import sys
from typing import Optional

from app.alert_engine.engine import AlertEngine
from app.alert_engine.outcome import OutcomeTracker
from app.alert_engine.signal_engine import SignalThresholds
from app.alert_engine.signal_orchestrator import SignalOrchestrator
from app.ai.factory import get_ai_provider
from app.core.config import get_settings
from app.models.schemas import UserTier
from app.services import get_provider
from app.services.engine_loop import (
    get_engine_config,
    init_firestore,
    persist_alerts,
    persist_signals,
    send_alert_push,
    send_signal_push,
)


async def run() -> int:
    settings = get_settings()
    if not init_firestore(settings):
        print("SKIP: no Firebase credentials (FIREBASE_CREDENTIALS)", file=sys.stderr)
        return 1

    provider = get_provider(settings.data_provider)
    ai_provider = get_ai_provider(settings)
    outcome_tracker = OutcomeTracker(provider)
    engine = AlertEngine(
        data_provider=provider, ai_provider=ai_provider, outcome_tracker=outcome_tracker
    )
    orchestrator = SignalOrchestrator()

    cfg = get_engine_config()
    thresholds = SignalThresholds(
        min_confluence=int(cfg["min_confluence"]),
        min_risk_reward=float(cfg["min_risk_reward"]),
        min_adx=float(cfg["min_adx"]),
    )

    coins = settings.coin_list
    alerts = await engine.generate_alerts(
        coin_ids=coins, sensitivity="medium", use_ai=True, tier=UserTier.FREE
    )
    signals = await orchestrator.generate_signals(coins, thresholds=thresholds)

    persist_alerts(alerts)
    persist_signals(signals)
    send_alert_push(alerts)
    send_signal_push(signals)

    print(
        f"cycle ok: {len(alerts)} alerts, {len(signals)} signals "
        f"(thresholds conf={cfg['min_confluence']} rr={cfg['min_risk_reward']} adx={cfg['min_adx']})"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(run()) or 0)
    except Exception as exc:  # noqa: BLE001
        print(f"cycle failed: {exc}", file=sys.stderr)
        sys.exit(1)