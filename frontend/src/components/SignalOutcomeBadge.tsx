import { clsx } from "clsx";
import { SignalOutcome } from "@/types";

export function SignalOutcomeBadge({
  outcome,
}: {
  outcome?: SignalOutcome | null;
}) {
  if (!outcome || !outcome.result) return null;

  const styles = {
    WIN: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    LOSS: "text-rose-300 bg-rose-500/10 border-rose-500/30",
    PENDING: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  } as const;

  const labels: Record<string, string> = {
    WIN: "✅ WIN",
    LOSS: "❌ LOSS",
    PENDING: "⏳ Pendiente",
  };

  return (
    <span
      className={clsx(
        "badge border text-xs font-bold px-2 py-0.5",
        styles[outcome.result as keyof typeof styles] ?? styles.PENDING
      )}
      title={
        outcome.result === "WIN"
          ? `TP alcanzado antes que el SL (${outcome.hit_level})`
          : outcome.result === "LOSS"
          ? "SL alcanzado antes que el TP"
          : "Ningún nivel alcanzado todavía"
      }
    >
      {labels[outcome.result] ?? outcome.result}
    </span>
  );
}