// Callable: creates a Stripe Checkout session for the Premium plan.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import Stripe from "stripe";

const STRIPE_SECRET = defineSecret("STRIPE_SECRET");

const PREMIUM_PRICE_ID = "price_REPLACE_WITH_YOUR_STRIPE_PRICE_ID";
const SUCCESS_URL = "https://your-domain.com/settings?upgraded=1";
const CANCEL_URL = "https://your-domain.com/settings?upgraded=0";

let _stripe: Stripe | null = null;
function getStripe(secret: string): Stripe {
  if (!_stripe) _stripe = new Stripe(secret, { apiVersion: "2025-02-24.acacia" });
  return _stripe;
}

export const createCheckoutSession = onCall<{ price_id?: string }>(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET],
    cors: true,
  },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const uid = req.auth.uid;
    const email = req.auth.token.email;
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    let customerId = userSnap.get("preferences.stripe_customer_id") as string | undefined;

    const stripe = getStripe(STRIPE_SECRET.value());
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { uid },
      });
      customerId = customer.id;
      await userRef.set(
        { preferences: { stripe_customer_id: customerId } },
        { merge: true }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: req.data?.price_id || PREMIUM_PRICE_ID, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { uid },
    });

    return { url: session.url, session_id: session.id };
  }
);
