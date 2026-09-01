import { create } from "zustand";
import { AlertDoc, UserPreferences } from "@/types";

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

import { User } from "firebase/auth";

export const useAppStore = create<AppState>((set) => ({
  user: null,
  authReady: false,
  preferences: null,
  alerts: [],
  filterType: "all",
  searchQuery: "",
  mutedCoinInput: "",
  toasts: [],
  theme: "dark",

  setUser: (user) => set({ user }),
  setAuthReady: (authReady) => set({ authReady }),
  setPreferences: (preferences) => set({ preferences }),
  setAlerts: (alerts) => set({ alerts }),
  setFilterType: (filterType) => set({ filterType }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setMutedCoinInput: (mutedCoinInput) => set({ mutedCoinInput }),
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
