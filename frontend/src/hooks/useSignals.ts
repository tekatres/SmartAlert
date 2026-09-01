// Hook: real-time subscription to trading_signals collection
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

export function useSignals(pageSize: number = 20) {
  const [signals, setSignals] = useState<TradingSignalDoc[]>([]);
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
        setSignals(docs);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [pageSize]);

  return { signals, loading };
}
