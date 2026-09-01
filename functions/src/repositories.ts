// Shared helpers for working with Firestore.
import {
  FieldValue,
  Firestore,
  Query,
  Timestamp,
  WriteBatch,
} from "firebase-admin/firestore";
import { AlertPayload, TradingSignalPayload } from "./types";

export interface UserPreferences {
  sensitivity: "low" | "medium" | "high";
  enabled_types: string[]; // e.g. ["price_surge", "volume_spike"]
  min_score: number; // 0-100
  muted_coins: string[]; // coin_ids
  plan: "free" | "premium";
  updated_at?: FirebaseFirestore.FieldValue;
}

export const DEFAULT_PREFS: UserPreferences = {
  sensitivity: "medium",
  enabled_types: ["price_surge", "price_dump", "volume_spike", "breakout"],
  min_score: 0,
  muted_coins: [],
  plan: "free",
};

export function userMatchesAlert(
  prefs: UserPreferences,
  alert: AlertPayload
): boolean {
  if (alert.score < prefs.min_score) return false;
  if (!prefs.enabled_types.includes(alert.type)) return false;
  if (prefs.muted_coins.includes(alert.coin_id)) return false;
  return true;
}

export async function persistAlerts(
  db: Firestore,
  alerts: AlertPayload[]
): Promise<string[]> {
  if (!alerts.length) return [];
  const col = db.collection("alerts");
  const ids: string[] = [];
  // Chunk to keep batches under the 500 write limit.
  for (let i = 0; i < alerts.length; i += 400) {
    const batch: WriteBatch = db.batch();
    alerts.slice(i, i + 400).forEach((alert) => {
      const ref = col.doc(alert.id);
      batch.set(
        ref,
        {
          ...alert,
          created_at: Timestamp.fromDate(new Date(alert.created_at)),
          expires_at: alert.expires_at
            ? Timestamp.fromDate(new Date(alert.expires_at))
            : null,
          delivered_to: [], // populated when FCM is sent
        },
        { merge: true }
      );
      ids.push(ref.id);
    });
    await batch.commit();
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Trading signals persistence
// ---------------------------------------------------------------------------

export async function persistTradingSignals(
  db: Firestore,
  signals: TradingSignalPayload[]
): Promise<string[]> {
  if (!signals.length) return [];
  const col = db.collection("trading_signals");
  const ids: string[] = [];
  for (let i = 0; i < signals.length; i += 400) {
    const batch: WriteBatch = db.batch();
    signals.slice(i, i + 400).forEach((signal) => {
      const ref = col.doc(signal.id);
      batch.set(
        ref,
        {
          ...signal,
          created_at: Timestamp.fromDate(new Date(signal.created_at)),
          expires_at: signal.expires_at
            ? Timestamp.fromDate(new Date(signal.expires_at))
            : null,
        },
        { merge: true }
      );
      ids.push(ref.id);
    });
    await batch.commit();
  }
  return ids;
}

export async function findMatchingUsers(
  db: Firestore,
  alert: AlertPayload
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const q: Query = db
    .collection("users")
    .where("preferences.enabled_types", "array-contains", alert.type)
    .where("preferences.min_score", "<=", alert.score);
  const snap = await q.get();
  return snap.docs.filter((doc) => {
    const data = doc.data();
    const prefs: UserPreferences = { ...DEFAULT_PREFS, ...(data.preferences || {}) };
    return userMatchesAlert(prefs, alert);
  });
}

// ---------------------------------------------------------------------------
// Signal outcome statistics (closed-loop learning)
// ---------------------------------------------------------------------------

export interface SignalOutcomeStat {
  coin_id: string;
  signal_type: string;
  direction: "LONG" | "SHORT";
}

/**
 * Increments win/loss counters for a signal's setup. Writes denormalized
 * aggregates in `signal_stats` so the frontend can show win-rate per setup
 * and per coin+setup without needing composite indexes on outcomes.
 */
export async function recordSignalOutcome(
  db: Firestore,
  signal: SignalOutcomeStat,
  result: "WIN" | "LOSS"
): Promise<void> {
  const col = db.collection("signal_stats");
  const wins = FieldValue.increment(result === "WIN" ? 1 : 0);
  const losses = FieldValue.increment(result === "LOSS" ? 1 : 0);
  const total = FieldValue.increment(1);

  const setupKey = signal.signal_type || "unknown";
  const stamp = Timestamp.now();

  const setupDoc = {
    signal_type: setupKey,
    wins,
    losses,
    total,
    updated_at: stamp,
  };
  await col.doc(`setup_${setupKey}`).set(setupDoc, { merge: true });

  const coinSetupDoc = {
    coin_id: signal.coin_id,
    signal_type: setupKey,
    direction: signal.direction,
    wins,
    losses,
    total,
    updated_at: stamp,
  };
  await col
    .doc(`coin_${signal.coin_id}_${setupKey}`)
    .set(coinSetupDoc, { merge: true });

  await col.doc("_meta").set(
    {
      wins,
      losses,
      total,
      updated_at: stamp,
    },
    { merge: true }
  );
}
