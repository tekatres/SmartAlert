import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store/useAppStore";
import { AlertCard } from "@/components/AlertCard";
import { PaywallAlertCard } from "@/components/PaywallAlertCard";
import { TradingSignalCard } from "@/components/TradingSignalCard";
import { Filters } from "@/components/Filters";
import { MetricCard, MetricCardSkeleton } from "@/components/MetricCard";
import { AlertListSkeleton } from "@/components/Skeleton";
import { ConversionWidget } from "@/components/ConversionWidget";
import { useAlerts } from "@/hooks/useAlerts";
import { useConversionStats } from "@/hooks/useConversionStats";
import { useSignals } from "@/hooks/useSignals";

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const preferences = useAppStore((s) => s.preferences);
  const authReady = useAppStore((s) => s.authReady);
  const { filtered, loaded } = useAlerts(100);
  const { stats } = useConversionStats(30);
  const { signals } = useSignals(10);

  useEffect(() => {
    if (authReady && !user) navigate("/login", { replace: true });
  }, [authReady, user, navigate]);

  useEffect(() => {
    if (user) {
      const seen = localStorage.getItem("onboarding_seen");
      if (!seen) {
        localStorage.setItem("onboarding_seen", "1");
        navigate("/onboarding", { replace: true });
      }
    }
  }, [user, navigate]);

  const isPremium = preferences?.plan === "premium" || preferences?.plan === "pro";
  const freeHidden = filtered.filter((a) => !isPremium && a.min_tier === "premium");
  const freeVisible = filtered.filter((a) => isPremium || a.min_tier !== "premium");

  const high = freeVisible.filter((a) => a.score >= 75).length;
  const low = freeVisible.filter((a) => a.score < 50).length;
  const avgScore =
    freeVisible.length > 0
      ? Math.round(freeVisible.reduce((s, a) => s + a.score, 0) / freeVisible.length)
      : 0;

  const winrateDelta = stats
    ? Math.max(0, stats.winrate_premium_avg - stats.winrate_free_avg)
    : 0;

  // Show skeleton only until Firestore returns the first snapshot.
  // Using alerts.length === 0 would permanently show skeleton when the
  // collection is empty (no data in Firestore yet).
  const isInitialLoading = !loaded;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bienvenido, {user?.displayName?.split(" ")[0] || "trader"}
        </h1>
        <p className="text-sm text-slate-400">
          Alertas inteligentes en tiempo real, explicadas por IA.
        </p>
      </div>

      {isInitialLoading ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <MetricCardSkeleton key={i} />
            ))}
          </div>
          <Filters />
          <AlertListSkeleton count={4} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard
                  label="Visibles"
                  value={String(freeVisible.length)}
                  hint="filtradas por tu plan"
                />
                <MetricCard label="Score medio" value={String(avgScore)} />
                <MetricCard label="Alta oportunidad" value={String(high)} tone="high" />
                <MetricCard label="Precaución" value={String(low)} tone="low" />
              </div>
            </div>
            <ConversionWidget />
          </div>

          {/* Trading Signals section */}
          {signals.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <span>🎯</span> Señales de Entrada
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-bold text-emerald-300">
                  {signals.length} activa{signals.length > 1 ? "s" : ""}
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {signals.map((s) => (
                  <TradingSignalCard key={s.id} signal={s} />
                ))}
              </div>
            </div>
          )}

          <Filters />

          {freeVisible.length === 0 && freeHidden.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {freeVisible.map((a) => (
                <AlertCard key={a.id} alert={a} isPremium={isPremium} />
              ))}
              {!isPremium &&
                freeHidden.slice(0, 2).map((a) => (
                  <PaywallAlertCard
                    key={a.id}
                    alert={a}
                    reason={a.premium_only_reason || "Setup avanzado"}
                    estimatedWinrateDelta={winrateDelta}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 17l6-6 4 4 8-8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M14 7h7v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-slate-300">No hay alertas que coincidan con tus filtros.</p>
      <p className="mt-1 text-xs text-slate-500">
        Las alertas se generan automáticamente cada pocos minutos.
      </p>
    </div>
  );
}
