"""Tests for the no-Cloud-Functions engine loop helpers."""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.engine_loop import (
    DEFAULT_THRESHOLDS,
    _to_firestore,
    get_engine_config,
)


def test_to_firestore_converts_datetimes_recursively():
    d = datetime(2026, 1, 1, tzinfo=timezone.utc)
    out = _to_firestore({"ts": d, "nested": {"x": d}, "arr": [d], "n": 5})
    assert out["ts"] == d.isoformat()
    assert out["nested"]["x"] == d.isoformat()
    assert out["arr"] == [d.isoformat()]
    assert out["n"] == 5


def test_get_engine_config_returns_defaults_when_firestore_unavailable():
    # No service account in CI/dev -> loop unavailable -> calibrated defaults.
    cfg = get_engine_config()
    assert cfg["min_confluence"] == DEFAULT_THRESHOLDS["min_confluence"]
    assert cfg["min_risk_reward"] == DEFAULT_THRESHOLDS["min_risk_reward"]
    assert cfg["min_adx"] == DEFAULT_THRESHOLDS["min_adx"]