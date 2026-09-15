import { create } from "zustand";
import { AlertDoc, UserPreferences, TradingSignalDoc } from "@/types";
import { User } from "firebase/auth";

const STORAGE_SIGNALS_KEY = "smartalert_live_signals";

const loadCachedSignals = (): TradingSignalDoc[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_SIGNALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

interface AppState {
  // auth
  user: User | null;
  authReady: boolean;
  preferences: UserPreferences | null;

  // alerts
  alerts: AlertDoc[];
  filterType: AlertDoc["type"] | "all";
  searchQuery: string;
  mutedCoinInput: string;

  // signals
  liveSignals: TradingSignalDoc[];

  // ui
  toasts: Toast[];
  theme: "dark" | "light";

  // actions
  setUser: (u: User | null) => void;
  setAuthReady: (v: boolean) => void;
  setPreferences: (p: UserPreferences | null) => void;
  setAlerts: (a: AlertDoc[]) => void;
  setFilterType: (t: AlertDoc["type"] | "all") => void;
  setSearchQuery: (q: string) => void;
  setMutedCoinInput: (q: string) => void;
  setLiveSignals: (signals: TradingSignalDoc[]) => void;
  setTheme: (t: "dark" | "light") => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "info" | "success" | "warning" | "error";
  duration?: number;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  authReady: false,
  preferences: null,
  alerts: [],
  filterType: "all",
  searchQuery: "",
  mutedCoinInput: "",
  liveSignals: loadCachedSignals(),
  toasts: [],
  theme: "dark",

  setUser: (user) => set({ user }),
  setAuthReady: (authReady) => set({ authReady }),
  setPreferences: (preferences) => set({ preferences }),
  setAlerts: (alerts) => set({ alerts }),
  setFilterType: (filterType) => set({ filterType }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setMutedCoinInput: (mutedCoinInput) => set({ mutedCoinInput }),
  setLiveSignals: (liveSignals) => {
    try {
      localStorage.setItem(STORAGE_SIGNALS_KEY, JSON.stringify(liveSignals));
    } catch {}
    set({ liveSignals });
  },
  setTheme: (theme) => set({ theme }),
  pushToast: (t) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    set((s) => ({ toasts: [...s.toasts, { id, ...t }] }));
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export type { Toast };
