// Hook: real-time subscription to a setup's win-rate stats (signal_stats).
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/services/firebase";
import { SignalSetupStat } from "@/types";

export function useSignalSetupStats(signalType?: string) {
  const [stats, setStats] = useState<SignalSetupStat | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!signalType) {
      setLoading(false);
      return;
    }
    const ref = doc(db, "signal_stats", `setup_${signalType}`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setStats(snap.data() as SignalSetupStat);
        } else {
          setStats(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [signalType]);

  const winrate =
    stats && (stats.wins + stats.losses) > 0
      ? stats.wins / (stats.wins + stats.losses)
      : null;

  return { stats, winrate, loading };
}