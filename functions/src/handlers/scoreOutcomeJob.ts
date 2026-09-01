// Periodic outcome tracking: re-evaluates alerts and trading signals fired
// 1h+ ago and records whether the trade would have been profitable. Feeds
// the scoring engine's "pattern" factor (closed-loop learning) and the
// conversion / win-rate stats in the UI.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

import { ALERT_ENGINE_API_KEY, ALERT_ENGINE_URL } from "../config";
import { recordSignalOutcome } from "../repositories";
import { SignalEvaluationResponse, TradingSignalPayload } from "../types";

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

    const baseUrl = ALERT_ENGINE_URL.value();
    const apiKey = ALERT_ENGINE_API_KEY.value();
    if (!baseUrl) return;

    const headers = {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Admin-Token": ADMIN_TOKEN.value(),
    };

    // --- 1) Classic alerts (existing behavior) -----------------------------
    const candidates = await db
      .collection("alerts")
      .where("created_at", "<=", oneHourAgo)
      .where("created_at", ">", fourHoursAgo)
      .where("outcome.checked_at", "==", null)
      .limit(200)
      .get();

    logger.info(`Outcome tracker: ${candidates.size} alerts to evaluate.`);

    let alertsEvaluated = 0;
    for (const doc of candidates.docs) {
      try {
        const res = await fetch(`${baseUrl}/alerts/evaluate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ alert_id: doc.id }),
        });
        if (res.ok) {
          const body = (await res.json()) as OutcomeResponse;
          await doc.ref.update({
            "outcome.evaluated_at": Timestamp.now(),
            "outcome.status": body.status,
          });
          alertsEvaluated++;
        }
      } catch (e) {
        logger.warn(`Outcome evaluation failed for ${doc.id}:`, e);
      }
    }
    logger.info(`Outcome tracker: evaluated ${alertsEvaluated}/${candidates.size} alerts.`);

    // --- 2) Trading signals (LONG/SHORT) -----------------------------------
    const signalCandidates = await db
      .collection("trading_signals")
      .where("created_at", "<=", oneHourAgo)
      .where("created_at", ">", fourHoursAgo)
      .limit(200)
      .get();

    const pendingSignals = signalCandidates.docs.filter(
      (doc) => !(doc.data() as TradingSignalPayload).outcome?.result
    );

    logger.info(
      `Outcome tracker: ${pendingSignals.length} trading signals to evaluate.`
    );

    let signalsEvaluated = 0;
    for (const doc of pendingSignals) {
      try {
        const data = doc.data() as TradingSignalPayload;
        const res = await fetch(`${baseUrl}/signals/evaluate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            signal_id: doc.id,
            symbol: data.symbol.endsWith("USDT")
              ? data.symbol
              : `${data.symbol}USDT`,
            direction: data.direction,
            entry_price: data.entry_price,
            stop_loss: data.stop_loss,
            take_profit_1: data.take_profit_1,
            take_profit_2: data.take_profit_2,
            created_at: new Date(data.created_at).toISOString(),
          }),
        });
        if (!res.ok) {
          logger.warn(
            `Signal evaluation failed for ${doc.id}: ${res.status} ${res.statusText}`
          );
          continue;
        }

        const body = (await res.json()) as SignalEvaluationResponse;
        const o = body.outcome;

        await doc.ref.update({
          outcome: {
            result: o.result,
            hit_level: o.hit_level,
            profitable_1h: o.profitable_1h ?? null,
            profitable_4h: o.profitable_4h ?? null,
            price_1h: o.price_1h ?? null,
            price_4h: o.price_4h ?? null,
            max_favorable_excursion_pct: o.max_favorable_excursion_pct ?? null,
            max_adverse_excursion_pct: o.max_adverse_excursion_pct ?? null,
            checked_at: Timestamp.fromDate(
              new Date(o.checked_at ?? Date.now())
            ),
          },
        });

        // Feed closed-loop stats only on decisive outcomes.
        if (o.result === "WIN" || o.result === "LOSS") {
          await recordSignalOutcome(
            db,
            {
              coin_id: data.coin_id,
              signal_type: data.signal_type || "unknown",
              // Only LONG/SHORT are persisted; WAIT never reaches Firestore.
              direction: data.direction as "LONG" | "SHORT",
            },
            o.result
          );
        }
        signalsEvaluated++;
      } catch (e) {
        logger.warn(`Signal outcome evaluation failed for ${doc.id}:`, e);
      }
    }
    logger.info(
      `Outcome tracker: evaluated ${signalsEvaluated}/${pendingSignals.length} trading signals.`
    );
  }
);