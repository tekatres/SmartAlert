import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { useAppStore } from "@/store/useAppStore";
import { AlertCard } from "@/components/AlertCard";
import { PaywallAlertCard } from "@/components/PaywallAlertCard";
import { TradingSignalCard } from "@/components/TradingSignalCard";
import { DailyOpportunityBanner } from "@/components/DailyOpportunityBanner";
import { MultiChartSplitView } from "@/components/MultiChartSplitView";
import { Filters } from "@/components/Filters";
import { MetricCard, MetricCardSkeleton } from "@/components/MetricCard";
import { AlertListSkeleton } from "@/components/Skeleton";
import { ConversionWidget } from "@/components/ConversionWidget";
import { useAlerts } from "@/hooks/useAlerts";
import { useConversionStats } from "@/hooks/useConversionStats";
import { useSignals } from "@/hooks/useSignals";
import { scanLiveMarket } from "@/services/liveScanner";

import { ConfluenceHeatmap } from "@/components/ConfluenceHeatmap";
import { PaperTradingModal } from "@/components/PaperTradingModal";
import { PaperTradingPanel } from "@/components/PaperTradingPanel";
import { fetchMarketSentiment, MarketSentimentData } from "@/services/marketSentiment";

// Auto-scan interval: 4 hours in milliseconds
const AUTO_SCAN_INTERVAL_MS = 4 * 60 * 60 * 1000;
const LAST_SCAN_KEY = "smartalert_last_scan_ts"; // ISO timestamp string

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const preferences = useAppStore((s) => s.preferences);
  const authReady = useAppStore((s) => s.authReady);
  const { filtered, loaded } = useAlerts(100);
  const { stats } = useConversionStats(30);
  const { signals } = useSignals(20);
  const [viewMode, setViewMode] = useState<"list" | "sim" | "split" | "compact" | "heatmap">("list");
  const [autoScanStatus, setAutoScanStatus] = useState<"idle" | "scanning" | "done">("idle");
  const [lastScanTime, setLastScanTime] = useState<string | null>(() => {
    const ts = localStorage.getItem(LAST_SCAN_KEY);
    if (!ts) return null;
    try {
      return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  });
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [sentiment, setSentiment] = useState<MarketSentimentData | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchMarketSentiment().then(setSentiment);
  }, []);

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

  // -------------------------------------------------------
  // AUTO-SCAN LOGIC
  // -------------------------------------------------------
  const runAutoScan = async () => {
    setAutoScanStatus("scanning");
    try {
      await scanLiveMarket(6);
      const isoNow = new Date().toISOString();
      localStorage.setItem(LAST_SCAN_KEY, isoNow);
      const displayTime = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      setLastScanTime(displayTime);
    } catch {
      // Silent fail — user can retry manually via banner button
    } finally {
      setAutoScanStatus("done");
      setTimeout(() => setAutoScanStatus("idle"), 3000);
    }
  };

  useEffect(() => {
    if (!user) return;

    // Read the single unified ISO timestamp for the last scan
    const lastScanIso = localStorage.getItem(LAST_SCAN_KEY);
    const lastScanMs = lastScanIso ? new Date(lastScanIso).getTime() : 0;
    const elapsed = Date.now() - lastScanMs;
    const shouldScan = !lastScanMs || elapsed > AUTO_SCAN_INTERVAL_MS;

    if (shouldScan) {
      // Small delay so Firestore subscription is ready first
      const initialTimer = setTimeout(() => runAutoScan(), 1500);

      // Schedule recurring scans every 4 hours
      scanTimerRef.current = setInterval(() => runAutoScan(), AUTO_SCAN_INTERVAL_MS);

      return () => {
        clearTimeout(initialTimer);
        if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      };
    } else {
      // Already scanned recently — schedule the next one at the right time
      const nextScanIn = AUTO_SCAN_INTERVAL_MS - elapsed;

      const nextTimer = setTimeout(() => {
        runAutoScan();
        scanTimerRef.current = setInterval(() => runAutoScan(), AUTO_SCAN_INTERVAL_MS);
      }, nextScanIn);

      return () => {
        clearTimeout(nextTimer);
        if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      };
    }
  }, [user]);

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

  const isInitialLoading = !loaded;

  return (
    <div className="space-y-6">
      {/* ---- HEADER ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-100">
            Bienvenido, {user?.displayName?.split(" ")[0] || "trader"} 👋
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-slate-400">
              SmartAlert Futures · 20 pares · Motor de 7 Pilares
            </p>
            {/* Auto-scan status badge */}
            {autoScanStatus === "scanning" && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                <span className="animate-spin">🔄</span> Escaneando 20 pares...
              </span>
            )}
            {autoScanStatus === "done" && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                ✅ Mercado actualizado
              </span>
            )}
            {autoScanStatus === "idle" && lastScanTime && (
              <span className="flex items-center gap-1 rounded-full bg-slate-800/80 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                🕐 Último escaneo: <strong className="text-slate-300">{lastScanTime}</strong>
                &nbsp;· Próximo en ~4h
              </span>
            )}
            {autoScanStatus === "idle" && !lastScanTime && (
              <span className="text-[10px] text-slate-500 font-mono">
                Sin escaneos previos · Iniciando en breve...
              </span>
            )}
          </div>
        </div>

        {/* View mode toggle + Paper Trading button */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowPaperModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all shadow-md"
          >
            🎮 Simulador ($10,000)
          </button>

          <div className="flex items-center gap-1 rounded-xl bg-slate-900 p-1 border border-slate-800">
            <button
              onClick={() => setViewMode("list")}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                viewMode === "list"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              📋 Lista
            </button>
            <button
              onClick={() => setViewMode("sim")}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                viewMode === "sim"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              🎮 Panel Simulador + Chart
            </button>
            <button
              onClick={() => setViewMode("heatmap")}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                viewMode === "heatmap"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              🔥 Mapa de Calor
            </button>
            <button
              onClick={() => setViewMode("compact")}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                viewMode === "compact"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              ⚡ Compacto
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                viewMode === "split"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              🖥️ Multi-Chart
            </button>
          </div>
        </div>
      </div>

      {/* ---- SENTIMENT & MACRO RISK BAR ---- */}
      {sentiment && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
              Sentimiento Crypto:
            </span>
            <span className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-mono font-bold text-amber-300">
              {sentiment.fearAndGreedValue}/100 ({sentiment.fearAndGreedClassification})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {sentiment.shortWarning && (
              <span className="text-amber-400 font-medium">
                ⚠️ Miedo Extremo: Squeezes bruscos posibles en SHORT.
              </span>
            )}
            {sentiment.longWarning && (
              <span className="text-amber-400 font-medium">
                ⚠️ Codicia Extrema: Correcciones bruscas posibles en LONG.
              </span>
            )}
            {!sentiment.shortWarning && !sentiment.longWarning && (
              <span className="text-slate-400">
                Mercado cuantitativo alineado · Actualizado {sentiment.updatedAt}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ---- DAILY BANNER ---- */}
      <DailyOpportunityBanner signals={signals} />

      {/* ---- VIEWS ---- */}
      {viewMode === "sim" ? (
        <PaperTradingPanel signals={signals} />
      ) : viewMode === "heatmap" ? (
        <ConfluenceHeatmap signals={signals} />
      ) : viewMode === "split" ? (
        <MultiChartSplitView signals={signals} />
      ) : viewMode === "compact" ? (
        <CompactSignalsView signals={signals} />
      ) : isInitialLoading ? (
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

          {signals.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-300">
                  <span>🎯</span> Señales Activas de Futuros
                  <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                    {signals.length} activa{signals.length > 1 ? "s" : ""}
                  </span>
                </h2>
              </div>
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

      <PaperTradingModal
        isOpen={showPaperModal}
        onClose={() => setShowPaperModal(false)}
      />
    </div>
  );
}

// -------------------------------------------------------
// COMPACT VIEW — All signals in one screen, no scroll
// -------------------------------------------------------
import { Link } from "react-router-dom";
import type { TradingSignalDoc } from "@/types";

function CompactSignalsView({ signals }: { signals: TradingSignalDoc[] }) {
  if (signals.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        <p className="text-slate-400 text-sm">No hay señales activas. Pulsa «Analizar Mercado» para escanear.</p>
      </div>
    );
  }

  const sorted = [...signals].sort((a, b) => b.confluence_score - a.confluence_score);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 flex items-center gap-2">
          ⚡ Vista Compacta · {signals.length} señales activas
        </h2>
        <span className="text-[10px] text-slate-500">
          Ordenadas por confluencia descendente
        </span>
      </div>

      {/* Table header */}
      <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
        <span className="col-span-1">Dir.</span>
        <span className="col-span-2">Par</span>
        <span className="col-span-2">Precio</span>
        <span className="col-span-1">Lev.</span>
        <span className="col-span-1">SL%</span>
        <span className="col-span-1">TP1%</span>
        <span className="col-span-1">R:R</span>
        <span className="col-span-2">Confluencia</span>
        <span className="col-span-1 text-right">Acción</span>
      </div>

      <div className="space-y-1.5">
        {sorted.map((s) => {
          const isLong = s.direction === "LONG";
          const cappedLev = Math.min(10, s.leverage);
          const confPct = Math.round((s.confluence_score / s.confluence_total) * 100);
          return (
            <div
              key={s.id}
              className={clsx(
                "grid grid-cols-12 gap-2 items-center rounded-xl px-3 py-2.5 border text-xs transition-all hover:bg-slate-800/50",
                isLong
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-rose-500/20 bg-rose-500/5"
              )}
            >
              <div className="col-span-1">
                <span
                  className={clsx(
                    "inline-flex h-6 w-6 items-center justify-center rounded font-black text-[10px]",
                    isLong ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                  )}
                >
                  {isLong ? "L" : "S"}
                </span>
              </div>

              <div className="col-span-2 font-black text-slate-100">{s.symbol}</div>

              <div className="col-span-2 font-mono text-slate-200">
                ${s.entry_price.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </div>

              <div className="col-span-1 font-bold text-amber-300">{cappedLev}x</div>

              <div className="col-span-1 font-mono text-rose-400">-{s.sl_pct.toFixed(1)}%</div>

              <div className="col-span-1 font-mono text-emerald-400">+{s.tp1_pct.toFixed(1)}%</div>

              <div className="col-span-1 font-mono text-slate-300">{s.risk_reward.toFixed(1)}</div>

              <div className="col-span-2 flex items-center gap-1.5">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all",
                      confPct >= 75 ? "bg-emerald-500" : confPct >= 58 ? "bg-amber-500" : "bg-rose-500"
                    )}
                    style={{ width: `${confPct}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-slate-300">
                  {s.confluence_score}/{s.confluence_total}
                </span>
              </div>

              <div className="col-span-1 text-right">
                <Link
                  to={`/signals/${s.id}`}
                  className="rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-white/10 transition-colors"
                >
                  Ver →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
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
