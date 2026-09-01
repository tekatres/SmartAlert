import { Link } from "react-router-dom";
import { useConversionStats, useTrackCta } from "@/hooks/useConversionStats";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";

export function ConversionWidget() {
  const { stats, loading } = useConversionStats(30);
  const track = useTrackCta();
  const user = useAuth().user;
  const seen = useRef(false);

  // Fire impression once per mount
  useEffect(() => {
    if (!stats || seen.current) return;
    seen.current = true;
    track("impression", "missed_value_widget", {
      locked: stats.premium_alerts_locked,
      missed_pct: stats.estimated_missed_pct,
    });
  }, [stats, track]);

  if (!user) return null;
  if (stats?.tier && stats.tier !== "free") return null; // premium users don't see this

  if (loading) {
    return (
      <div className="card p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-2 h-7 w-2/3 animate-pulse rounded bg-white/[0.06]" />
      </div>
    );
  }

  if (!stats) return null;

  const hasData = stats.premium_alerts_locked > 0;
  const winrateDelta = Math.max(0, stats.winrate_premium_avg - stats.winrate_free_avg);

  return (
    <div className="card relative overflow-hidden border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-bg-surface to-cyan-500/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Tu actividad · últimos {stats.period_days} días
          </p>
          <h3 className="mt-1 text-base font-semibold">
            {hasData
              ? `Te has perdido ${stats.premium_alerts_locked} alertas premium`
              : "Aún no has visto alertas premium bloqueadas"}
          </h3>
        </div>
        <span className="text-2xl">📈</span>
      </div>

      {hasData ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat
            label="Alertas bloqueadas"
            value={String(stats.premium_alerts_locked)}
            tone="text-amber-300"
          />
          <Stat
            label="% medio perdido"
            value={`${stats.estimated_missed_pct.toFixed(1)}%`}
            tone="text-rose-300"
            hint="en movimientos que habrían sido rentables"
          />
          <Stat
            label="Win rate Premium"
            value={`${stats.winrate_premium_avg}%`}
            tone="text-emerald-300"
            hint={
              winrateDelta > 0
                ? `+${winrateDelta}% vs free`
                : `vs ${stats.winrate_free_avg}% free`
            }
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          Activa las notificaciones para empezar a recibir alertas. Verás aquí
          el valor acumulado que podrías desbloquear con Premium.
        </p>
      )}

      <Link
        to="/premium"
        onClick={() => track("click", "missed_value_widget")}
        className="mt-4 block rounded-md bg-gradient-to-r from-amber-500 to-amber-400 px-3 py-2 text-center text-sm font-semibold text-bg-base"
      >
        ✦ Desbloquear Premium →
      </Link>

      <p className="mt-2 text-center text-[10px] text-slate-500">
        Cálculo basado en outcomes verificados de las últimas {stats.period_days} alertas
        generadas por el motor.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "text-slate-100",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
