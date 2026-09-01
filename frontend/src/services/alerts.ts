import { httpsCallable } from "firebase/functions";
import {
  collection,
  limit as limitFn,
  onSnapshot,
  orderBy,
  query,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
} from "firebase/firestore";

import { db, getFunctionsInstance } from "./firebase";
import { AlertDoc, ConversionStats, UserPreferences, FcmDevice } from "@/types";

const functions = getFunctionsInstance();

// Optional callables (need Cloud Functions deployed). Core flows use direct
// Firestore writes so the app works without Cloud Functions (Spark plan).
export const submitAlertFeedbackFn = httpsCallable<
  { alert_id: string; kind: string; comment?: string },
  { ok: boolean }
>(functions, "submitAlertFeedback");

export const getConversionStatsFn = httpsCallable<
  { days?: number },
  ConversionStats
>(functions, "getConversionStats");

export const trackCtaEventFn = httpsCallable<
  { type: string; source: string; metadata?: Record<string, any> },
  { ok: boolean }
>(functions, "trackCtaEvent");

export const createCheckoutSessionFn = httpsCallable<
  { price_id?: string },
  { url: string; session_id: string }
>(functions, "createCheckoutSession");

export function watchAlerts(
  callback: (alerts: AlertDoc[]) => void,
  pageSize = 50
): () => void {
  const q = query(
    collection(db, "alerts"),
    orderBy("created_at", "desc"),
    limitFn(pageSize)
  );
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    callback(items as AlertDoc[]);
  });
}

export async function savePreferences(uid: string, prefs: UserPreferences) {
  const ref = doc(db, "users", uid);
  // merge:true creates the document if it doesn't exist yet
  // (Cloud Function onAuthCreate may not be deployed in local dev)
  await setDoc(
    ref,
    {
      preferences: prefs,
      updated_at: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function ensureUserDoc(uid: string, email: string | null, displayName: string | null) {
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      email: email ?? "",
      display_name: displayName ?? "",
      role: "user",
      created_at: serverTimestamp(),
      preferences: {
        sensitivity: "medium",
        enabled_types: ["price_surge", "price_dump", "volume_spike", "breakout"],
        min_score: 0,
        muted_coins: [],
        plan: "free",
      },
    },
    { merge: true }   // won't overwrite if already exists
  );
}

export async function upsertFcmTokenLocal(uid: string, device: FcmDevice) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    fcm_tokens: arrayUnion({ ...device, last_seen: new Date().toISOString() }),
  });
}

// ---------------------------------------------------------------------------
// Engine thresholds (engine_config/global) — direct Firestore (no Cloud Functions).
// ---------------------------------------------------------------------------

export interface EngineThresholdConfig {
  min_confluence: number;    // weighted votes (of 15)
  min_risk_reward: number;   // minimum R:R
  min_adx: number;           // minimum ADX to consider a trend
}

// Backtest-calibrated defaults (best EV from grid search: EV≈+0.19R).
export const ENGINE_CONFIG_DEFAULTS: EngineThresholdConfig = {
  min_confluence: 8,
  min_risk_reward: 1.2,
  min_adx: 25,
};

// Presets per "tramo" de sensibilidad (basados en el backtest 30d).
export const ENGINE_PRESETS: Record<
  "baja" | "media" | "alta",
  EngineThresholdConfig
> = {
  baja: { min_confluence: 8, min_risk_reward: 1.5, min_adx: 25 }, // estricto: menos señales, calidad
  media: { min_confluence: 8, min_risk_reward: 1.2, min_adx: 25 }, // óptimo calibrado (EV +0.19R)
  alta: { min_confluence: 6, min_risk_reward: 1.2, min_adx: 15 },  // muchas más señales
};

export function watchEngineConfig(
  callback: (cfg: EngineThresholdConfig) => void
): () => void {
  const ref = doc(db, "engine_config", "global");
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      callback(ENGINE_CONFIG_DEFAULTS);
      return;
    }
    const d = snap.data();
    callback({
      min_confluence: Number(d.min_confluence) || ENGINE_CONFIG_DEFAULTS.min_confluence,
      min_risk_reward: Number(d.min_risk_reward) || ENGINE_CONFIG_DEFAULTS.min_risk_reward,
      min_adx: Number(d.min_adx) || ENGINE_CONFIG_DEFAULTS.min_adx,
    });
  });
}

export async function saveEngineConfig(cfg: EngineThresholdConfig) {
  await setDoc(
    doc(db, "engine_config", "global"),
    { ...cfg, updated_at: serverTimestamp() },
    { merge: true }
  );
}
