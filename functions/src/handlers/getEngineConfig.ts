// Callable: reads the current engine thresholds. Returns calibrated defaults
// (from the backtest) when no config has been stored yet.
import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

// Backtest-calibrated default (BTC/ETH/SOL, 30d): best EV combo from the grid
// search — conf=8, R:R=1.2, ADX=25 → EV≈+0.19R. Emits a sane number of signals.
export const DEFAULT_ENGINE_CONFIG = {
  min_confluence: 8,
  min_risk_reward: 1.2,
  min_adx: 25,
};

export const getEngineConfig = onCall(
  { region: "us-central1", cors: true },
  async () => {
    const snap = await getFirestore()
      .collection("engine_config")
      .doc("global")
      .get();

    if (!snap.exists) return DEFAULT_ENGINE_CONFIG;

    const d = snap.data() || {};
    return {
      min_confluence: Number(d.min_confluence) || DEFAULT_ENGINE_CONFIG.min_confluence,
      min_risk_reward: Number(d.min_risk_reward) || DEFAULT_ENGINE_CONFIG.min_risk_reward,
      min_adx: Number(d.min_adx) || DEFAULT_ENGINE_CONFIG.min_adx,
    };
  }
);