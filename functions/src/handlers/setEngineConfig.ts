// Callable: saves the tunable engine thresholds (writes with admin privileges,
// so it works even before the client-side Firestore rules are deployed).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

export interface EngineThresholdInput {
  min_confluence: number;
  min_risk_reward: number;
  min_adx: number;
}

export const setEngineConfig = onCall<EngineThresholdInput>(
  { region: "us-central1", cors: true },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const d = req.data || ({} as EngineThresholdInput);
    const min_confluence = Number(d.min_confluence);
    const min_risk_reward = Number(d.min_risk_reward);
    const min_adx = Number(d.min_adx);

    if (!Number.isFinite(min_confluence) || !Number.isFinite(min_risk_reward) || !Number.isFinite(min_adx)) {
      throw new HttpsError("invalid-argument", "min_confluence, min_risk_reward and min_adx are required.");
    }
    if (min_confluence < 1 || min_confluence > 15) {
      throw new HttpsError("invalid-argument", "min_confluence must be between 1 and 15.");
    }
    if (min_risk_reward < 1 || min_risk_reward > 5) {
      throw new HttpsError("invalid-argument", "min_risk_reward must be between 1 and 5.");
    }
    if (min_adx < 0 || min_adx > 50) {
      throw new HttpsError("invalid-argument", "min_adx must be between 0 and 50.");
    }

    await getFirestore()
      .collection("engine_config")
      .doc("global")
      .set(
        { min_confluence, min_risk_reward, min_adx, updated_at: Timestamp.now() },
        { merge: true }
      );

    return { ok: true };
  }
);