import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ConversionStats } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import { getFunctionsInstance } from "@/services/firebase";

// Set to true once Cloud Functions are deployed on the Blaze plan.
// While false, all callable hooks return empty/null immediately without
// making any network request — keeps the dashboard working in dev/Spark plan.
const FUNCTIONS_ENABLED = false;

export function useConversionStats(days = 30) {
  const user = useAppStore((s) => s.user);
  const [stats, setStats] = useState<ConversionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!FUNCTIONS_ENABLED || !user) {
      setStats(null);
      return;
    }
    setLoading(true);
    const fn = httpsCallable<{ days?: number }, ConversionStats>(
      getFunctionsInstance(),
      "getConversionStats"
    );
    fn({ days })
      .then(({ data }) => setStats(data))
      .catch((e) => setError(e?.message || "Error"))
      .finally(() => setLoading(false));
  }, [user, days]);

  return { stats, loading, error };
}

export function useTrackCta() {
  return function track(
    type: "impression" | "click" | "conversion",
    source:
      | "score_tooltip"
      | "paywall_card"
      | "missed_value_widget"
      | "premium_page"
      | "settings",
    metadata?: Record<string, any>
  ) {
    if (!FUNCTIONS_ENABLED) return;
    try {
      const fn = httpsCallable(getFunctionsInstance(), "trackCtaEvent");
      fn({ type, source, metadata });
    } catch (e) {
      // fire-and-forget
    }
  };
}
