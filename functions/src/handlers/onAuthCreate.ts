// Triggered when a new Firebase Auth user is created.
// Creates the Firestore profile with default preferences. This is the
// single source of truth — the client MUST NOT create the user doc.
import { beforeUserCreated } from "firebase-functions/v2/identity";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();

// A/B test variants for paywall UX. 50/50 split, hashed by uid.
const AB_VARIANTS = ["A", "B"] as const;
type AbVariant = (typeof AB_VARIANTS)[number];

function assignVariant(uid: string): AbVariant {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  return AB_VARIANTS[Math.abs(hash) % AB_VARIANTS.length];
}

export const onAuthCreate = beforeUserCreated({ region: "us-central1" }, async (event) => {
  const user = event.data;
  if (!user) return;

  const db = getFirestore();
  const ref = db.collection("users").doc(user.uid);

  await ref.set(
    {
      email: user.email || null,
      display_name: user.displayName || null,
      photo_url: user.photoURL || null,
      provider: user.providerData?.[0]?.providerId || "unknown",
      created_at: FieldValue.serverTimestamp(),
      role: "user",
      ab_variant: assignVariant(user.uid),
      preferences: {
        sensitivity: "medium",
        enabled_types: ["price_surge", "price_dump", "volume_spike", "breakout"],
        min_score: 0,
        muted_coins: [],
        plan: "free",
      },
      fcm_tokens: [],
    },
    { merge: true }
  );
});
