// Callable: returns conversion stats for the current user.
// Powers the "You missed X% in the last 30 days" widget.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { DEFAULT_PREFS, UserPreferences } from "../repositories";

const DEFAULT_DAYS = 30;

interface StatsInput {
  days?: number;
}

export const getConversionStats = onCall<StatsInput>(
  { region: "us-central1", cors: true },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const uid = req.auth.uid;
    const days = Math.min(90, Math.max(1, req.data?.days || DEFAULT_DAYS));
    const db = getFirestore();

    const userSnap = await db.collection("users").doc(uid).get();
    const prefs: UserPreferences = {
      ...DEFAULT_PREFS,
      ...(userSnap.get("preferences") || {}),
    };
    const tier = prefs.plan || "free";
    const abVariant = userSnap.get("ab_variant") || "A";

    const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1) All alerts in the period (regardless of tier)
    const allSnap = await db
      .collection("alerts")
      .where("created_at", ">=", since)
      .get();

    let totalAlerts = 0;
    let premiumLocked = 0;
    let profitableFree = 0;
    let profitablePremium = 0;
    let freeCount = 0;
    let premiumCount = 0;
    let missedPct = 0;

    for (const a of allSnap.docs) {
      const data = a.data();
      totalAlerts++;
      const isPremiumAlert = data.min_tier === "premium";
      const wasLocked = isPremiumAlert && tier === "free";
      if (wasLocked) premiumLocked++;

      const outcome = data.outcome || {};
      const profitable = outcome.profitable_1h === true;
      if (isPremiumAlert) {
        premiumCount++;
        if (profitable) profitablePremium++;
        if (wasLocked && profitable) missedPct += Math.abs(data.change_pct || 0);
      } else {
        freeCount++;
        if (profitable) profitableFree++;
      }
    }

    // 2) CTA metrics
    const ctaSnap = await db
      .collection("cta_events")
      .where("user_id", "==", uid)
      .where("created_at", ">=", since)
      .get();
    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    ctaSnap.docs.forEach((d) => {
      const k = d.get("type");
      if (k === "impression") impressions++;
      if (k === "click") clicks++;
      if (k === "conversion") conversions++;
    });

    return {
      user_id: uid,
      tier,
      period_days: days,
      total_alerts_seen: totalAlerts,
      premium_alerts_locked: premiumLocked,
      missed_alerts: premiumLocked,
      estimated_missed_pct: Math.round(missedPct * 10) / 10,
      winrate_premium_avg: premiumCount
        ? Math.round((profitablePremium / premiumCount) * 100)
        : 0,
      winrate_free_avg: freeCount
        ? Math.round((profitableFree / freeCount) * 100)
        : 0,
      ab_variant: abVariant,
      cta_impressions: impressions,
      cta_clicks: clicks,
      cta_conversions: conversions,
    };
  }
);
