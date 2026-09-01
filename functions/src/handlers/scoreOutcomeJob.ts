// Periodic outcome tracking: re-evaluates alerts fired 1h+ ago and records
// whether the trade would have been profitable. Feeds the scoring engine's
// "pattern" factor (closed-loop learning) and the conversion stats.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

import { ALERT_ENGINE_API_KEY, ALERT_ENGINE_URL } from "../config";

const ADMIN_TOKEN = defineSecret("ADMIN_TOKEN");

interface OutcomeResponse {
  alert_id: string;
  evaluated_at: string;
  status: string;
  // (the actual evaluation happens server-side in the engine; we trigger it here)
}

export const scoreOutcomeJob = onSchedule(
  {
    schedule: "every 30 minutes",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: [ALERT_ENGINE_URL, ALERT_ENGINE_API_KEY, ADMIN_TOKEN],
  },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const oneHourAgo = Timestamp.fromMillis(now.toMillis() - 60 * 60 * 1000);
    const fourHoursAgo = Timestamp.fromMillis(now.toMillis() - 4 * 60 * 60 * 1000);

    // Find alerts created ~1h ago that haven't been scored yet
    const candidates = await db
      .collection("alerts")
      .where("created_at", "<=", oneHourAgo)
      .where("created_at", ">", fourHoursAgo)
      .where("outcome.checked_at", "==", null)
      .limit(200)
      .get();

    logger.info(`Outcome tracker: ${candidates.size} alerts to evaluate.`);
    if (candidates.empty) return;

    const baseUrl = ALERT_ENGINE_URL.value();
    const apiKey = ALERT_ENGINE_API_KEY.value();
    if (!baseUrl) return;

    let evaluated = 0;
    for (const doc of candidates.docs) {
      try {
        const res = await fetch(`${baseUrl}/alerts/evaluate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "X-Admin-Token": ADMIN_TOKEN.value(),
          },
          body: JSON.stringify({ alert_id: doc.id }),
        });
        if (res.ok) {
          const body = (await res.json()) as OutcomeResponse;
          // Mark as evaluated (the engine will update the outcome field via
          // a separate call to the FastAPI service in production)
          await doc.ref.update({
            "outcome.evaluated_at": Timestamp.now(),
            "outcome.status": body.status,
          });
          evaluated++;
        }
      } catch (e) {
        logger.warn(`Outcome evaluation failed for ${doc.id}:`, e);
      }
    }
    logger.info(`Outcome tracker: evaluated ${evaluated}/${candidates.size}.`);
  }
);
