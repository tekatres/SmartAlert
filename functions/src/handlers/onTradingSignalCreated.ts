// Trigger: fires when a new trading signal is written to Firestore.
// Sends an immediate FCM push notification to all FCM tokens registered
// for this user (personal use — no tier filtering).
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { TradingSignalPayload } from "../types";

export const onTradingSignalCreated = onDocumentCreated(
  {
    document: "trading_signals/{signalId}",
    region: "us-central1",
    memory: "256MiB",
  },
  async (event) => {
    const signal = event.data?.data() as TradingSignalPayload | undefined;
    if (!signal) return;

    const db = getFirestore();
    const messaging = getMessaging();

    // Collect all FCM tokens from all users
    const usersSnap = await db.collection("users").get();
    const tokens: string[] = [];

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const fcmTokens: Array<{ token: string; invalid?: boolean }> =
        data.fcm_tokens ?? [];
      fcmTokens
        .filter((t) => t.token && !t.invalid)
        .forEach((t) => tokens.push(t.token));
    }

    if (tokens.length === 0) {
      logger.info(`onTradingSignalCreated: no FCM tokens found, skipping push.`);
      return;
    }

    // Build notification content
    const directionEmoji = signal.direction === "LONG" ? "🟢" : "🔴";
    const directionLabel = signal.direction === "LONG" ? "LONG" : "SHORT";
    const title = `${directionEmoji} ${directionLabel} ${signal.symbol} · ${signal.leverage}x`;
    const body = [
      `Entrada: $${signal.entry_price.toLocaleString("en-US", { maximumFractionDigits: 4 })}`,
      `SL: -${signal.sl_pct.toFixed(2)}%`,
      `TP1: +${signal.tp1_pct.toFixed(2)}%`,
      `TP2: +${signal.tp2_pct.toFixed(2)}%`,
      `Confluencia: ${signal.confluence_score}/${signal.confluence_total}`,
    ].join("  ·  ");

    // Send multicast in batches of 500 (FCM limit)
    const BATCH_SIZE = 500;
    let sent = 0;
    const invalidTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      try {
        const result = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title, body },
          data: {
            signalId: signal.id,
            coinId: signal.coin_id,
            symbol: signal.symbol,
            direction: signal.direction,
            leverage: String(signal.leverage),
            entryPrice: String(signal.entry_price),
            stopLoss: String(signal.stop_loss),
            takeProfit1: String(signal.take_profit_1),
            takeProfit2: String(signal.take_profit_2),
            confluenceScore: String(signal.confluence_score),
            confluenceTotal: String(signal.confluence_total),
            type: "trading_signal",
          },
          android: {
            notification: {
              channelId: "smart_alerts_signals",
              priority: "high",
            },
          },
          apns: {
            payload: {
              aps: { sound: "default", badge: 1 },
            },
          },
        });

        sent += result.successCount;

        result.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error?.code === "messaging/registration-token-not-registered") {
            invalidTokens.push(batch[idx]);
          }
        });
      } catch (err) {
        logger.error("FCM multicast batch failed", err);
      }
    }

    logger.info(
      `onTradingSignalCreated ${signal.direction} ${signal.symbol}: sent=${sent} tokens=${tokens.length}`
    );

    // Mark invalid tokens in Firestore
    if (invalidTokens.length > 0) {
      const batch = db.batch();
      for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const fcmTokens: Array<{ token: string; invalid?: boolean }> =
          data.fcm_tokens ?? [];
        const updated = fcmTokens.map((t) =>
          invalidTokens.includes(t.token) ? { ...t, invalid: true } : t
        );
        if (JSON.stringify(updated) !== JSON.stringify(fcmTokens)) {
          batch.update(userDoc.ref, { fcm_tokens: updated });
        }
      }
      await batch.commit();
      logger.info(`Marked ${invalidTokens.length} invalid FCM tokens.`);
    }
  }
);
