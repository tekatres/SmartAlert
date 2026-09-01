import { clsx } from "clsx";
import { ScoreBreakdown, ScoreFactor } from "@/types";

const FACTOR_ICONS: Record<string, string> = {
  magnitude: "📏",
  volume: "🔊",
  trend: "📈",
  volatility: "⚡",
  pattern: "🔁",
  timing: "🕐",
};

function scoreColor(score: number) {
  if (score >= 75) return "text-score-high";
  if (score >= 50) return "text-score-medium";
  return "text-score-low";
}

function factorColor(points: number, max: number) {
  const ratio = max > 0 ? points / max : 0;
  if (ratio >= 0.7) return "bg-emerald-500";
  if (ratio >= 0.4) return "bg-amber-500";
  return "bg-rose-500";
}

export function ScoreBreakdownPanel({
  breakdown,
  isPremium,
}: {
  breakdown: ScoreBreakdown | null | undefined;
  isPremium: boolean;
}) {
  if (!breakdown) {
    return (
      <div className="card border-dashed bg-white/[0.02] p-4">
        <div className="flex items-center gap-2">
          <span className="text-amber-400">✦</span>
          <p className="text-sm font-semibold">Desglose premium</p>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {isPremium
            ? "Este alert no incluye desglose de factores."
            : "Mejora a Premium para ver por qué el motor puntuó este alert así."}
        </p>
      </div>
    );
  }

  return (
    <section className="card p-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Desglose de score
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{breakdown.narrative}</p>
        </div>
        <div className="text-right">
          <p className={clsx("text-2xl font-semibold tabular-nums", scoreColor(breakdown.total))}>
            {breakdown.total}
          </p>
          <p className="text-[10px] text-slate-500">
            Confianza {(breakdown.confidence * 100).toFixed(0)}%
          </p>
        </div>
      </header>

      <div className="mt-4 space-y-3">
        {breakdown.factors.map((f) => (
          <FactorBar key={f.key} factor={f} />
        ))}
      </div>

      <p className="mt-4 text-[10px] text-slate-500">
        Modelo {breakdown.model_version} · ponderado por tier del usuario
      </p>
    </section>
  );
}

function FactorBar({ factor }: { factor: ScoreFactor }) {
  const ratio = factor.max_points > 0 ? (factor.points / factor.max_points) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span>{FACTOR_ICONS[factor.key] ?? "•"}</span>
          <span className="font-medium text-slate-300">{factor.label}</span>
        </div>
        <span className="font-mono text-slate-400">
          {Math.round(factor.points)}/{factor.max_points}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={clsx("h-full transition-all", factorColor(factor.points, factor.max_points))}
          style={{ width: `${Math.max(2, ratio)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{factor.explanation}</p>
    </div>
  );
}
