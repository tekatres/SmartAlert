// Callable: updates the user's alert preferences.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { DEFAULT_PREFS, UserPreferences } from "../repositories";

interface UpdatePreferencesInput {
  sensitivity?: "low" | "medium" | "high";
  enabled_types?: string[];
  min_score?: number;
  muted_coins?: string[];
  plan?: "free" | "premium";
}

const ALLOWED_TYPES = new Set([
  "price_surge",
  "price_dump",
  "volume_spike",
  "breakout",
]);

export const updateUserPreferences = onCall<UpdatePreferencesInput>(
  { region: "us-central1", cors: true },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = req.auth.uid;
    const incoming = req.data || {};

    if (incoming.sensitivity && !["low", "medium", "high"].includes(incoming.sensitivity)) {
      throw new HttpsError("invalid-argument", "Invalid sensitivity.");
    }
    if (incoming.enabled_types && !incoming.enabled_types.every((t) => ALLOWED_TYPES.has(t))) {
      throw new HttpsError("invalid-argument", "Invalid enabled_types.");
    }
    if (incoming.min_score !== undefined) {
      const s = Number(incoming.min_score);
      if (Number.isNaN(s) || s < 0 || s > 100) {
        throw new HttpsError("invalid-argument", "min_score must be 0-100.");
      }
      incoming.min_score = s;
    }

    const update: Partial<UserPreferences> & { updated_at: any } = {
      updated_at: FieldValue.serverTimestamp(),
    };
    if (incoming.sensitivity) update.sensitivity = incoming.sensitivity;
    if (incoming.enabled_types) update.enabled_types = incoming.enabled_types;
    if (incoming.min_score !== undefined) update.min_score = incoming.min_score;
    if (incoming.muted_coins) update.muted_coins = incoming.muted_coins;
    if (incoming.plan) update.plan = incoming.plan;

    const db = getFirestore();
    await db
      .collection("users")
      .doc(uid)
      .set({ preferences: { ...DEFAULT_PREFS, ...update } }, { merge: true });

    return { ok: true, preferences: { ...DEFAULT_PREFS, ...update } };
  }
);
