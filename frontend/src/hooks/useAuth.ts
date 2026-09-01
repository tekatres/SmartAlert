import { useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/services/firebase";
import { ensureUserDoc } from "@/services/alerts";
import { useAppStore } from "@/store/useAppStore";
import { UserPreferences } from "@/types";

const DEFAULT_PREFS: UserPreferences = {
  sensitivity: "medium",
  enabled_types: ["price_surge", "price_dump", "volume_spike", "breakout"],
  min_score: 0,
  muted_coins: [],
  plan: "free",
};

export function useAuth() {
  const { user, setUser, setAuthReady, setPreferences, preferences } = useAppStore();
  // Holds the active Firestore unsubscribe so we can clean it up on sign-out.
  const unsubSnapshotRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);

      // Tear down any previous snapshot listener immediately.
      if (unsubSnapshotRef.current) {
        unsubSnapshotRef.current();
        unsubSnapshotRef.current = null;
      }

      if (!u) {
        setPreferences(null);
        return;
      }

      // Ensure the user document exists first, then attach the snapshot.
      // This prevents a permission-denied error that occurs when the snapshot
      // fires before the document is created (or before the auth token fully
      // propagates to Firestore).
      ensureUserDoc(u.uid, u.email, u.displayName)
        .catch(() => {
          // If ensureUserDoc fails (e.g. doc already exists with merge:true
          // that's fine), still attach the listener.
        })
        .finally(() => {
          const ref = doc(db, "users", u.uid);
          unsubSnapshotRef.current = onSnapshot(
            ref,
            (snap) => {
              const data = snap.data();
              const prefs = (data?.preferences as UserPreferences) || DEFAULT_PREFS;
              setPreferences(prefs);
            },
            (err) => {
              // permission-denied can still occur transiently during token
              // refresh; log it but don't crash.
              console.warn("[useAuth] snapshot error:", err.code);
            }
          );
        });
    });

    return () => {
      unsub();
      if (unsubSnapshotRef.current) {
        unsubSnapshotRef.current();
        unsubSnapshotRef.current = null;
      }
    };
  }, [setUser, setAuthReady, setPreferences]);

  return { user, authReady: useAppStore((s) => s.authReady), preferences };
}
