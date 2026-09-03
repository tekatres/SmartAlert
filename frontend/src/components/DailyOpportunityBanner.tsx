import { useState } from "react";
import { clsx } from "clsx";
import { TradingSignalDoc } from "@/types";
import { PositionRiskCalculator } from "@/components/PositionRiskCalculator";
import { TradingViewChart } from "@/components/TradingViewChart";
import { scanLiveMarket } from "@/services/liveScanner";

export function DailyOpportunityBanner({
  signals,
  onScan,
  isScanning: isScanningProp = false,
}: {
  signals: TradingSignalDoc[];
  onScan?: (minThreshold?: number) => Promise<void>;
  isScanning?: boolean;
}) {
  const [showCalculator, setShowCalculator] = useState(false);
  const [localScanning, setLocalScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showChart, setShowChart] = useState(false);

  const isScanning = isScanningProp || localScanning;

  const handleLiveScan = async (minThreshold = 6) => {
    setScanMessage(null);
    if (onScan) {
      await onScan(minThreshold);
      setScanMessage(`✅ Mercado analizado en vivo a las ${new Date().toLocaleTimeString("es-ES")}.`);
      setTimeout(() => setScanMessage(null), 5000);
      return;
    }

    setLocalScanning(true);
    try {
      const result = await scanLiveMarket(minThreshold);
      setScanMessage(
        `✅ Mercado analizado en vivo a las ${new Date().toLocaleTimeString("es-ES")}. ${result.signalsFound} oportunidad(es) encontradas.`
      );
    } catch (err) {
      setScanMessage("❌ Error al conectar con Binance Futures.");
    } finally {
      setLocalScanning(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  // Find top signal by highest confluence score (must be Alta Confluencia >= 9 and no timeframe conflict)
  const topSignal = signals.length > 0
    ? [...signals]
        .filter((s) => s.confluence_score >= 9 && !(s as any).timeframe_conflict)
        .sort((a, b) => b.confluence_score - a.confluence_score)[0]
    : null;

  if (!topSignal) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold text-xl">
              🛡️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="badge bg-amber-500/10 text-amber-300 border border-amber-500/20 text-xs font-bold">
                  RADAR EN ESPERA
                </span>
                <span className="text-xs text-slate-400">Sin confluencia de alta probabilidad hoy</span>
              </div>
              <h2 className="mt-1 text-lg font-bold text-slate-100">
                Protección de Capital: Esperando Oportunidad Confluente (≥7/12)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 max-w-xl">
                El motor analiza los 7 pilares cuantitativos de Binance Futures. En mercados comprimidos o sin tendencia, la mejor estrategia es no arriesgar capital.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => handleLiveScan(6)}
              disabled={isScanning}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <span className="animate-spin">🔄</span> Escaneando Binance...
                </>
              ) : (
                <>🔄 Analizar Mercado en Vivo Ahora</>
              )}
            </button>

            <button
              onClick={() => setShowCalculator(true)}
              className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition-all shrink-0"
            >
              🧮 Calculadora
            </button>
          </div>
        </div>

        {scanMessage && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-300 font-medium animate-in fade-in">
            {scanMessage}
          </div>
        )}

        <PositionRiskCalculator
          isOpen={showCalculator}
          onClose={() => setShowCalculator(false)}
        />
      </div>
    );
  }

  const isLong = topSignal.direction === "LONG";
  const krakenSymbol = (topSignal as any).kraken_symbol || `PF_${topSignal.symbol === 'BTC' ? 'XBT' : topSignal.symbol}USD`;
  const krakenUrl = `https://futures.kraken.com/trade/${krakenSymbol}`;
  const cappedLeverage = Math.min(10, topSignal.leverage);

  const copyActionPlan = () => {
    const text = `
🎯 [SmartAlert Action Plan - ${topSignal.symbol} ${topSignal.direction}]
1. Acción: Abrir posición ${topSignal.direction} en ${topSignal.symbol}USDT Futures a $${topSignal.entry_price}
2. Apalancamiento: ${cappedLeverage}x (Modo Aislado - Máximo 10x)
3. Stop Loss: $${topSignal.stop_loss} (-${topSignal.sl_pct.toFixed(2)}%)
4. Take Profit 1 (50%): $${topSignal.take_profit_1} (+${topSignal.tp1_pct.toFixed(2)}%)
5. Take Profit 2 (100%): $${topSignal.take_profit_2} (+${topSignal.tp2_pct.toFixed(2)}%)
Confluencia: ${topSignal.confluence_score}/12 Pilares Cuantitativos
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-2xl border p-4 sm:p-6 shadow-2xl transition-all space-y-4 sm:space-y-5",
        isLong
          ? "border-emerald-500/40 bg-gradient-to-r from-slate-900 via-emerald-950/20 to-slate-950"
          : "border-rose-500/40 bg-gradient-to-r from-slate-900 via-rose-950/20 to-slate-950"
      )}
    >
      {/* Background glow */}
      <div
        className={clsx(
          "absolute -top-12 -right-12 h-48 w-48 rounded-full blur-3xl opacity-20 pointer-events-none",
          isLong ? "bg-emerald-500" : "bg-rose-500"
        )}
      />

      {/* Header Banner */}
      <div className="relative flex flex-col gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-amber-500/10 text-amber-300 border border-amber-500/20 text-xs font-black tracking-wide">
              ⚡ OPORTUNIDAD DESTACADA DEL DÍA
            </span>
            <span
              className={clsx(
                "badge border text-xs font-black px-2.5 py-0.5",
                isLong
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                  : "bg-rose-500/20 text-rose-300 border-rose-500/30"
              )}
            >
              {isLong ? "🟢 ENTRADA LONG" : "🔴 ENTRADA SHORT"} {topSignal.symbol}
            </span>
            <span className="rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-xs font-mono font-bold text-slate-300">
              {cappedLeverage}x
            </span>
          </div>

          <h2 className="mt-2 text-xl sm:text-2xl font-black text-slate-100 tracking-tight leading-tight">
            {topSignal.name}
            <span className="block sm:inline text-sm font-normal text-slate-400 sm:ml-2">
              (Confluencia: <strong className="text-emerald-400 font-mono">{topSignal.confluence_score}/{topSignal.confluence_total}</strong>)
            </span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowChart(!showChart)}
            className={clsx(
              "flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-md",
              showChart
                ? "bg-amber-500 text-slate-950 shadow-amber-500/20"
                : "bg-white/10 text-slate-100 hover:bg-white/20"
            )}
          >
            📊 {showChart ? "Ocultar Gráfica" : "Ver Gráfica en Vivo"}
          </button>

          <button
            onClick={() => setShowCalculator(true)}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 transition-all"
          >
            🧮 Riesgo para tus 200€
          </button>

          <button
            onClick={copyActionPlan}
            className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition-all"
          >
            {copied ? "✓ Copiado" : "📋 Copiar Params"}
          </button>

          <a
            href={krakenUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition-all"
          >
            🏛️ Kraken ↗
          </a>

          <button
            onClick={() => handleLiveScan(6)}
            disabled={isScanning}
            className="flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition-all disabled:opacity-50"
          >
            {isScanning ? <span className="animate-spin">🔄</span> : "🔄 Re-escaneo"}
          </button>
        </div>
      </div>

      {/* Collapsible Live TradingView Chart */}
      {showChart && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-2xl animate-in fade-in zoom-in duration-200">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/80 mb-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              📈 Velas de {topSignal.symbol} (Binance Futures)
            </span>
            <span className="text-[10px] text-slate-500">Intervalo: 1 hora</span>
          </div>
          <TradingViewChart symbol={topSignal.symbol} height={360} interval="60" />
        </div>
      )}

      {/* ACTION PLAN 4-STEP GRID */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <span>📌</span> Plan de Acción Directo
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* STEP 1 */}
          <div className="rounded-xl border border-emerald-500/30 bg-slate-950/90 p-4 space-y-1.5 shadow-lg">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
              Paso 1: Abrir Orden (Margen Recomendado)
            </span>
            <div className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-xs font-mono font-bold text-emerald-300">
              💶 Entrar con: ~${((4 / (topSignal.sl_pct / 100)) / cappedLeverage).toFixed(2)} USDT <span className="text-[10px] font-sans text-emerald-400/80">(de tus 200€)</span>
            </div>
            <p className="text-xs font-bold text-slate-100">
              {isLong ? "Comprar (LONG)" : "Vender (SHORT)"} en <span className="font-mono text-amber-300">${topSignal.entry_price}</span>
            </p>
            <p className="text-[11px] text-slate-400">
              Modo <strong className="text-slate-200">Aislado</strong> · Apalancamiento <strong className="text-amber-300">{cappedLeverage}x</strong>.
            </p>
          </div>

          {/* STEP 2 */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block">
              Paso 2: Stop Loss (Obligatorio)
            </span>
            <p className="text-xs font-mono font-bold text-rose-400">
              ${topSignal.stop_loss} <span className="text-[10px]">(-{topSignal.sl_pct.toFixed(2)}%)</span>
            </p>
            <p className="text-[11px] text-slate-400">
              Protege tu cuenta de caídas bruscas. Pérdida máxima del 2%.
            </p>
          </div>

          {/* STEP 3 */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
              Paso 3: Take Profit 1 (50%)
            </span>
            <p className="text-xs font-mono font-bold text-emerald-400">
              ${topSignal.take_profit_1} <span className="text-[10px]">(+{topSignal.tp1_pct.toFixed(2)}%)</span>
            </p>
            <p className="text-[11px] text-slate-400">
              Al llegar a TP1, vende el 50% de la posición y mueve el SL a precio de entrada.
            </p>
          </div>

          {/* STEP 4 */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 block">
              Paso 4: Take Profit 2 (100%)
            </span>
            <p className="text-xs font-mono font-bold text-emerald-300">
              ${topSignal.take_profit_2} <span className="text-[10px]">(+{topSignal.tp2_pct.toFixed(2)}%)</span>
            </p>
            <p className="text-[11px] text-slate-400">
              Cierre total de la posición. Ratio Riesgo/Beneficio: <strong className="text-slate-200">1:{topSignal.risk_reward.toFixed(2)}</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* 7 PILLARS RATIONALE BREAKDOWN */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 sm:p-4 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span>🧠 Razones Cuantitativas ({topSignal.confluence_score}/12 Pilares)</span>
          <button
            onClick={() => setShowCalculator(true)}
            className="text-xs text-emerald-400 font-bold hover:underline text-left sm:text-right"
          >
            🧮 Calcular Margen →
          </button>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {topSignal.votes.slice(0, 4).map((vote) => (
            <div
              key={vote.name}
              className="flex flex-col gap-1.5 rounded-lg bg-slate-900/90 px-3 py-2.5 border border-slate-800/60"
            >
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "shrink-0 font-bold text-[10px] px-1.5 py-0.5 rounded",
                    vote.vote === "LONG"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : vote.vote === "SHORT"
                      ? "bg-rose-500/20 text-rose-300"
                      : "bg-white/5 text-slate-400"
                  )}
                >
                  {vote.vote}
                </span>
                <span className="font-bold text-slate-200 leading-snug">{vote.name}</span>
              </div>
              <p className="text-slate-400 leading-relaxed break-words">{vote.explanation}</p>
            </div>
          ))}
        </div>
      </div>

      {scanMessage && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-300 font-medium animate-in fade-in">
          {scanMessage}
        </div>
      )}

      <PositionRiskCalculator
        signal={topSignal}
        isOpen={showCalculator}
        onClose={() => setShowCalculator(false)}
      />
    </div>
  );
}
