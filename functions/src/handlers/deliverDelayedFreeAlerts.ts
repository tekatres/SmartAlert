// 1-min scheduled function: picks up "pending_free_delivery" documents whose
// `not_before` is in the past and sends the push. This is the lever that
// gives premium users a 3-minute head-start over free users.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

export const deliverDelayedFreeAlerts = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "256MiB",
  },
  async () => {
    const db = getFirestore();
    const messaging = getMessaging();
    const now = Timestamp.now();

    const due = await db
      .collection("pending_free_delivery")
      .where("not_before", "<=", now)
      .limit(200)
      .get();

    if (due.empty) return;
    logger.info(`Delayed delivery: ${due.size} pending.`);

    // Group by alert_id to batch tokens
    const byAlert: Record<string, { tokens: string[]; userIds: string[]; alertRef: FirebaseFirestore.DocumentReference }> = {};
    for (const doc of due.docs) {
      const d = doc.data();
      const key = d.alert_id;
      if (!byAlert[key]) {
        byAlert[key] = { tokens: [], userIds: [], alertRef: db.collection("alerts").doc(key) };
      }
      byAlert[key].tokens.push(d.token);
      byAlert[key].userIds.push(d.user_id);
    }

    for (const [alertId, group] of Object.entries(byAlert)) {
      const alertSnap = await group.alertRef.get();
      if (!alertSnap.exists) {
        // Alert gone, just clean up
        await Promise.all(
          due.docs.filter((d) => d.data().alert_id === alertId).map((d) => d.ref.delete())
        );
        continue;
      }
      const alert = alertSnap.data()!;
      // Re-check tier: a user may have upgraded between scheduling and delivery
      const userDocs = await Promise.all(
        group.userIds.map((uid) => db.collection("users").doc(uid).get())
      );
      const stillFreeTokens: string[] = [];
      const stillFreeUserIds: string[] = [];
      userDocs.forEach((udoc, idx) => {
        const tier = udoc.get("preferences.plan") || "free";
        if (tier === "free") {
          stillFreeTokens.push(group.tokens[idx]);
          stillFreeUserIds.push(group.userIds[idx]);
        }
      });

      if (stillFreeTokens.length > 0) {
        const message = {
          tokens: stillFreeTokens,
          notification: {
            title: `${alert.score >= 75 ? "🟢" : alert.score >= 50 ? "🟡" : "🔴"} ${alert.title}`,
            body: alert.summary,
          },
          data: {
            alertId,
            coinId: alert.coin_id,
            symbol: alert.symbol,
            score: String(alert.score),
            click_action: "OPEN_ALERT",
            phase: "delayed",
          },
          android: { priority: "high" as const, notification: { channelId: "smart_alerts_default" } },
          apns: { payload: { aps: { sound: "default", badge: 1 } } },
        };
        try {
          const resp = await messaging.sendEachForMulticast(message);
          logger.info(
            `FCM [delayed] alert=${alertId} success=${resp.successCount} failure=${resp.failureCount}`
          );
          await group.alertRef.update({
            delivered_delayed: resp.successCount,
            delivered_delayed_at: Timestamp.now(),
          });
        } catch (e) {
          logger.error("FCM delayed send failed", e);
        }
      }
      // Clean up pending docs for this alert
      await Promise.all(
        due.docs.filter((d) => d.data().alert_id === alertId).map((d) => d.ref.delete())
      );
    }
  }
);
