import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { AlertDoc } from "@/types";

interface PaywallAlertCardProps {
  alert: AlertDoc;
  reason: string;
  estimatedWinrateDelta: number; // e.g. +12% extra win rate for premium
}

// Shown to free users when an alert is premium-gated. Blurs the payload and
// surfaces a value-prop CTA. The trick: we hide *just enough* that the user
// can see a real alert existed (FOMO), but not enough to act on it (urgency).
export function PaywallAlertCard({
  alert,
  reason,
  estimatedWinrateDelta,
}: PaywallAlertCardProps) {
  return (
    <div className="card relative overflow-hidden">
      <div className="p-5">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-sm font-semibold">
              {alert.symbol}
            </div>
            <div>
              <p className="text-base font-semibold text-slate-100">
                {alert.name} <span className="text-amber-400">✦ Premium</span>
              </p>
              <p className="text-xs text-slate-400">
                Score <span className="font-mono text-amber-300">{alert.score}</span> ·{" "}
                {reason}
              </p>
            </div>
          </div>
          <Link
            to="/premium"
            className="rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 px-3 py-1 text-xs font-semibold text-bg-base shadow-glow"
          >
            Desbloquear
          </Link>
        </header>

        <div
          aria-hidden
          className="mt-4 select-none space-y-2"
          style={{ filter: "blur(6px)" }}
        >
          <p className="h-3 w-3/4 rounded bg-white/10" />
          <p className="h-3 w-2/3 rounded bg-white/10" />
          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
            <div className="h-8 rounded bg-white/[0.06]" />
            <div className="h-8 rounded bg-white/[0.06]" />
            <div className="h-8 rounded bg-white/[0.06]" />
            <div className="h-8 rounded bg-white/[0.06]" />
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg-base/85 via-bg-base/40 to-transparent" />

      <div className="relative px-5 pb-5">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Por qué esto es Premium
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-200/90">
            <li>✓ Score {alert.score} — sólo el top 20% de señales</li>
            <li>✓ Entrega {`<3 min`} más rápida que free (vs. {`+3 min`} de delay)</li>
            <li>✓ Desglose de los 6 factores que explican la puntuación</li>
            {estimatedWinrateDelta > 0 && (
              <li>✓ Win rate histórico +{estimatedWinrateDelta}% vs. plan free</li>
            )}
          </ul>
          <Link
            to="/premium"
            className={clsx(
              "mt-3 block rounded-md bg-gradient-to-r from-brand-500 to-cyan-400",
              "px-3 py-2 text-center text-sm font-semibold text-bg-base"
            )}
          >
            Ver planes desde 9€/mes →
          </Link>
        </div>
      </div>
    </div>
  );
}
