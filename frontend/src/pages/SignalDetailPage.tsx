import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { clsx } from "clsx";
import { db } from "@/services/firebase";
import { TradingSignalDoc, SignalVote } from "@/types";
import { Skeleton } from "@/components/Skeleton";
import { PositionRiskCalculator } from "@/components/PositionRiskCalculator";
import { TradingViewChart } from "@/components/TradingViewChart";
import { SignalOutcomeBadge } from "@/components/SignalOutcomeBadge";
import { SignalDecisionGuide } from "@/components/SignalDecisionGuide";
import { ActiveTradeAdvisorCard } from "@/components/ActiveTradeAdvisorCard";
import { PaperTradingModal } from "@/components/PaperTradingModal";
import { KrakenExecutionModal } from "@/components/KrakenExecutionModal";
import { fetchMarketSentiment } from "@/services/marketSentiment";
import { useSignalSetupStats } from "@/hooks/useSignalStats";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useAppStore } from "@/store/useAppStore";
import { generateClearSignalExplanation } from "@/utils/signalExplainer";

export default function SignalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [signal, setSignal] = useState<TradingSignalDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [showKrakenGuide, setShowKrakenGuide] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [sentimentValue, setSentimentValue] = useState<number>(50);
  const [activeTab, setActiveTab] = useState<"plan" | "analysis" | "risk">("plan");

  const { stats: setupStats, winrate } = useSignalSetupStats(signal?.signal_type || "");
  const { trades } = usePaperTrading();
  const liveSignals = useAppStore((s) => s.liveSignals);

  // Live prices hook (streams real-time price for this asset)
  const livePrices = useLivePrices(signal ? [signal.symbol] : []);
  const livePrice = (signal && livePrices[signal.symbol]) || signal?.entry_price || 0;

  useEffect(() => {
    fetchMarketSentiment().then((s) => setSentimentValue(s.fearAndGreedValue));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    // 1. Check local liveSignals store first (instant, immune to Firestore quota)
    const localSignal = liveSignals.find((s) => s.id === id);
    if (localSignal) {
      setSignal(localSignal);
      setNotFound(false);
      setLoading(false);
    }

    // 2. Also subscribe to Firestore for cloud-synced data
    const ref = doc(db, "trading_signals", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setSignal({ id: snap.id, ...(snap.data() as any) });
          setNotFound(false);
        } else if (!localSignal) {
          setNotFound(true);
        }
        setLoading(false);
      },
      () => {
        if (!localSignal) setNotFound(true);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [id, liveSignals]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !signal) {
    return (
      <div className="card mx-auto max-w-lg p-12 text-center my-8">
        <p className="text-slate-300 font-bold text-lg">Señal no encontrada</p>
        <p className="mt-1 text-xs text-slate-500">
          Es posible que haya expirado o sido eliminada del escáner.
        </p>
        <Link to="/" className="btn-ghost mt-6 inline-flex">
          ← Volver al dashboard
        </Link>
      </div>
    );
  }

  const isLong = signal.direction === "LONG";
  const dirEmoji = isLong ? "🟢" : "🔴";
  const score = signal.confluence_score ?? 0;
  const total = signal.confluence_total ?? 12;
  const hasConflict = (signal as any).timeframe_conflict === true;
  const explanation = generateClearSignalExplanation(signal);

  // Veredicto oficial
  let actionStatus = "ENTRAR AHORA";
  let actionBg = "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
  let badgeColor = "bg-emerald-500 text-slate-950";
  let verdictSummary = `Oportunidad recomendada. La estructura cuantitativa de ${signal.symbol} muestra fuerza ${isLong ? "alcista" : "bajista"} sólida.`;

  if (score < 7 || hasConflict) {
    actionStatus = "ESPERAR CONFIRMACIÓN";
    actionBg = "bg-amber-500/10 border-amber-500/30 text-amber-300";
    badgeColor = "bg-amber-500 text-slate-950";
    verdictSummary = `Mercado con señales mixtas o conflicto de temporalidades en ${signal.symbol}. Espera retroceso al soporte.`;
  } else if (score < 5 || signal.btc_guard?.status === "BLOCKED") {
    actionStatus = "NO ENTRAR";
    actionBg = "bg-rose-500/10 border-rose-500/30 text-rose-400";
    badgeColor = "bg-rose-500 text-slate-950";
    verdictSummary = signal.btc_guard?.status === "BLOCKED"
      ? `Operación bloqueada por BTC Guard (Bitcoin en contra). Riesgo alto de pérdida.`
      : `Baja alineación de indicadores. Riesgo alto de movimiento falso en ${signal.symbol}.`;
  }

  // Cálculos en tiempo real
  const entryPrice = signal.entry_price ?? 0;
  const stopLoss = signal.stop_loss ?? 0;
  const tp1Price = signal.take_profit_1 ?? 0;
  const tp2Price = signal.take_profit_2 ?? 0;
  const slPct = signal.sl_pct ?? 0;
  const tp1Pct = signal.tp1_pct ?? 0;
  const tp2Pct = signal.tp2_pct ?? 0;

  const rawPnlPct = entryPrice > 0
    ? (isLong ? ((livePrice - entryPrice) / entryPrice) * 100 : ((entryPrice - livePrice) / entryPrice) * 100)
    : 0;
  const pnlPct = parseFloat(rawPnlPct.toFixed(2));
  const isInProfit = pnlPct > 0;

  const distToTp1 = livePrice > 0 && tp1Price > 0
    ? Math.abs(((livePrice - tp1Price) / livePrice) * 100)
    : 0;
  const distToSl = livePrice > 0 && stopLoss > 0
    ? Math.abs(((livePrice - stopLoss) / livePrice) * 100)
    : 0;

  const atr = signal.atr || (entryPrice * (slPct / 100) / 1.5);
  const entryMin = signal.entry_zone_min || parseFloat((isLong ? entryPrice - 0.35 * atr : entryPrice - 0.1 * atr).toFixed(4));
  const entryMax = signal.entry_zone_max || parseFloat((isLong ? entryPrice + 0.1 * atr : entryPrice + 0.35 * atr).toFixed(4));
  const isInEntryZone = livePrice >= entryMin && livePrice <= entryMax;

  const krakenSymbol = (signal as any).kraken_symbol || `PF_${signal.symbol === 'BTC' ? 'XBT' : signal.symbol}USD`;
  const krakenUrl = `https://pro.kraken.com/app/trade/futures-${signal.symbol.toLowerCase()}-usd-perp`;

  const activeTrade = trades.find(
    (t) => (t.signalId === signal.id || t.symbol === signal.symbol) && t.status === "OPEN"
  );

  const handleCopyKrakenOrder = () => {
    const text = `
🐙 ORDEN KRAKEN PRO FUTURES - ${signal.symbol}
• Contrato: ${krakenSymbol} (o ${signal.symbol}/USD en Spot/Margin)
• Dirección: ${signal.direction}
• Apalancamiento: ${signal.leverage || 5}x (Margen Aislado)
• Tipo de Orden: LIMIT en ${formatPrice(entryMin)} – ${formatPrice(entryMax)}
• Entrada de Referencia: ${formatPrice(entryPrice)}
• Stop Loss (Trigger): ${formatPrice(stopLoss)} (-${slPct.toFixed(2)}%)
• Take Profit 1 (Reducir 50%): ${formatPrice(tp1Price)} (+${tp1Pct.toFixed(2)}%)
• Take Profit 2 (Cerrar 50% restante): ${formatPrice(tp2Price)} (+${tp2Pct.toFixed(2)}%)
• 🛡️ Regla Break-Even: Al tocar TP1, mover Stop Loss a Entrada (${formatPrice(entryPrice)}) para Riesgo 0.
    `.trim();

    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      {/* ── BARRA SUPERIOR DE ACCIONES ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
        >
          <span>←</span> Volver al Dashboard
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCopyKrakenOrder}
            className="flex items-center gap-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 px-3 py-1.5 text-xs font-bold text-indigo-300 transition cursor-pointer shadow-sm"
            title="Copiar orden lista para Kraken Pro"
          >
            <span>{copySuccess ? "✓ ¡Copiado!" : "🐙 Copiar Orden Kraken"}</span>
          </button>

          <button
            onClick={() => setShowKrakenGuide(true)}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition cursor-pointer"
            title="Guía paso a paso para Kraken Pro"
          >
            Guía Kraken
          </button>

          <button
            onClick={() => setShowPaperModal(true)}
            className="rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 text-xs font-bold text-emerald-300 transition cursor-pointer"
            title="Probar en simulador sin riesgo"
          >
            🎮 Simulador
          </button>

          <a
            href={krakenUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition flex items-center gap-1"
            title="Abrir contrato en Kraken Pro"
          >
            <span>Terminal</span> ↗
          </a>
        </div>
      </div>

      {/* ── ASESOR EN VIVO SI LA OPERACIÓN ESTÁ ABIERTA ── */}
      {activeTrade && (
        <ActiveTradeAdvisorCard trade={activeTrade} />
      )}

      {/* ── HERO COMMAND CENTER: VEREDICTO & PRECIO EN VIVO ── */}
      <div className="rounded-2xl border-2 border-emerald-500/30 bg-slate-900/90 p-5 sm:p-6 space-y-5 shadow-2xl">
        {/* Cabecera de Veredicto */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx("rounded-md px-2.5 py-1 text-xs font-black uppercase tracking-wider", badgeColor)}>
                {actionStatus}
              </span>
              <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-xs font-bold text-slate-300">
                {signal.leverage || 5}x Aislado
              </span>
              <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-xs font-mono font-bold text-indigo-300">
                R:R 1:{signal.risk_reward.toFixed(2)}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-100 flex items-center gap-2">
              <span>{dirEmoji} {signal.direction} {signal.symbol}</span>
              <span className="text-xs sm:text-sm font-normal text-slate-400 font-mono">({krakenSymbol})</span>
            </h1>

            <p className={clsx("text-xs sm:text-sm leading-relaxed font-medium p-2.5 rounded-lg border", actionBg)}>
              {verdictSummary}
            </p>
          </div>

          {/* Precio en Vivo & Confluencia */}
          <div className="flex flex-row md:flex-col items-start md:items-end justify-between md:justify-center gap-2 bg-slate-950/80 rounded-xl p-3.5 border border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">
                Precio en Vivo
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-xl sm:text-2xl font-black text-slate-100">
                {formatPrice(livePrice)}
              </span>
              <span
                className={clsx(
                  "rounded px-2 py-0.5 text-xs font-mono font-bold border",
                  isInProfit
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                    : pnlPct < 0
                    ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                    : "bg-slate-800 border-slate-700 text-slate-400"
                )}
              >
                {pnlPct > 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`}
              </span>
            </div>

            <div className="text-[11px] font-mono text-slate-400">
              Confluencia: <strong className="text-emerald-400">{score}/{total} ({Math.round((score / total) * 100)}%)</strong>
            </div>
          </div>
        </div>

        {/* 4 Niveles Clave de la Orden */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          {/* Entrada */}
          <div className="rounded-xl bg-slate-950 p-3 border border-slate-800 space-y-0.5 relative overflow-hidden">
            {isInEntryZone && (
              <span className="absolute top-2 right-2 text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded">
                🎯 EN ZONA
              </span>
            )}
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              1. Entrada Referencia
            </span>
            <span className="block font-mono text-lg font-black text-slate-100">
              {formatPrice(entryPrice)}
            </span>
            <span className="block text-[10px] text-sky-400 font-mono truncate">
              Pullback: {formatPrice(entryMin)} - {formatPrice(entryMax)}
            </span>
          </div>

          {/* Stop Loss */}
          <div className="rounded-xl bg-slate-950 p-3 border border-rose-500/30 space-y-0.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-400">
              2. Stop Loss (Innegociable)
            </span>
            <span className="block font-mono text-lg font-black text-rose-400">
              {formatPrice(stopLoss)}
            </span>
            <span className="block text-[10px] text-rose-400 font-mono">
              -{slPct.toFixed(2)}% (Dist: {distToSl.toFixed(1)}%)
            </span>
          </div>

          {/* TP1 */}
          <div className="rounded-xl bg-slate-950 p-3 border border-emerald-500/30 space-y-0.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              3. Take Profit 1 (50%)
            </span>
            <span className="block font-mono text-lg font-black text-emerald-300">
              {formatPrice(tp1Price)}
            </span>
            <span className="block text-[10px] text-emerald-400 font-mono">
              +{tp1Pct.toFixed(2)}% (Dist: {distToTp1.toFixed(1)}%)
            </span>
          </div>

          {/* TP2 */}
          <div className="rounded-xl bg-slate-950 p-3 border border-emerald-500/20 space-y-0.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              4. Take Profit 2 (100%)
            </span>
            <span className="block font-mono text-lg font-black text-emerald-300">
              {formatPrice(tp2Price)}
            </span>
            <span className="block text-[10px] text-emerald-400/80 font-mono">
              +{tp2Pct.toFixed(2)}% de rendimiento
            </span>
          </div>
        </div>

        {/* Tesis en lenguaje directo */}
        <div className="rounded-xl bg-indigo-950/25 border border-indigo-500/30 p-3 text-xs text-indigo-200 flex items-start gap-2.5">
          <span className="text-base shrink-0">💡</span>
          <div>
            <span className="font-bold text-indigo-300">Análisis Rápido: </span>
            <span className="leading-relaxed">{explanation.mainThesis}</span>
          </div>
        </div>
      </div>

      {/* ── SELECTOR DE PESTAÑAS (3 PESTAÑAS CLARAS) ── */}
      <div className="flex border-b border-slate-800 bg-slate-900/60 rounded-xl p-1 gap-1">
        <button
          onClick={() => setActiveTab("plan")}
          className={clsx(
            "flex-1 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
            activeTab === "plan"
              ? "bg-emerald-500 text-slate-950 shadow-md font-black"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
          )}
        >
          <span>🎯</span>
          <span>1. Plan de Ejecución</span>
        </button>

        <button
          onClick={() => setActiveTab("analysis")}
          className={clsx(
            "flex-1 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
            activeTab === "analysis"
              ? "bg-emerald-500 text-slate-950 shadow-md font-black"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
          )}
        >
          <span>🧠</span>
          <span>2. Análisis Cuantitativo ({score}/12)</span>
        </button>

        <button
          onClick={() => setActiveTab("risk")}
          className={clsx(
            "flex-1 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
            activeTab === "risk"
              ? "bg-emerald-500 text-slate-950 shadow-md font-black"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
          )}
        >
          <span>🛡️</span>
          <span>3. Protocolo & Riesgo</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 1: PLAN DE EJECUCIÓN (POR DEFECTO)                         */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "plan" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Plan Paso a Paso */}
          <section className="card p-5 space-y-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <span>📋</span> Plan de Ejecución Paso a Paso
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Paso 1: Entrada en Kraken Pro
                </span>
                <p className="text-slate-300 leading-relaxed font-medium">
                  Abre posición en <strong>Kraken Pro</strong> (<span className="text-indigo-300 font-mono font-bold">{krakenSymbol}</span>) en dirección <strong className={isLong ? "text-emerald-400" : "text-rose-400"}>{signal.direction}</strong> ({signal.leverage || 5}x Aislado).
                </p>
                <p className="text-[11px] text-sky-400 font-mono">
                  🎯 Rango límite: {formatPrice(entryMin)} – {formatPrice(entryMax)}
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Paso 2: Protección Stop Loss
                </span>
                <p className="text-slate-300 leading-relaxed font-medium">
                  Coloca orden de Stop Loss en <strong className="font-mono text-rose-400 font-bold">{formatPrice(stopLoss)}</strong> (-{slPct.toFixed(2)}%).
                </p>
                <p className="text-[11px] text-slate-400">
                  🛡️ Nunca muevas el Stop Loss en contra.
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Paso 3: Salida Parcial TP1 (50%)
                </span>
                <p className="text-slate-300 leading-relaxed font-medium">
                  Toma de beneficios del 50% en <strong className="font-mono text-emerald-400 font-bold">{formatPrice(tp1Price)}</strong> (+{tp1Pct.toFixed(2)}%).
                </p>
                <p className="text-[11px] text-amber-300 font-medium">
                  Al tocarlo: ¡Mover SL a Entrada (Breakeven)!
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Paso 4: Salida Final TP2 (100%)
                </span>
                <p className="text-slate-300 leading-relaxed font-medium">
                  Cierra el 50% restante en <strong className="font-mono text-emerald-300 font-bold">{formatPrice(tp2Price)}</strong> (+{tp2Pct.toFixed(2)}%) o usa Trailing Stop para dejar correr la ganancia.
                </p>
              </div>
            </div>
          </section>

          {/* Regla Break-Even */}
          <div className="flex items-start gap-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 p-3.5 text-xs text-emerald-300 leading-relaxed">
            <span className="text-lg shrink-0">🛡️</span>
            <div>
              <span className="font-bold text-emerald-200">Regla de Oro (Riesgo Cero): </span>
              <span>En cuanto la operación alcance TP1 ({formatPrice(tp1Price)}), modifica tu orden de Stop Loss y colócala exactamente en tu precio de entrada ({formatPrice(entryPrice)}). A partir de ese momento, tu riesgo será de <strong>0€</strong> y el restante correrá gratis.</span>
            </div>
          </div>

          {/* Gráfico Interactivo TradingView */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-200 flex items-center gap-2">
                <span>📊</span> Gráfico en Tiempo Real ({signal.symbol}/USDT)
              </h2>
              <span className="text-xs text-slate-400 font-mono">Velas 1 Hora</span>
            </div>
            <TradingViewChart symbol={signal.symbol} height={340} interval="60" />
          </section>

          {/* Checklist Pre-Trade */}
          <section className="card border border-amber-500/20 bg-amber-500/5 p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300 flex items-center gap-2">
              <span>📋</span> Checklist Pre-Trade (Verifica antes de enviar la orden)
            </h2>
            <div className="space-y-2 text-xs text-slate-300">
              <label className="flex items-center gap-2.5 cursor-pointer hover:text-slate-100">
                <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
                <span>Confirmar que la vela del marco temporal (15m o 1h) ha cerrado o está en zona de pullback.</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer hover:text-slate-100">
                <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
                <span>Configurar el margen como <strong>Aislado (Isolated)</strong> en Kraken Pro.</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer hover:text-slate-100">
                <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
                <span>Calcular y no arriesgar más del <strong>1% al 2%</strong> del balance total de tu cuenta.</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer hover:text-slate-100">
                <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
                <span>Ingresar inmediatamente la orden de Stop Loss ({formatPrice(stopLoss)}) junto con la orden de entrada.</span>
              </label>
            </div>
          </section>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 2: ANÁLISIS CUANTITATIVO (LOS 12 PILARES)                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "analysis" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Guía de Decisión */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
              <span className="text-lg">🧠</span>
              <div>
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-100">
                  Guía de Decisión — ¿Entro o No?
                </h2>
                <p className="text-xs text-slate-400">
                  Evaluación cuantitativa de 5 filtros esenciales para confirmar fiabilidad.
                </p>
              </div>
            </div>
            <SignalDecisionGuide signal={signal} sentimentValue={sentimentValue} />
          </section>

          {/* Radar de Ballenas */}
          {signal.whale_flow && (
            <section className={clsx(
              "card p-4 sm:p-5 border space-y-2.5",
              signal.whale_flow.bias === "WHALE_ACCUMULATION"
                ? "border-emerald-500/40 bg-gradient-to-r from-emerald-950/20 via-slate-900 to-slate-950"
                : signal.whale_flow.bias === "WHALE_DISTRIBUTION"
                ? "border-rose-500/40 bg-gradient-to-r from-rose-950/20 via-slate-900 to-slate-950"
                : "border-slate-800 bg-slate-900/60"
            )}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🐳</span>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
                    <span>Radar de Ballenas & Smart Money</span>
                    <span className={clsx(
                      "rounded px-2 py-0.5 text-[10px] font-black uppercase",
                      signal.whale_flow.bias === "WHALE_ACCUMULATION"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : signal.whale_flow.bias === "WHALE_DISTRIBUTION"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : "bg-slate-800 text-slate-300"
                    )}>
                      {signal.whale_flow.badge_text}
                    </span>
                  </h3>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span>Taker Ratio: <strong className="text-slate-100">{signal.whale_flow.taker_ratio}x</strong></span>
                  <span>Top Traders: <strong className="text-emerald-300">{(signal.whale_flow.top_trader_ratio * 100).toFixed(0)}% Long</strong></span>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {signal.whale_flow.narrative}
              </p>
            </section>
          )}

          {/* BTC Beta Guard */}
          {signal.btc_guard && (
            <section className={clsx(
              "card p-4 sm:p-5 border space-y-2",
              signal.btc_guard.status === "ALIGNED"
                ? "border-emerald-500/40 bg-emerald-950/20"
                : signal.btc_guard.status === "BLOCKED"
                ? "border-rose-500/40 bg-rose-950/20"
                : "border-slate-800 bg-slate-900/60"
            )}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg">{signal.btc_guard.status === "BLOCKED" ? "⚠️" : "🛡️"}</span>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-100">
                  BTC Beta Guard (Líder del Mercado)
                </h3>
                <span className={clsx(
                  "rounded px-2 py-0.5 text-[10px] font-black uppercase border",
                  signal.btc_guard.status === "ALIGNED"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : signal.btc_guard.status === "BLOCKED"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                )}>
                  {signal.btc_guard.status === "ALIGNED" ? "Alineado ✓" : signal.btc_guard.status === "BLOCKED" ? "Bloqueado ✕" : "Neutral"}
                </span>
                <span className="text-xs text-slate-400">
                  BTC {signal.btc_guard.btc_direction} ({signal.btc_guard.btc_strength}/10)
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {signal.btc_guard.explanation}
              </p>
            </section>
          )}

          {/* Barrida de Liquidez (Stop Hunt) */}
          {signal.liquidity_sweep && signal.liquidity_sweep.trap && (
            <section className={clsx(
              "card p-4 sm:p-5 border space-y-2",
              signal.liquidity_sweep.trap === "BEAR_SWEEP"
                ? "border-emerald-500/40 bg-emerald-950/20"
                : "border-rose-500/40 bg-rose-950/20"
            )}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg">🗺️</span>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-100">
                  Barrida de Liquidez (Stop-Hunt)
                </h3>
                <span className={clsx(
                  "rounded px-2 py-0.5 text-[10px] font-black uppercase border",
                  signal.liquidity_sweep.trap === "BEAR_SWEEP"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                )}>
                  {signal.liquidity_sweep.trap === "BEAR_SWEEP" ? "Trampa Bajista → Ballenas COMPRAN" : "Trampa Alcista → Ballenas VENDEN"}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Nivel ${signal.liquidity_sweep.level?.toFixed(4)} · Mecha {signal.liquidity_sweep.wick_pct}%
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {signal.liquidity_sweep.narrative}
              </p>
            </section>
          )}

          {/* Desglose de los 12 Pilares Cuantitativos */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-200">
                  Auditoría de los 12 Pilares Cuantitativos
                </h2>
                <p className="text-xs text-slate-500">
                  {signal.votes.filter(v => v.vote === "LONG").length} LONG · {signal.votes.filter(v => v.vote === "SHORT").length} SHORT · {signal.votes.filter(v => v.vote === "NEUTRAL").length} NEUTRO
                </p>
              </div>
              <span className="font-mono font-bold text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                {score}/{total} Votos Alineados
              </span>
            </div>

            <div className="space-y-2">
              {signal.votes.map((vote) => (
                <VoteRow key={vote.name} vote={vote} />
              ))}
            </div>
          </section>

          {/* Sesgo por Timeframe */}
          <section className="card p-5 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-200">
              Sesgo por Marco Temporal (Haz clic para ver cronograma de salida)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <BiasCard label="15 minutos" bias={signal.bias_15m} signal={signal} />
              <BiasCard label="1 hora" bias={signal.bias_1h} signal={signal} />
              <BiasCard label="4 horas" bias={signal.bias_4h} signal={signal} />
            </div>
          </section>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PESTAÑA 3: PROTOCOLO Y GESTIÓN DE RIESGO                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "risk" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Mini gráfico visual de niveles */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-200">
                Visualización de Niveles de Precio
              </h2>
              <button
                onClick={() => setShowCalculator(true)}
                className="flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
              >
                🧮 Calculadora de Riesgo
              </button>
            </div>
            <PriceLevel signal={signal} />
          </section>

          {/* Protocolo Institucional Broker Pro */}
          <section className={clsx(
            "card border p-5 space-y-4 shadow-xl",
            isLong ? "border-emerald-500/30 bg-slate-900/80" : "border-rose-500/30 bg-slate-900/80"
          )}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏛️</span>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">
                  Protocolo Institucional de Ejecución (Broker Pro)
                </h2>
              </div>
              <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                Regla Máx. 1-2%
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-950 p-3 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  1. Dimensionamiento de Posición
                </span>
                <p className="text-slate-300 leading-relaxed">
                  Entrada a precio ~<strong>{formatPrice(entryPrice)}</strong>.
                  Calcula el tamaño para que la pérdida máxima en el Stop Loss nunca supere el <strong>1% al 2%</strong> del balance total de tu cuenta.
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 p-3 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                  2. Stop Loss Estricto
                </span>
                <p className="text-slate-300 leading-relaxed">
                  SL programado en <strong className="font-mono text-rose-400">{formatPrice(stopLoss)}</strong>.
                  Los brokers profesionales <strong>jamás promedian a la baja</strong> ni amplían el SL. Si el mercado invalida la tesis, se asume sin emociones.
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 p-3 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  3. Toma Parcial & Breakeven
                </span>
                <p className="text-slate-300 leading-relaxed">
                  Al alcanzar <strong className="font-mono text-emerald-400">{formatPrice(tp1Price)}</strong>, <strong>cierra el 50%</strong> del volumen e inmediatamente sube el Stop Loss a precio de entrada.
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 p-3 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  4. Trailing Stop Final (TP2)
                </span>
                <p className="text-slate-300 leading-relaxed">
                  Deja correr el resto hasta <strong className="font-mono text-emerald-300">{formatPrice(tp2Price)}</strong> o usa Trailing Stop siguiendo la EMA21 para capturar tendencias completas.
                </p>
              </div>
            </div>
          </section>

          {/* Resultado Histórico del Setup */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Resultado & Win-Rate Histórico
              </h2>
              <SignalOutcomeBadge outcome={signal.outcome} />
            </div>

            <div className="text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>
                  Setup: <span className="font-mono text-slate-300">{signal.signal_type}</span>
                </span>
                {setupStats && (
                  <span className="font-mono font-semibold text-slate-200">
                    {winrate !== null ? `${(winrate * 100).toFixed(0)}% de acierto` : "—"} · {setupStats.wins}W/{setupStats.losses}L
                  </span>
                )}
              </div>
              {setupStats && winrate !== null && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all",
                      winrate >= 0.5 ? "bg-emerald-500" : "bg-rose-500"
                    )}
                    style={{ width: `${Math.min(100, winrate * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── MODALES INTERACTIVOS ── */}
      <PositionRiskCalculator
        signal={signal}
        isOpen={showCalculator}
        onClose={() => setShowCalculator(false)}
      />

      <PaperTradingModal
        signal={signal}
        isOpen={showPaperModal}
        onClose={() => setShowPaperModal(false)}
      />

      <KrakenExecutionModal
        signal={signal}
        isOpen={showKrakenGuide}
        onClose={() => setShowKrakenGuide(false)}
      />
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------

function formatPrice(p: number) {
  if (p >= 100) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${p.toFixed(6)}`;
}

function VoteRow({ vote }: { vote: SignalVote }) {
  const badgeColor =
    vote.vote === "LONG"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
      : vote.vote === "SHORT"
      ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
      : "bg-white/5 text-slate-400 border-white/10";
  const voteIcon =
    vote.vote === "LONG" ? "↑ LONG" : vote.vote === "SHORT" ? "↓ SHORT" : "⚪ NEUTRO";

  return (
    <div className="flex items-start gap-3 rounded-lg bg-slate-950/60 border border-slate-800/80 p-3 text-xs">
      <div className={clsx("mt-0.5 flex-shrink-0 rounded px-2 py-0.5 font-bold font-mono text-[10px] border", badgeColor)}>
        {voteIcon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-slate-200">{vote.name}</span>
          <span className="text-[10px] text-slate-500 font-mono">Ponderación: ×{vote.weight}</span>
        </div>
        <p className="mt-0.5 text-slate-400 leading-relaxed">{vote.explanation}</p>
      </div>
    </div>
  );
}

function BiasCard({ label, bias, signal }: { label: string; bias: string; signal: TradingSignalDoc }) {
  const [showModal, setShowModal] = useState(false);
  const isLong = bias.includes("LONG");
  const color = isLong
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
    : "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20";

  const is15m = label.includes("15");
  const is1h = label.includes("1 hora");

  const slFactor = is15m ? 0.6 : is1h ? 1.0 : 1.5;
  const calculatedSlPct = Math.max(0.8, signal.sl_pct * slFactor);
  const calculatedTp1Pct = calculatedSlPct * 1.8;
  const calculatedTp2Pct = calculatedSlPct * 3.2;

  const maxRiskEur = 4;
  const positionSizeEur = maxRiskEur / (calculatedSlPct / 100);
  const leverage = Math.min(10, signal.leverage);
  const marginEur = positionSizeEur / leverage;

  const entry = signal.entry_price;
  const slPrice = isLong ? entry * (1 - calculatedSlPct / 100) : entry * (1 + calculatedSlPct / 100);
  const tp1Price = isLong ? entry * (1 + calculatedTp1Pct / 100) : entry * (1 - calculatedTp1Pct / 100);
  const tp2Price = isLong ? entry * (1 + calculatedTp2Pct / 100) : entry * (1 - calculatedTp2Pct / 100);

  const durationMinutes = is15m ? 25 : is1h ? 120 : 480;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={clsx("rounded-xl border p-3 text-center transition-all cursor-pointer shadow-sm group w-full", color)}
      >
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-center gap-1">
          <span>{label}</span>
          <span className="opacity-50 group-hover:opacity-100">🔍</span>
        </p>
        <p className="mt-1 text-sm font-black font-mono tracking-tight">{bias}</p>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="card w-full max-w-md border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4 rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏱️</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Plan Operativo & Horario ({label} - {signal.symbol})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Sesgo: <strong className={isLong ? "text-emerald-400" : "text-rose-400"}>{bias}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs space-y-2 shadow-md">
              <div className="font-bold text-amber-300 flex items-center justify-between border-b border-amber-500/20 pb-1.5">
                <span>⚡ ESTIMACIÓN TEMPORAL:</span>
                <span className="text-[10px] font-mono bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-200">
                  Cierre estimado en ~{durationMinutes} min
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800">
                  <span className="text-slate-400">Entrada:</span>
                  <span className="font-mono font-bold text-slate-100">${entry.toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-rose-500/20">
                  <span className="text-rose-400">Stop Loss ({calculatedSlPct.toFixed(1)}%):</span>
                  <span className="font-mono font-bold text-rose-400">${slPrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-emerald-500/20">
                  <span className="text-emerald-400">Take Profit 1:</span>
                  <span className="font-mono font-bold text-emerald-400">${tp1Price.toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-emerald-500/20">
                  <span className="text-emerald-300">Take Profit 2 ({calculatedTp2Pct.toFixed(1)}%):</span>
                  <span className="font-mono font-bold text-emerald-300">${tp2Price.toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800 text-[11px]">
                  <span className="text-slate-400">Margen aprox. (Riesgo máx 4€):</span>
                  <span className="font-mono font-bold text-amber-300">~{marginEur.toFixed(1)} € ({leverage}x)</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="w-full rounded-xl bg-white/10 py-2 text-xs font-bold text-slate-200 hover:bg-white/20 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PriceLevel({ signal }: { signal: TradingSignalDoc }) {
  const isLong = signal.direction === "LONG";
  const entry = signal.entry_price ?? 0;
  const sl = signal.stop_loss ?? 0;
  const tp1 = signal.take_profit_1 ?? 0;
  const tp2 = signal.take_profit_2 ?? 0;

  const allPrices = [sl, entry, tp1, tp2].filter((p) => p > 0);
  const minP = allPrices.length > 0 ? Math.min(...allPrices) : 1;
  const maxP = allPrices.length > 0 ? Math.max(...allPrices) : 2;
  const range = maxP - minP || 1;

  const pct = (price: number) =>
    isLong
      ? (1 - (price - minP) / range) * 100
      : ((price - minP) / range) * 100;

  const levels = [
    { label: "TP2 (100%)", price: tp2, color: "#22c55e", opacity: 0.8, dash: "4 2" },
    { label: "TP1 (50%)", price: tp1, color: "#4ade80", opacity: 1, dash: "4 2" },
    { label: "ENTRADA", price: entry, color: "#94a3b8", opacity: 1, dash: "" },
    { label: "STOP LOSS", price: sl, color: "#ef4444", opacity: 1, dash: "4 2" },
  ].sort((a, b) => (isLong ? b.price - a.price : a.price - b.price));

  return (
    <div className="overflow-hidden rounded-xl bg-slate-950 p-4 border border-slate-800">
      <div className="relative" style={{ height: 130 }}>
        <svg width="100%" height="130" className="overflow-visible">
          {levels.map((level) => {
            const y = (pct(level.price) / 100) * 120 + 5;
            const isEntry = level.label === "ENTRADA";
            return (
              <g key={level.label}>
                <line
                  x1="80"
                  y1={y}
                  x2="100%"
                  y2={y}
                  stroke={level.color}
                  strokeWidth={isEntry ? 2 : 1}
                  strokeOpacity={level.opacity}
                  strokeDasharray={level.dash || "0"}
                />
                <text
                  x="0"
                  y={y + 4}
                  fill={level.color}
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                  fillOpacity={level.opacity}
                >
                  {level.label}
                </text>
                <text
                  x="100%"
                  y={y + 4}
                  textAnchor="end"
                  fill={level.color}
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                  fillOpacity={level.opacity}
                >
                  {formatPrice(level.price)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
