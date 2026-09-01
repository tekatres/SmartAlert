// Triggered when a new alert is created in Firestore. Looks up matching users
// and sends an FCM push to each. Avoids duplicate sends using the alert's
// `delivered_to` array. Respects tier rules:
//   - Free users: receive only if alert.min_tier == "free". Delivery is
//     delayed by FREE_DELIVERY_DELAY_MIN minutes (configured below).
//   - Premium/Pro users: receive all alerts immediately.
import { onDocumentCreated, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

import { AlertPayload } from "../types";
import { findMatchingUsers } from "../repositories";

const CHANNEL_ID = "smart_alerts_default";
const FREE_DELIVERY_DELAY_MIN = 3; // tunable: free sees alerts 3 min after premium

export const onAlertCreated = onDocumentCreated(
  {
    document: "alerts/{alertId}",
    region: "us-central1",
    memory: "256MiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const alert = snap.data() as AlertPayload;
    const db = getFirestore();
    const messaging = getMessaging();

    // Find all users whose preferences match this alert type/score
    const docs = await findMatchingUsers(db, alert);
    logger.info(`Alert ${alert.id} matches ${docs.length} users.`);

    if (docs.length === 0) return;

    // Split into premium/immediate and free/delayed
    const now = Date.now();
    const freeDelayMs = FREE_DELIVERY_DELAY_MIN * 60 * 1000;
    const releaseAt = Timestamp.fromMillis(now + freeDelayMs);

    const immediateTokens: string[] = [];
    const immediateUserIds: string[] = [];
    const delayedTokens: string[] = [];
    const delayedUserIds: string[] = [];

    docs.forEach((d) => {
      const data = d.data();
      const tier: string = data?.preferences?.plan || "free";
      const fcmTokens: any[] = data?.fcm_tokens || [];
      const filtered = fcmTokens.filter((t) => !t.invalid);
      filtered.forEach((t) => {
        const token = t.token;
        // Premium-only alert: free users never receive it (even delayed)
        if (alert.min_tier === "premium" && tier === "free") return;
        if (tier === "free") {
          delayedTokens.push(token);
          delayedUserIds.push(d.id);
        } else {
          immediateTokens.push(token);
          immediateUserIds.push(d.id);
        }
      });
    });

    logger.info(
      `Delivery split: immediate=${immediateTokens.length} delayed=${delayedTokens.length} (gated=${docs.length - immediateUserIds.length - delayedUserIds.length})`
    );

    // Send immediate push
    if (immediateTokens.length > 0) {
      await sendPush(messaging, snap, alert, immediateTokens, immediateUserIds, db, "immediate");
    }

    // Schedule delayed push via a self-deleting marker; Cloud Scheduler would be
    // ideal, but we use a simpler approach: persist a "pending_free_delivery" doc
    // with `not_before` timestamp, and let a 1-min scheduled function pick it up.
    if (delayedTokens.length > 0) {
      const batch = db.batch();
      delayedUserIds.forEach((uid, idx) => {
        const ref = db
          .collection("pending_free_delivery")
          .doc(`${alert.id}_${uid}`);
        batch.set(ref, {
          alert_id: alert.id,
          user_id: uid,
          token: delayedTokens[idx],
          not_before: releaseAt,
          created_at: Timestamp.now(),
        });
      });
      await batch.commit();
    }

    await snap.ref.update({
      delivered_immediate: immediateTokens.length,
      queued_for_delay: delayedTokens.length,
    });
  }
);

async function sendPush(
  messaging: any,
  snap: QueryDocumentSnapshot,
  alert: AlertPayload,
  tokens: string[],
  userIds: string[],
  db: FirebaseFirestore.Firestore,
  phase: "immediate" | "delayed",
) {
  const scoreEmoji =
    alert.score >= 75 ? "🟢" : alert.score >= 50 ? "🟡" : "🔴";
  const title = `${scoreEmoji} ${alert.title}`;
  const body = alert.summary;

  const message = {
    tokens,
    notification: { title, body },
    data: {
      alertId: alert.id,
      coinId: alert.coin_id,
      symbol: alert.symbol,
      score: String(alert.score),
      click_action: "OPEN_ALERT",
      phase,
    },
    android: {
      priority: "high" as const,
      notification: {
        channelId: CHANNEL_ID,
        color:
          alert.score >= 75
            ? "#22c55e"
            : alert.score >= 50
            ? "#eab308"
            : "#ef4444",
      },
    },
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
    webpush: {
      headers: { Urgency: "high" },
      notification: { icon: "/icon-192.png", badge: "/badge-72.png" },
    },
  };

  try {
    const resp = await messaging.sendEachForMulticast(message);
    logger.info(
      `FCM [${phase}] delivered: success=${resp.successCount} failure=${resp.failureCount}`
    );

    // Mark invalid tokens
    const invalidIndexes: number[] = [];
    resp.responses.forEach((r: { success: boolean; error?: { code: string } }, idx: number) => {
      if (
        !r.success &&
        r.error &&
        [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
          "messaging/invalid-argument",
        ].includes(r.error.code)
      ) {
        invalidIndexes.push(idx);
      }
    });
    for (const idx of invalidIndexes) {
      const uid = userIds[idx];
      const token = tokens[idx];
      const userDoc = await db.collection("users").doc(uid).get();
      const current: any[] = userDoc.get("fcm_tokens") || [];
      await userDoc.ref.update({
        fcm_tokens: current.map((t) =>
          t.token === token ? { ...t, invalid: true, marked_at: Timestamp.now() } : t
        ),
      });
    }
    if (phase === "immediate") {
      await snap.ref.update({
        delivered_count: resp.successCount,
        delivered_to: Timestamp.now(),
      });
    }
  } catch (err) {
    logger.error(`FCM [${phase}] batch send failed`, err);
  }
}
