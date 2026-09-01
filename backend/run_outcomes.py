"""One-shot outcome evaluation for shared hosting (cPanel cron, every ~30 min).

Scores trading signals fired 1-4h ago (WIN if TP1 touched before SL) and
updates the per-setup win-rate stats in Firestore. Exits immediately.
"""
from __future__ import annotations

import asyncio
import sys

from app.core.config import get_settings
from app.services.engine_loop import evaluate_signal_outcomes, init_firestore


async def run() -> int:
    settings = get_settings()
    if not init_firestore(settings):
        print("SKIP: no Firebase credentials (FIREBASE_CREDENTIALS)", file=sys.stderr)
        return 1
    await evaluate_signal_outcomes()
    print("outcomes ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(run()) or 0)
    except Exception as exc:  # noqa: BLE001
        print(f"outcome cycle failed: {exc}", file=sys.stderr)
        sys.exit(1)