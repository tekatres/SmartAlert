// Callable: records a CTA event (impression / click / conversion) for A/B testing.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

type CtaType = "impression" | "click" | "conversion";
type CtaSource =
  | "score_tooltip"
  | "paywall_card"
  | "missed_value_widget"
  | "premium_page"
  | "settings";

interface TrackCtaInput {
  type: CtaType;
  source: CtaSource;
  metadata?: Record<string, any>;
}

const VALID_TYPES: CtaType[] = ["impression", "click", "conversion"];
const VALID_SOURCES: CtaSource[] = [
  "score_tooltip",
  "paywall_card",
  "missed_value_widget",
  "premium_page",
  "settings",
];

export const trackCtaEvent = onCall<TrackCtaInput>(
  { region: "us-central1", cors: true },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const uid = req.auth.uid;
    const { type, source, metadata } = req.data || ({} as TrackCtaInput);
    if (!VALID_TYPES.includes(type) || !VALID_SOURCES.includes(source)) {
      throw new HttpsError("invalid-argument", "Invalid type/source.");
    }
    const db = getFirestore();
    await db.collection("cta_events").add({
      user_id: uid,
      type,
      source,
      metadata: metadata || null,
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }
);
