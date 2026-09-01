// Cron function that calls the FastAPI engine every few minutes.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { ALERT_ENGINE_API_KEY, ALERT_ENGINE_URL, CRON_SCHEDULE } from "../config";
import { callAlertEngine } from "../alertEngineClient";
import { persistAlerts, persistTradingSignals } from "../repositories";

// Backtest-calibrated default so the engine emits signals even before the
// user touches the threshold controller (conf=8, R:R=1.2, ADX=25 → EV≈+0.19R).
const DEFAULT_THRESHOLDS = {
  min_confluence: 8,
  min_risk_reward: 1.2,
  min_adx: 25,
};

export const generateAlertsCron = onSchedule(
  {
    schedule: CRON_SCHEDULE.value(),
    timeZone: "Etc/UTC",
    region: "us-central1",
    secrets: [ALERT_ENGINE_URL, ALERT_ENGINE_API_KEY],
    memory: "256MiB",
    cpu: 1,
    timeoutSeconds: 120,
  },
  async () => {
    const baseUrl = ALERT_ENGINE_URL.value();
    const apiKey = ALERT_ENGINE_API_KEY.value();

    if (!baseUrl) {
      logger.error("ALERT_ENGINE_URL secret is not configured.");
      return;
    }

    const db = getFirestore();
    const runRef = db.collection("engine_runs").doc();
    const startedAt = Timestamp.now();

    try {
      // Read tunable engine thresholds from engine_config/global (if present).
      // Falls back to the backtest-calibrated defaults when absent.
      const configSnap = await db.collection("engine_config").doc("global").get();
      const cfg = configSnap.exists ? configSnap.data() : null;
      const signal_thresholds = {
        min_confluence: Number(cfg?.min_confluence) || DEFAULT_THRESHOLDS.min_confluence,
        min_risk_reward: Number(cfg?.min_risk_reward) || DEFAULT_THRESHOLDS.min_risk_reward,
        min_adx: Number(cfg?.min_adx) || DEFAULT_THRESHOLDS.min_adx,
      };

      const response = await callAlertEngine(baseUrl, apiKey, {
        sensitivity: "medium",
        use_ai: true,
        signal_thresholds,
      });

      // Persist classic alerts
      const ids = await persistAlerts(db, response.alerts);
      logger.info(
        `Engine returned ${response.count} alerts. Persisted ${ids.length}.`
      );

      // Persist trading signals (LONG/SHORT only — WAIT never returned)
      const signals = response.trading_signals ?? [];
      if (signals.length > 0) {
        const signalIds = await persistTradingSignals(db, signals);
        logger.info(`Trading signals persisted: ${signalIds.length}`);
      }

      await runRef.set({
        started_at: startedAt,
        finished_at: Timestamp.now(),
        alerts: response.count,
        persisted: ids.length,
        trading_signals: signals.length,
        provider: response.provider,
        ai_provider: response.ai_provider,
        status: "ok",
      });
    } catch (err) {
      logger.error("Alert generation failed", err);
      await runRef.set({
        started_at: startedAt,
        finished_at: Timestamp.now(),
        status: "error",
        error: String((err as Error).message ?? err),
      });
    }
  }
);
