// Hook: real-time subscription to trading_signals with in-memory reactive fallback
import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/services/firebase";
import { TradingSignalDoc } from "@/types";
import { useAppStore } from "@/store/useAppStore";

export function useSignals(pageSize: number = 20) {
  const liveSignals = useAppStore((s) => s.liveSignals);
  const [firestoreSignals, setFirestoreSignals] = useState<TradingSignalDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "trading_signals"),
      orderBy("created_at", "desc"),
      limit(pageSize)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TradingSignalDoc, "id">),
        }));
        setFirestoreSignals(docs);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [pageSize]);

  // Determine active signals:
  // If liveSignals is present and has items, compare timestamps with firestoreSignals.
  // Prioritize whichever is newer so local live scans update the UI immediately
  // even if Firestore write quotas are exhausted or slow.
  const signals = (() => {
    if (!liveSignals || liveSignals.length === 0) return firestoreSignals;
    if (!firestoreSignals || firestoreSignals.length === 0) return liveSignals;

    const getMs = (ts: any) => {
      if (!ts) return 0;
      if (typeof ts === "number") return ts;
      if (typeof ts === "string") return new Date(ts).getTime();
      if (ts.seconds) return ts.seconds * 1000;
      return 0;
    };

    const latestLiveMs = Math.max(...liveSignals.map((s) => getMs(s.created_at)));
    const latestFsMs = Math.max(...firestoreSignals.map((s) => getMs(s.created_at)));

    return latestLiveMs >= latestFsMs ? liveSignals : firestoreSignals;
  })();

  return { signals, loading: loading && signals.length === 0 };
}
