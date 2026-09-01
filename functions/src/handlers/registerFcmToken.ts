// Callable: stores the user's FCM token(s) in their Firestore profile.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

interface RegisterTokenInput {
  token: string;
  platform?: "web" | "android" | "ios";
  device_id?: string;
}

export const registerFcmToken = onCall<RegisterTokenInput>(
  { region: "us-central1", cors: true },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = req.auth.uid;
    const { token, platform = "web", device_id } = req.data;

    if (!token || typeof token !== "string") {
      throw new HttpsError("invalid-argument", "token is required.");
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    const newDevice = {
      token,
      platform,
      device_id: device_id || null,
      created_at: FieldValue.serverTimestamp(),
      last_seen: FieldValue.serverTimestamp(),
    };

    if (!userDoc.exists) {
      await userRef.set({
        email: req.auth.token.email || null,
        display_name: req.auth.token.name || null,
        created_at: FieldValue.serverTimestamp(),
        preferences: {
          sensitivity: "medium",
          enabled_types: ["price_surge", "price_dump", "volume_spike", "breakout"],
          min_score: 0,
          muted_coins: [],
          plan: "free",
        },
        fcm_tokens: [newDevice],
      });
    } else {
      const existing: any[] = userDoc.get("fcm_tokens") || [];
      const filtered = existing.filter((d) => d.token !== token);
      filtered.push(newDevice);
      await userRef.update({ fcm_tokens: filtered });
    }

    logger.info(`FCM token registered for uid=${uid} platform=${platform}`);
    return { ok: true };
  }
);
