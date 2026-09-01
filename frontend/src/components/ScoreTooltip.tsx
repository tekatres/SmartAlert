import { useState } from "react";
import { Link } from "react-router-dom";
import { ScoreBreakdown } from "@/types";
import { useTrackCta } from "@/hooks/useConversionStats";

interface ScoreTooltipProps {
  score: number;
  breakdown: ScoreBreakdown | null | undefined;
  isPremium: boolean;
}

export function ScoreTooltip({ score, breakdown, isPremium }: ScoreTooltipProps) {
  const [open, setOpen] = useState(false);
  const track = useTrackCta();

  function handleOpen() {
    setOpen(true);
    if (!isPremium) track("impression", "score_tooltip", { score });
  }

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={handleOpen}
        onMouseLeave={() => setOpen(false)}
        onClick={handleOpen}
        className="rounded p-0.5 text-slate-500 hover:text-slate-300"
        aria-label="¿Por qué este score?"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 8h.01M11 12h1v4h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-7 z-30 w-64 rounded-lg border border-white/10 bg-bg-elevated p-3 text-xs shadow-2xl"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {breakdown && isPremium ? (
            <>
              <p className="font-semibold text-slate-100">Desglose (Premium)</p>
              <p className="mt-1 text-slate-400">{breakdown.narrative}</p>
              <div className="mt-2 space-y-1">
                {breakdown.factors.map((f) => (
                  <div key={f.key} className="flex items-center justify-between">
                    <span className="text-slate-300">{f.label}</span>
                    <span className="font-mono text-slate-500">
                      {Math.round(f.points)}/{f.max_points}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-100">Score {score}</p>
              <p className="mt-1 text-slate-400">
                Este alert se basa en 6 factores: magnitud, volumen, tendencia,
                volatilidad, patrón histórico y ventana de liquidez.
              </p>
              <Link
                to="/premium"
                onClick={() => track("click", "score_tooltip", { score })}
                className="mt-2 inline-block rounded bg-amber-500/20 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30"
              >
                ✦ Ver desglose completo
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
