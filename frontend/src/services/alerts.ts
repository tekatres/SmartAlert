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

export const registerFcmTokenFn = httpsCallable<
  { token: string; platform?: "web" | "android" | "ios"; device_id?: string },
  { ok: boolean }
>(functions, "registerFcmToken");

export const updateUserPreferencesFn = httpsCallable<
  Partial<UserPreferences>,
  { ok: boolean; preferences: UserPreferences }
>(functions, "updateUserPreferences");

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
