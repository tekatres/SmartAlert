import { useEffect } from "react";
import { clsx } from "clsx";
import { useAppStore } from "@/store/useAppStore";

const TONE: Record<string, string> = {
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  error: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

const ICON: Record<string, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  error: "×",
};

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), t.duration ?? 4500)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur",
            TONE[t.tone]
          )}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
            {ICON[t.tone]}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t.title}</p>
            {t.description && (
              <p className="mt-0.5 text-xs opacity-90">{t.description}</p>
            )}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="rounded p-1 text-current/60 hover:bg-white/10 hover:text-current"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  return useAppStore((s) => s.pushToast);
}
