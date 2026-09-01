import { useEffect, useState } from "react";
import { watchAlerts } from "@/services/alerts";
import { useAppStore } from "@/store/useAppStore";

export function useAlerts(pageSize = 50) {
  const { alerts, setAlerts, filterType, searchQuery, preferences } = useAppStore();
  const isPremium = preferences?.plan === "premium" || preferences?.plan === "pro";
  // True once Firestore has returned the first snapshot (even if empty).
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const unsub = watchAlerts((items) => {
      setAlerts(items);
      setLoaded(true);
    }, pageSize);
    return () => unsub();
  }, [setAlerts, pageSize]);

  const filtered = alerts
    .filter((a) => {
      if (filterType !== "all" && a.type !== filterType) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !a.symbol.toLowerCase().includes(q) &&
          !a.name.toLowerCase().includes(q) &&
          !a.title.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      // For free users, premium-only alerts go to the bottom (so we surface
      // the upgrade pitch only after the free content).
      if (!isPremium) {
        const aLocked = a.min_tier === "premium" ? 1 : 0;
        const bLocked = b.min_tier === "premium" ? 1 : 0;
        if (aLocked !== bLocked) return aLocked - bLocked;
      }
      // Newest first within each group (Firestore already orders by created_at desc)
      return 0;
    });

  return { alerts, filtered, loaded };
}
