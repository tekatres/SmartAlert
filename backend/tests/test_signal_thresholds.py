"""Tests for tunable signal thresholds (engine_config)."""
from __future__ import annotations

from app.alert_engine.signal_engine import (
    MIN_ADX,
    MIN_CONFLUENCE,
    MIN_RISK_REWARD,
    SignalThresholds,
)
from app.models.schemas import SignalThresholdConfig
from app.routers.alerts import _to_signal_thresholds


def test_threshold_defaults_match_constants():
    t = SignalThresholds()
    assert t.min_confluence == MIN_CONFLUENCE
    assert t.min_risk_reward == MIN_RISK_REWARD
    assert t.min_adx == MIN_ADX


def test_threshold_custom_values():
    t = SignalThresholds(min_confluence=5, min_risk_reward=1.2, min_adx=10)
    assert t.min_confluence == 5
    assert t.min_risk_reward == 1.2
    assert t.min_adx == 10


def test_to_signal_thresholds_none_when_no_config():
    assert _to_signal_thresholds(None) is None


def test_to_signal_thresholds_maps_config():
    cfg = SignalThresholdConfig(min_confluence=5, min_risk_reward=1.2, min_adx=10)
    t = _to_signal_thresholds(cfg)
    assert t is not None
    assert t.min_confluence == 5
    assert t.min_risk_reward == 1.2
    assert t.min_adx == 10