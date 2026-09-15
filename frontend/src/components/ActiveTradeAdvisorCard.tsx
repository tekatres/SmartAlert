import { useState, useEffect, useRef } from "react";
import { PaperTrade, usePaperTrading } from "@/hooks/usePaperTrading";
import { useLivePrices } from "@/hooks/useLivePrices";
import { analyzeActiveTrade } from "@/services/tradeAdvisor";
import { fetchWhaleFlow, WhaleFlowData } from "@/services/whaleTracker";
import { TradingViewChart } from "@/components/TradingViewChart";
import { clsx } from "clsx";

interface Props {
  trade: PaperTrade;
  onTradeClosed?: () => void;
}

const CHART_MIN_H = 220;
const CHART_MAX_H = 900;
const CHART_MIN_W = 30;
const CHART_MAX_W = 80;

export function ActiveTradeAdvisorCard({ trade, onTradeClosed }: Props) {
  const { closeTrade, updateTradeStopLoss } = usePaperTrading();
  const [beApplied, setBeApplied] = useState(false);
  const [trailingApplied, setTrailingApplied] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartHeight, setChartHeight] = useState(420);
  const [chartWidthPct, setChartWidthPct] = useState(46);
  const [whaleFlow, setWhaleFlow] = useState<WhaleFlowData | null>(null);

  const layoutRef = useRef<HTMLDivElement>(null);

  // Resize-drag state for the chart box (vertical)
  const dragState = useRef<{ startY: number; startH: number } | null>(null);
  const clampHeight = (h: number) => Math.max(CHART_MIN_H, Math.min(CHART_MAX_H, Math.round(h)));

  const onChartDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragState.current = { startY: clientY, startH: chartHeight };
    document.addEventListener("mousemove", onChartDragMove);
    document.addEventListener("mouseup", onChartDragEnd);
    document.addEventListener("touchmove", onChartDragMove, { passive: false });
    document.addEventListener("touchend", onChartDragEnd);
  };

  const onChartDragMove = (e: MouseEvent | TouchEvent) => {
    if (!dragState.current) return;
    const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY;
    const delta = dragState.current.startY - clientY;
    setChartHeight(clampHeight(dragState.current.startH + delta));
  };

  const onChartDragEnd = () => {
    dragState.current = null;
    document.removeEventListener("mousemove", onChartDragMove);
    document.removeEventListener("mouseup", onChartDragEnd);
    document.removeEventListener("touchmove", onChartDragMove);
    document.removeEventListener("touchend", onChartDragEnd);
  };

  // Horizontal resize (desktop only): drag the left edge of the chart panel
  const hDragState = useRef<{ startX: number; startPct: number; containerW: number } | null>(null);
  const clampWidth = (p: number) => Math.max(CHART_MIN_W, Math.min(CHART_MAX_W, Math.round(p)));

  const onChartHDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    hDragState.current = {
      startX: clientX,
      startPct: chartWidthPct,
      containerW: layoutRef.current?.clientWidth || 1000,
    };
    document.addEventListener("mousemove", onChartHDragMove);
    document.addEventListener("mouseup", onChartHDragEnd);
    document.addEventListener("touchmove", onChartHDragMove, { passive: false });
    document.addEventListener("touchend", onChartHDragEnd);
  };

  const onChartHDragMove = (e: MouseEvent | TouchEvent) => {
    if (!hDragState.current) return;
    const clientX = e instanceof TouchEvent ? e.touches[0].clientX : e.clientX;
    const delta = hDragState.current.startX - clientX; // drag left -> wider
    const newPct = hDragState.current.startPct + (delta / hDragState.current.containerW) * 100;
    setChartWidthPct(clampWidth(newPct));
  };

  const onChartHDragEnd = () => {
    hDragState.current = null;
    document.removeEventListener("mousemove", onChartHDragMove);
    document.removeEventListener("mouseup", onChartHDragEnd);
    document.removeEventListener("touchmove", onChartHDragMove);
    document.removeEventListener("touchend", onChartHDragEnd);
  };

  // Live real-time price from Binance WebSocket
  const livePrices = useLivePrices([trade.symbol]);
  const currentPrice = livePrices[trade.symbol] || trade.entryPrice;

  // Poll real-time institutional whale metrics for this symbol
  useEffect(() => {
    const binancePair = `${trade.symbol}USDT`;
    fetchWhaleFlow(binancePair).then(setWhaleFlow);
    const interval = setInterval(() => {
      fetchWhaleFlow(binancePair).then(setWhaleFlow);
    }, 12000); // refresh whale flow every 12s
    return () => clearInterval(interval);
  }, [trade.symbol]);

  // Run dynamic ultra-precise quantitative analysis
  const analysis = analyzeActiveTrade(trade, currentPrice, whaleFlow);

  const isLong = trade.direction === "LONG";
  const isBreakevenAlready =
    Math.abs(trade.stopLoss - trade.entryPrice) < trade.entryPrice * 0.0005;

  const handleSetBreakeven = () => {
    updateTradeStopLoss(trade.id, trade.entryPrice);
    setBeApplied(true);
    setTimeout(() => setBeApplied(false), 4000);
  };

  const handleApplyTrailingStop = () => {
    updateTradeStopLoss(trade.id, analysis.trailingStopPrice);
    setTrailingApplied(true);
    setTimeout(() => setTrailingApplied(false), 4000);
  };

  const handleTakePartial = () => {
    closeTrade(trade.id, "CLOSED_TP1", analysis.pnlUsd * 0.5);
    onTradeClosed?.();
  };

  const handleCloseMarket = () => {
    closeTrade(trade.id, "CLOSED_MARKET", analysis.pnlUsd);
    onTradeClosed?.();
  };

  const formatPrice = (p: number) => {
    if (p >= 1) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    return `$${p.toFixed(6)}`;
  };

  // Color mappings
  const borderTone =
    analysis.verdictColor === "emerald"
      ? "border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 via-slate-900/90 to-slate-950"
      : analysis.verdictColor === "amber"
      ? "border-amber-500/40 bg-gradient-to-b from-amber-500/10 via-slate-900/90 to-slate-950"
      : analysis.verdictColor === "purple"
      ? "border-purple-500/40 bg-gradient-to-b from-purple-500/10 via-slate-900/90 to-slate-950"
      : "border-rose-500/40 bg-gradient-to-b from-rose-500/10 via-slate-900/90 to-slate-950";

  const badgeTone =
    analysis.verdictColor === "emerald"
      ? "bg-emerald-500 text-slate-950"
      : analysis.verdictColor === "amber"
      ? "bg-amber-500 text-slate-950"
      : analysis.verdictColor === "purple"
      ? "bg-purple-400 text-slate-950"
      : "bg-rose-500 text-slate-950";

  return (
    <div ref={layoutRef} className="flex flex-col lg:flex-row gap-4">
      <div className={clsx("flex-1 min-w-0 rounded-2xl border-2 p-4 sm:p-5 shadow-2xl space-y-4 transition-all", borderTone)}>
      {/* ── TOP HEADER: ASISTENTE EN VIVO & FLUJO DE BALLENAS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 border border-white/10 text-xl font-bold shadow-inner">
            <span>{analysis.emoji}</span>
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Copiloto en Vivo · Posición Abierta
              </span>
              <span className={clsx("rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider", badgeTone)}>
                {analysis.verdictTitle}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-100 flex items-center gap-2">
              <span>{trade.symbol}</span>
              <span className={clsx("text-xs px-2 py-0.5 rounded font-mono font-bold", isLong ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                {trade.direction} {trade.leverage}x
              </span>
              <span className="text-xs text-slate-400 font-normal">
                (Abierta hace {analysis.timeElapsedMinutes} min)
              </span>
            </h3>
          </div>
        </div>

        {/* Live PnL & ROE */}
        <div className="flex items-center gap-3 bg-slate-950/90 px-4 py-2 rounded-xl border border-white/10 self-start sm:self-auto font-mono">
          <div>
            <span className="block text-[9px] uppercase font-bold text-slate-500 tracking-wider">PnL en Vivo</span>
            <span className={clsx("text-base sm:text-lg font-black leading-none", analysis.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {analysis.pnlUsd >= 0 ? "+" : ""}${analysis.pnlUsd.toFixed(2)} USD
            </span>
          </div>
          <div className="border-l border-slate-800 pl-3">
            <span className="block text-[9px] uppercase font-bold text-slate-500 tracking-wider">ROE (%)</span>
            <span className={clsx("text-base sm:text-lg font-black leading-none", analysis.roePct >= 0 ? "text-emerald-300" : "text-rose-400")}>
              {analysis.roePct >= 0 ? "+" : ""}{analysis.roePct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── WHALE DETECTOR RADAR BAR ── */}
      {whaleFlow && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/90 border border-slate-800 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-base">🐳</span>
            <span className="font-bold text-slate-200 text-xs">Radar de Ballenas Institucionales:</span>
            <span
              className={clsx(
                "rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                whaleFlow.isBullishWhale
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : whaleFlow.isBearishWhale
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "bg-slate-800 text-slate-300"
              )}
            >
              {whaleFlow.badgeText}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
            <span>Taker Ratio: <strong className="text-slate-200">{whaleFlow.takerBuySellRatio}x</strong></span>
            <span>Top Traders: <strong className="text-emerald-300">{(whaleFlow.topTraderLongRatio * 100).toFixed(0)}% Long</strong></span>
          </div>
        </div>
      )}

      {/* ── PRECIO ACTUAL EN VIVO (PROMINENTE) ── */}
      <div className={clsx(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-950/95 border-2 px-4 py-3 sm:px-5 sm:py-4 shadow-lg",
        analysis.pnlUsd >= 0 ? "border-emerald-500/50" : "border-rose-500/50"
      )}>
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-[10px] uppercase font-black tracking-widest text-slate-400">
            <span className={clsx("h-2 w-2 rounded-full animate-pulse", analysis.pnlUsd >= 0 ? "bg-emerald-400" : "bg-rose-400")} />
            Precio Actual en Vivo
          </span>
          <span className={clsx("block text-3xl sm:text-4xl font-black tabular-nums leading-tight", analysis.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {formatPrice(currentPrice)}
          </span>
        </div>
        <div className="text-right shrink-0">
          <span className="block text-[10px] uppercase font-black tracking-widest text-slate-400">Precio de Entrada</span>
          <span className="block text-lg sm:text-xl font-black tabular-nums text-slate-100 leading-tight">
            {formatPrice(trade.entryPrice)}
          </span>
          <span className={clsx("mt-0.5 block text-xs font-black tabular-nums", analysis.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {analysis.pnlUsd >= 0 ? "▲" : "▼"} {analysis.pnlUsd >= 0 ? "+" : ""}{analysis.pnlUsd.toFixed(2)} USD ({analysis.roePct >= 0 ? "+" : ""}{analysis.roePct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* ── INTERACTIVE TRADE TRAJECTORY BAR ── */}
      <div className="space-y-2 rounded-xl bg-slate-950/70 p-3.5 border border-slate-800/80">
        <div className="flex items-center justify-between text-[11px] font-mono font-bold">
          <span className="text-rose-400 flex items-center gap-1">
            <span>🛑 SL:</span> {formatPrice(trade.stopLoss)}
          </span>
          <span className="text-slate-300 flex items-center gap-1">
            <span>📍 Entrada:</span> {formatPrice(trade.entryPrice)}
          </span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span>🎯 TP1:</span> {formatPrice(trade.tp1)}
          </span>
          <span className="text-emerald-300 flex items-center gap-1 hidden sm:inline-flex">
            <span>🚀 TP2:</span> {formatPrice(trade.tp2)}
          </span>
        </div>

        {/* Visual Progress Bar */}
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800">
          <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-500 z-10" title="Precio de Entrada" />

          {analysis.progressPct >= 0 ? (
            <div
              className="absolute top-0 bottom-0 left-1/2 bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 rounded-r-full"
              style={{ width: `${Math.min(50, (analysis.progressPct / 100) * 50)}%` }}
            />
          ) : (
            <div
              className="absolute top-0 bottom-0 bg-gradient-to-l from-rose-500 to-rose-600 transition-all duration-300 rounded-l-full"
              style={{
                right: "50%",
                width: `${Math.min(50, (Math.abs(analysis.progressPct) / 100) * 50)}%`,
              }}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-0.5">
          <span>Distancia a SL: <strong className="text-rose-400">{analysis.distanceToSlPct.toFixed(2)}%</strong></span>
          <span className={clsx(
            "text-xs font-black px-3 py-1 rounded-full border",
            analysis.pnlUsd >= 0
              ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
              : "text-rose-300 bg-rose-500/10 border-rose-500/30"
          )}>
            Precio Actual: {formatPrice(currentPrice)}
          </span>
          <span>Distancia a TP1: <strong className="text-emerald-400">{analysis.distanceToTp1Pct.toFixed(2)}%</strong></span>
        </div>
      </div>

      {/* ── EXACT MONETARY OUTCOME BREAKDOWN (BROKER QUANT MATRICES) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
        <div className="rounded-xl bg-slate-950/80 p-2.5 border border-slate-800">
          <span className="block text-[9px] uppercase font-bold text-slate-500">Pérdida Máx. al SL</span>
          <span className="text-rose-400 font-black text-sm">-${Math.abs(analysis.lossIfSlUsd).toFixed(2)} USD</span>
          <span className="block text-[9px] text-slate-500 font-sans">(-{trade.slPct}%)</span>
        </div>

        <div className="rounded-xl bg-slate-950/80 p-2.5 border border-amber-500/20">
          <span className="block text-[9px] uppercase font-bold text-amber-400">Riesgo en Breakeven</span>
          <span className="text-amber-300 font-black text-sm">$0.00 USD</span>
          <span className="block text-[9px] text-slate-500 font-sans">(Riesgo Cero)</span>
        </div>

        <div className="rounded-xl bg-slate-950/80 p-2.5 border border-emerald-500/20">
          <span className="block text-[9px] uppercase font-bold text-emerald-400">Ganancia al TP1 (50%)</span>
          <span className="text-emerald-400 font-black text-sm">+${analysis.profitIfTp1Usd.toFixed(2)} USD</span>
          <span className="block text-[9px] text-slate-500 font-sans">(+{trade.tp1Pct}%)</span>
        </div>

        <div className="rounded-xl bg-slate-950/80 p-2.5 border border-emerald-500/30">
          <span className="block text-[9px] uppercase font-bold text-emerald-300">Ganancia Máx. TP2</span>
          <span className="text-emerald-300 font-black text-sm">+${analysis.profitIfTp2Usd.toFixed(2)} USD</span>
          <span className="block text-[9px] text-slate-500 font-sans">(+{trade.tp2Pct}%)</span>
        </div>
      </div>

      {/* ── COPILOT ADVICE & DIRECT ACTION BUTTONS ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 rounded-xl bg-slate-950/90 p-4 border border-white/5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <span>🧠</span> Diagnóstico Cuantitativo del Motor
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Trailing Stop Sugerido: <strong className="text-amber-300">{formatPrice(analysis.trailingStopPrice)}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            {analysis.reasonText}
          </p>
          <div className="text-xs text-emerald-300/95 leading-relaxed font-semibold bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/20">
            👉 <strong>Acción Recomendada:</strong> {analysis.suggestedAction}
          </div>
        </div>

        {/* Fast Action Buttons */}
        <div className="flex flex-col gap-2 justify-center">
          {/* Chart Toggle Button */}
          <button
            onClick={() => setShowChart(!showChart)}
            className={clsx(
              "w-full rounded-xl px-3 py-2 text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5",
              showChart
                ? "bg-sky-500 text-slate-950 border border-sky-400 shadow-sky-500/20"
                : "bg-sky-500/20 border border-sky-500/40 hover:bg-sky-500/30 text-sky-300"
            )}
            title="Abre la gráfica del activo al lado del panel (pantalla completa disponible dentro de la gráfica)"
          >
            <span>📊</span>
            {showChart ? "Ocultar Gráfica" : "Ver Gráfica"}
          </button>

          {/* Breakeven Button */}
          <button
            onClick={handleSetBreakeven}
            disabled={isBreakevenAlready}
            className={clsx(
              "w-full rounded-xl px-3 py-2 text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5",
              isBreakevenAlready
                ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20"
            )}
            title="Sube tu Stop Loss al precio exacto de entrada para asegurar riesgo cero"
          >
            <span>🛡️</span>
            {isBreakevenAlready ? "Riesgo Cero Activo" : "Mover SL a Entrada"}
          </button>

          {/* Smart Trailing Stop Button */}
          {analysis.canApplyTrailing && (
            <button
              onClick={handleApplyTrailingStop}
              className="w-full rounded-xl bg-sky-500/20 border border-sky-500/40 hover:bg-sky-500/30 text-sky-300 px-3 py-2 text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
              title="Ajusta el Stop Loss al nivel óptimo para proteger ganancias sin ahogar el trade"
            >
              <span>📈</span>
              Subir Trailing Stop ({formatPrice(analysis.trailingStopPrice)})
            </button>
          )}

          {/* Partial TP Button */}
          <button
            onClick={handleTakePartial}
            className="w-full rounded-xl bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-300 px-3 py-2 text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
            title="Cierra el 50% de la posición para embolsarte beneficios"
          >
            <span>🎯</span>
            Tomar 50% de Ganancia
          </button>

          {/* Close Market Button */}
          <button
            onClick={handleCloseMarket}
            className="w-full rounded-xl bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-300 px-3 py-2 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
            title="Cierra la posición completa de inmediato al precio actual de mercado"
          >
            <span>🛑</span>
            Cerrar Todo a Mercado
          </button>
        </div>
      </div>

      {beApplied && (
        <div className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 p-2 text-center text-xs font-bold text-emerald-300 animate-in fade-in">
          ✅ ¡Stop Loss actualizado a Breakeven (${trade.entryPrice.toFixed(4)})! Tu posición ya no puede tener pérdidas.
        </div>
      )}

      {trailingApplied && (
        <div className="rounded-lg bg-sky-500/20 border border-sky-500/30 p-2 text-center text-xs font-bold text-sky-300 animate-in fade-in">
          ✅ ¡Trailing Stop aplicado en ${analysis.trailingStopPrice.toFixed(4)}! Ganancias bloqueadas.
        </div>
      )}
      </div>

      {/* ── GRÁFICA DEL ACTIVO (AL LADO, SIN CERRAR EL PANEL) ── */}
      {showChart && (
        <div
          className="relative w-full lg:shrink-0 lg:min-w-0 lg:[width:var(--chart-w)]"
          style={{ "--chart-w": `${chartWidthPct}%` } as React.CSSProperties}
        >
          {/* Horizontal resize handle (left edge, desktop) */}
          <div
            onMouseDown={onChartHDragStart}
            onTouchStart={onChartHDragStart}
            className="absolute left-0 top-0 bottom-0 hidden lg:flex w-2 cursor-ew-resize items-center justify-center rounded-l group hover:bg-sky-500/20 transition-colors"
            title="Arrastra horizontalmente para cambiar el ancho"
          >
            <span className="text-slate-500 group-hover:text-sky-300 text-xs select-none">⋮</span>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-3 shadow-2xl lg:pl-5">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="font-black text-xs text-slate-200 uppercase tracking-wide">
                📈 Gráfica en Vivo — {trade.symbol}
              </span>
              <button
                onClick={() => setShowChart(false)}
                className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[11px] font-bold text-slate-300 hover:bg-white/10 transition-colors"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* Resize controls: drag vertical + −/+ for height and width */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div
                onMouseDown={onChartDragStart}
                onTouchStart={onChartDragStart}
                className="flex-1 flex items-center justify-center gap-2 cursor-ns-resize select-none rounded-lg bg-white/5 border border-white/10 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-white/10 transition-colors"
                title="Arrastra verticalmente para cambiar el alto"
              >
                ⇕ Arrastra (alto)
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-1.5 py-1">
                <button
                  onClick={() => setChartHeight(clampHeight(chartHeight - 50))}
                  className="w-6 h-6 rounded bg-slate-800 text-slate-200 font-black hover:bg-slate-700 transition-colors"
                  title="Reducir alto"
                >
                  −
                </button>
                <span className="min-w-[3.2rem] text-center font-mono text-[10px] text-slate-300">
                  Alto {chartHeight}px
                </span>
                <button
                  onClick={() => setChartHeight(clampHeight(chartHeight + 50))}
                  className="w-6 h-6 rounded bg-slate-800 text-slate-200 font-black hover:bg-slate-700 transition-colors"
                  title="Aumentar alto"
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-1.5 py-1">
                <button
                  onClick={() => setChartWidthPct(clampWidth(chartWidthPct - 5))}
                  className="w-6 h-6 rounded bg-slate-800 text-slate-200 font-black hover:bg-slate-700 transition-colors"
                  title="Reducir ancho"
                >
                  −
                </button>
                <span className="min-w-[3.2rem] text-center font-mono text-[10px] text-slate-300">
                  Ancho {chartWidthPct}%
                </span>
                <button
                  onClick={() => setChartWidthPct(clampWidth(chartWidthPct + 5))}
                  className="w-6 h-6 rounded bg-slate-800 text-slate-200 font-black hover:bg-slate-700 transition-colors"
                  title="Aumentar ancho"
                >
                  +
                </button>
              </div>
            </div>

            <TradingViewChart symbol={trade.symbol} interval="60" height={chartHeight} />
          </div>
        </div>
      )}
    </div>
  );
}
