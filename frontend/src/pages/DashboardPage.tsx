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
import { ActiveTradeAdvisorCard } from "@/components/ActiveTradeAdvisorCard";
import { BtcGuardBanner } from "@/components/BtcGuardBanner";
import { MarketProtectionBanner } from "@/components/MarketProtectionBanner";
import { fetchMarketSentiment, MarketSentimentData } from "@/services/marketSentiment";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { useLivePrices } from "@/hooks/useLivePrices";

const MONITORED_SYMBOLS = [
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "NEAR", "OP", "ARB", "APT", "INJ"
];

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
  const [signalFilter, setSignalFilter] = useState<"ALL" | "PULLBACK" | "LONG" | "SHORT">("ALL");
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { trades, syncStatus, forceSyncToCloud } = usePaperTrading();
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const livePrices = useLivePrices(MONITORED_SYMBOLS);

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
  // UNIFIED SCAN LOGIC (Used by auto-timer AND manual button)
  // -------------------------------------------------------
  const runMarketScan = async (minThreshold = 6) => {
    if (autoScanStatus === "scanning") return;
    setAutoScanStatus("scanning");
    try {
      await scanLiveMarket(minThreshold);
      const isoNow = new Date().toISOString();
      localStorage.setItem(LAST_SCAN_KEY, isoNow);
      const displayTime = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      setLastScanTime(displayTime);
    } catch {
      // Silent fail — user can retry manually
    } finally {
      setAutoScanStatus("done");
      setTimeout(() => setAutoScanStatus("idle"), 4000);
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
      const initialTimer = setTimeout(() => runMarketScan(6), 1500);

      // Schedule recurring scans every 4 hours
      scanTimerRef.current = setInterval(() => runMarketScan(6), AUTO_SCAN_INTERVAL_MS);

      return () => {
        clearTimeout(initialTimer);
        if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      };
    } else {
      // Already scanned recently — schedule the next one at the right time
      const nextScanIn = AUTO_SCAN_INTERVAL_MS - elapsed;

      const nextTimer = setTimeout(() => {
        runMarketScan(6);
        scanTimerRef.current = setInterval(() => runMarketScan(6), AUTO_SCAN_INTERVAL_MS);
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
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-xs text-slate-400">
              SmartAlert Futures · 20 pares · Motor de Confluencia (7+/12)
            </p>
            {/* Unified scan status badge & trigger */}
            {autoScanStatus === "scanning" && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
                <span className="animate-spin">🔄</span> Escaneando mercado cuantitativo...
              </span>
            )}
            {autoScanStatus === "done" && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                ✅ Mercado actualizado
              </span>
            )}
            {autoScanStatus === "idle" && (
              <button
                onClick={() => runMarketScan(6)}
                className="flex items-center gap-1.5 rounded-full bg-slate-800/90 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-0.5 text-[10px] font-mono text-slate-300 transition-all shadow-sm group"
                title="Haz clic para forzar un nuevo escaneo en vivo"
              >
                <span>🕐 Escaneo: <strong className="text-slate-200">{lastScanTime || "Sin datos"}</strong></span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400 font-bold group-hover:underline flex items-center gap-0.5">
                  🔄 Analizar Mercado
                </span>
              </button>
            )}
          </div>
        </div>

        {/* View mode toggle + Paper Trading button */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowPaperModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all shadow-md"
          >
            🎮 Simulador
          </button>

          {/* View mode scrollable row on mobile */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-900 p-1 border border-slate-800 overflow-x-auto max-w-full">
            <button
              onClick={() => setViewMode("list")}
              className={clsx(
                "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap",
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
                "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap",
                viewMode === "sim"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              🎮 Sim
            </button>
            <button
              onClick={() => setViewMode("heatmap")}
              className={clsx(
                "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap",
                viewMode === "heatmap"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              🔥 Calor
            </button>
            <button
              onClick={() => setViewMode("compact")}
              className={clsx(
                "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap",
                viewMode === "compact"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              ⚡ Compact
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={clsx(
                "hidden sm:flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap",
                viewMode === "split"
                  ? "bg-emerald-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              🖥️ Multi
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

      {/* ---- BTC BETA GUARD (MARKET LEADER SHIELD) ---- */}
      <BtcGuardBanner />

      {/* ---- FILTROS DE PROTECCIÓN (MACRO + RÉGIMEN) ---- */}
      <MarketProtectionBanner />

      {/* ---- COPILOTO / ASESOR EN VIVO DE POSICIONES ACTIVAS ---- */}
      {openTrades.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Copiloto Activo · Tus Posiciones Abiertas ({openTrades.length})</span>
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 hidden sm:inline">
                Asistencia y salida en tiempo real
              </span>
              <button
                onClick={() => forceSyncToCloud()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                title="Sincronizar posiciones multi-dispositivo con la nube"
              >
                {syncStatus === "syncing" ? (
                  <svg className="w-3.5 h-3.5 text-amber-400 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : syncStatus === "synced" ? (
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 00-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                <span>
                  {syncStatus === "synced" ? "Sincronizado Cloud" : syncStatus === "syncing" ? "Sincronizando..." : "Local (Reintentar)"}
                </span>
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {openTrades.map((t) => (
              <ActiveTradeAdvisorCard key={t.id} trade={t} />
            ))}
          </div>
        </section>
      )}

      {/* ---- DAILY BANNER ---- */}
      <DailyOpportunityBanner
        signals={signals}
        onScan={runMarketScan}
        isScanning={autoScanStatus === "scanning"}
      />

      {/* ---- VIEWS ---- */}
      {viewMode === "sim" ? (
        <PaperTradingPanel signals={signals} />
      ) : viewMode === "heatmap" ? (
        <ConfluenceHeatmap signals={signals} />
      ) : viewMode === "split" ? (
        <MultiChartSplitView signals={signals} />
      ) : viewMode === "compact" ? (
        <CompactSignalsView signals={signals} livePrices={livePrices} />
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

          {signals.length > 0 && (() => {
            const pullbackSignals = signals.filter(s => (s.market_phase || (s.confluence_score >= 8 ? "PULLBACK" : "")) === "PULLBACK");
            const longSignals = signals.filter(s => s.direction === "LONG");
            const shortSignals = signals.filter(s => s.direction === "SHORT");
            const displayedSignals = signalFilter === "PULLBACK"
              ? pullbackSignals
              : signalFilter === "LONG"
              ? longSignals
              : signalFilter === "SHORT"
              ? shortSignals
              : signals;

            return (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-300">
                    <span>🎯</span> Señales Activas de Futuros
                    <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                      {displayedSignals.length} de {signals.length}
                    </span>
                  </h2>

                  {/* Quick Filters */}
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-900/90 p-1 border border-slate-800 text-xs">
                    <button
                      onClick={() => setSignalFilter("ALL")}
                      className={clsx(
                        "px-2.5 py-1 rounded-md font-bold transition-all",
                        signalFilter === "ALL" ? "bg-white/15 text-slate-100 shadow" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      Todas ({signals.length})
                    </button>
                    <button
                      onClick={() => setSignalFilter("PULLBACK")}
                      className={clsx(
                        "flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition-all",
                        signalFilter === "PULLBACK" ? "bg-indigo-500/25 border border-indigo-500/40 text-indigo-300 shadow" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <span>🔄</span> En Pullback ({pullbackSignals.length})
                    </button>
                    <button
                      onClick={() => setSignalFilter("LONG")}
                      className={clsx(
                        "flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition-all",
                        signalFilter === "LONG" ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 shadow" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <span>🟢</span> LONG ({longSignals.length})
                    </button>
                    <button
                      onClick={() => setSignalFilter("SHORT")}
                      className={clsx(
                        "flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition-all",
                        signalFilter === "SHORT" ? "bg-rose-500/20 border border-rose-500/30 text-rose-300 shadow" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <span>🔴</span> SHORT ({shortSignals.length})
                    </button>
                  </div>
                </div>

                {displayedSignals.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                    No hay señales que coincidan con este filtro en este momento.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {displayedSignals.map((s) => (
                      <TradingSignalCard key={s.id} signal={s} currentPrice={livePrices[s.symbol]} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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

function CompactSignalsView({ signals, livePrices }: { signals: TradingSignalDoc[]; livePrices?: Record<string, number> }) {
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
          Precios en vivo y confluencia
        </span>
      </div>

      {/* Table header */}
      <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
        <span className="col-span-1">Dir.</span>
        <span className="col-span-2">Par</span>
        <span className="col-span-2">En Vivo / Entrada</span>
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
          const current = livePrices?.[s.symbol];
          const diffPct = current && s.entry_price > 0
            ? (isLong ? ((current - s.entry_price) / s.entry_price) * 100 : ((s.entry_price - current) / s.entry_price) * 100)
            : 0;

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

              <div className="col-span-2 font-mono">
                {current ? (
                  <>
                    <span className="block font-bold text-slate-100">
                      ${current.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </span>
                    <span
                      className={clsx(
                        "block text-[10px] font-semibold",
                        diffPct > 0 ? "text-emerald-400" : diffPct < 0 ? "text-rose-400" : "text-slate-400"
                      )}
                    >
                      {diffPct > 0 ? `+${diffPct.toFixed(2)}%` : `${diffPct.toFixed(2)}%`} vs ent.
                    </span>
                  </>
                ) : (
                  <span className="text-slate-200">
                    ${s.entry_price.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </span>
                )}
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
