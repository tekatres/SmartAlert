// Stripe webhook for the Premium upgrade flow.
// Listens to checkout.session.completed and customer.subscription.deleted
// and updates the user's `preferences.plan` in Firestore.
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

const STRIPE_SECRET = defineSecret("STRIPE_SECRET");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// In-memory Stripe client cache (re-used across invocations)
let _stripe: Stripe | null = null;
function getStripe(secret: string): Stripe {
  if (!_stripe) _stripe = new Stripe(secret, { apiVersion: "2025-02-24.acacia" });
  return _stripe;
}

export const stripeWebhook = onRequest(
  {
    region: "us-central1",
    cors: false,
    memory: "256MiB",
    secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    const sig = req.header("stripe-signature");
    if (!sig) {
      res.status(400).send("Missing stripe-signature");
      return;
    }

    const stripe = getStripe(STRIPE_SECRET.value());
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody,
        sig,
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error("Invalid Stripe signature", err);
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
      return;
    }

    const db = getFirestore();

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const uid = session.client_reference_id || session.metadata?.uid;
          if (!uid) {
            logger.warn("checkout.session.completed without uid");
            break;
          }
          await db
            .collection("users")
            .doc(uid)
            .set(
              {
                preferences: {
                  plan: "premium",
                  premium_since: FieldValue.serverTimestamp(),
                  stripe_customer_id: session.customer as string,
                },
              },
              { merge: true }
            );
          logger.info(`User ${uid} upgraded to premium.`);
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;
          const usersSnap = await db
            .collection("users")
            .where("preferences.stripe_customer_id", "==", customerId)
            .limit(1)
            .get();
          if (!usersSnap.empty) {
            await usersSnap.docs[0].ref.set(
              {
                preferences: {
                  plan: "free",
                  premium_cancelled_at: FieldValue.serverTimestamp(),
                },
              },
              { merge: true }
            );
          }
          break;
        }
        default:
          logger.info(`Unhandled Stripe event: ${event.type}`);
      }
      res.json({ received: true });
    } catch (err) {
      logger.error("Stripe webhook handler error", err);
      res.status(500).send("Handler error");
    }
  }
);
