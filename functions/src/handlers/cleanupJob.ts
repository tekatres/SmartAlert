// Periodic cleanup:
// 1. Deletes alerts past their `expires_at`.
// 2. Removes FCM tokens flagged as invalid by previous sendEachForMulticast calls.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { CRON_SCHEDULE } from "../config";

export const cleanupJob = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "256MiB",
  },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();

    // 1) Drop expired alerts
    const expiredSnap = await db
      .collection("alerts")
      .where("expires_at", "<=", now)
      .limit(500)
      .get();

    if (!expiredSnap.empty) {
      const batch = db.batch();
      expiredSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      logger.info(`Cleanup: removed ${expiredSnap.size} expired alerts.`);
    }

    // 2) Drop tokens marked as invalid (we tag them with `invalid: true` from
    //    the onAlertCreated handler when sendEachForMulticast reports a
    //    NotRegistered / InvalidRegistration error code).
    const usersSnap = await db.collection("users").get();
    let removedTokens = 0;
    for (const userDoc of usersSnap.docs) {
      const tokens: any[] = userDoc.get("fcm_tokens") || [];
      const filtered = tokens.filter(
        (t) => !t.invalid && !t.token.startsWith("EXAMPLE_")
      );
      if (filtered.length !== tokens.length) {
        removedTokens += tokens.length - filtered.length;
        await userDoc.ref.update({ fcm_tokens: filtered });
      }
    }
    logger.info(`Cleanup: pruned ${removedTokens} invalid FCM tokens.`);
  }
);

// Suppress unused warning for CRON_SCHEDULE (exported for consistency)
export const __CRON_SCHEDULE_REF = CRON_SCHEDULE;
