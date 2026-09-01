// Callable: record user feedback on an alert (was it useful? did they trade it?).
// This is the explicit signal that complements the implicit outcome tracker.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

type FeedbackKind = "useful" | "not_useful" | "acted_on" | "ignored" | "false_positive";

interface FeedbackInput {
  alert_id: string;
  kind: FeedbackKind;
  comment?: string;
}

const VALID: FeedbackKind[] = ["useful", "not_useful", "acted_on", "ignored", "false_positive"];

export const submitAlertFeedback = onCall<FeedbackInput>(
  { region: "us-central1", cors: true },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const uid = req.auth.uid;
    const { alert_id, kind, comment } = req.data || ({} as FeedbackInput);
    if (!alert_id || !VALID.includes(kind)) {
      throw new HttpsError("invalid-argument", "alert_id and valid kind are required.");
    }

    const db = getFirestore();
    await db
      .collection("alert_feedback")
      .doc(`${alert_id}_${uid}`)
      .set({
        alert_id,
        user_id: uid,
        kind,
        comment: comment || null,
        created_at: FieldValue.serverTimestamp(),
      });

    // Update running aggregate on the alert itself
    const alertRef = db.collection("alerts").doc(alert_id);
    await alertRef.set(
      {
        feedback: {
          total: FieldValue.increment(1),
          [kind]: FieldValue.increment(1),
          last_at: Timestamp.now(),
        },
      },
      { merge: true }
    );

    return { ok: true };
  }
);
