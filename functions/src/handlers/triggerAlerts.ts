// Manual / admin trigger of the alert engine. Protected by a shared secret
// passed via the `X-Admin-Token` header. Useful for:
//   - Smoke-testing in production without waiting for the cron
//   - One-off backfills from a CI script
//   - On-demand runs from the dashboard "Refresh" button
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { ALERT_ENGINE_API_KEY, ALERT_ENGINE_URL } from "../config";
import { callAlertEngine, GenerateAlertsInput } from "../alertEngineClient";
import { persistAlerts } from "../repositories";

const ADMIN_TOKEN = defineSecret("ADMIN_TOKEN");

export const triggerAlerts = onRequest(
  {
    region: "us-central1",
    cors: true,
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: [ALERT_ENGINE_URL, ALERT_ENGINE_API_KEY, ADMIN_TOKEN],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const provided = req.header("X-Admin-Token");
    if (!provided || provided !== ADMIN_TOKEN.value()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const input: GenerateAlertsInput = {
      coins: Array.isArray(req.body?.coins) ? req.body.coins : undefined,
      sensitivity: req.body?.sensitivity || "medium",
      use_ai: req.body?.use_ai !== false,
    };

    try {
      const baseUrl = ALERT_ENGINE_URL.value();
      const apiKey = ALERT_ENGINE_API_KEY.value();

      if (!baseUrl) {
        res.status(500).json({ error: "ALERT_ENGINE_URL not configured" });
        return;
      }

      const db = getFirestore();
      const runRef = db.collection("engine_runs").doc();
      const startedAt = Timestamp.now();

      const response = await callAlertEngine(baseUrl, apiKey, input);
      const ids = await persistAlerts(db, response.alerts);

      await runRef.set({
        started_at: startedAt,
        finished_at: Timestamp.now(),
        alerts: response.count,
        persisted: ids.length,
        provider: response.provider,
        ai_provider: response.ai_provider,
        status: "ok",
        trigger: "manual",
      });

      res.json({
        ok: true,
        count: response.count,
        persisted: ids.length,
        generated_at: response.generated_at,
      });
    } catch (err) {
      logger.error("Manual trigger failed", err);
      res.status(500).json({ ok: false, error: String((err as Error).message ?? err) });
    }
  }
);
