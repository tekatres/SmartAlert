import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { clsx } from "clsx";
import { TradingSignalDoc } from "@/types";
import { PositionRiskCalculator } from "@/components/PositionRiskCalculator";
import { PaperTradingModal } from "@/components/PaperTradingModal";
import { TradingViewChart } from "@/components/TradingViewChart";
import { SignalOutcomeBadge } from "@/components/SignalOutcomeBadge";
import { usePaperTrading, PaperTrade } from "@/hooks/usePaperTrading";

function formatPrice(p: number) {
  if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${p.toFixed(6)}`;
}

function formatTime(ts: TradingSignalDoc["created_at"]) {
  const date =
    typeof ts === "string"
      ? new Date(ts)
      : new Date(ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "HH:mm:ss");
}

function ConfluenceBar({ score, total }: { score: number; total: number }) {
  const pct = total > 0 ? (score / total) * 100 : 0;
  const color =
    pct >= 75 ? "bg-emerald-500" : pct >= 58 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/5">
        <div className={clsx("h-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums font-semibold text-slate-300">
        {score}/{total}
      </span>
    </div>
  );
}

export function TradingSignalCard({ signal }: { signal: TradingSignalDoc }) {
  const [showCalculator, setShowCalculator] = useState(false);
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const isLong = signal.direction === "LONG";
  const dirColor = isLong
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
    : "text-rose-300 bg-rose-500/10 border-rose-500/20";
  const dirEmoji = isLong ? "🟢" : "🔴";
  const hasConflict = (signal as any).timeframe_conflict;
  const score = signal.confluence_score;

  // 4-tier confluence classification
  let confluenceBadge = null;
  if (score >= 9 && !hasConflict) {
    confluenceBadge = (
      <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
        🟢 ALTA CONFLUENCIA (Señal Fuerte)
      </span>
    );
  } else if (score >= 7) {
    confluenceBadge = (
      <span className="rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
        {hasConflict ? "⚠️ CONFLUENCIA MEDIA (Conflicto 15m/4h)" : "🟡 CONFLUENCIA MEDIA (Esperar Confirmación)"}
      </span>
    );
  } else if (score >= 5) {
    confluenceBadge = (
      <span className="rounded-md bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-400">
        🟠 SEÑAL DÉBIL (Precaución / No Entrar)
      </span>
    );
  } else {
    confluenceBadge = (
      <span className="rounded-md bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400">
        🔴 DESCARTAR (&lt;5/12)
      </span>
    );
  }

  const krakenSymbol = (signal as any).kraken_symbol || `PF_${signal.symbol === 'BTC' ? 'XBT' : signal.symbol}USD`;
  const krakenUrl = `https://futures.kraken.com/trade/${krakenSymbol}`;

  return (
    <>
      <div
        className={clsx(
          "card card-hover block p-4 sm:p-5 border relative transition-all space-y-3 sm:space-y-4",
          isLong ? "border-emerald-500/30 hover:border-emerald-500/50" : "border-rose-500/30 hover:border-rose-500/50"
        )}
      >
        <article>
          {/* Header */}
          <header className="flex items-start justify-between gap-2 sm:gap-4">
            <div className="flex items-start gap-2 sm:gap-3 min-w-0">
              <div
                className={clsx(
                  "flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl font-black text-xs sm:text-sm shadow-md",
                  isLong ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                )}
              >
                {signal.symbol}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={clsx("badge border text-xs font-bold px-2 py-0.5 shrink-0", dirColor)}>
                    {dirEmoji} {signal.direction}
                  </span>
                  <span className="rounded-md bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300 shrink-0">
                    {signal.leverage}x
                  </span>
                  <span className="w-full sm:w-auto">{confluenceBadge}</span>
                  <SignalOutcomeBadge outcome={signal.outcome} />
                </div>
                <p className="mt-1 text-xs text-slate-400 truncate">
                  {signal.name} · {formatTime(signal.created_at)}
                </p>
              </div>
            </div>

            {/* Confluence score */}
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Conf.</p>
              <ConfluenceBar
                score={signal.confluence_score}
                total={signal.confluence_total}
              />
            </div>
          </header>

          {/* Trade levels */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-5 rounded-lg bg-slate-950/60 p-2.5 sm:p-3 border border-slate-800/80">
            <Stat label="Entrada" value={formatPrice(signal.entry_price)} />
            <Stat
              label="Margen (200€)"
              value={`~$${((4 / (signal.sl_pct / 100)) / Math.min(10, signal.leverage)).toFixed(1)}`}
              tone="text-amber-300 font-bold"
            />
            <Stat
              label="Stop-Loss"
              value={`-${signal.sl_pct.toFixed(2)}%`}
              tone="text-rose-400"
            />
            <Stat
              label="TP1 (50%)"
              value={`+${signal.tp1_pct.toFixed(2)}%`}
              tone="text-emerald-400"
            />
            <Stat
              label="TP2 (100%)"
              value={`+${signal.tp2_pct.toFixed(2)}%`}
              tone="text-emerald-300"
            />
          </div>

          {/* Collapsible Chart */}
          {showChart && (
            <div className="mt-4 animate-in fade-in zoom-in duration-200">
              <TradingViewChart symbol={signal.symbol} height={320} interval="60" />
            </div>
          )}

          {/* Risk/Reward + Actions */}
          <footer className="flex flex-col gap-2.5 pt-2 border-t border-slate-800/60">
            {/* Bias tags row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300 font-mono">
                R:R {signal.risk_reward.toFixed(2)}
              </span>
              <BiasTag label="15m" bias={signal.bias_15m} signal={signal} />
              <BiasTag label="1h" bias={signal.bias_1h} signal={signal} />
              <BiasTag label="4h" bias={signal.bias_4h} signal={signal} />
            </div>

            {/* Action buttons — 3-col grid on mobile, inline on sm+ */}
            <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
              <button
                onClick={() => setShowChart(!showChart)}
                className={clsx(
                  "rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors text-center",
                  showChart
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                )}
              >
                📊 Gráfico
              </button>

              <button
                onClick={() => setShowPaperModal(true)}
                className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors text-center"
                title="Ejecutar en modo simulador sin riesgo"
              >
                🎮 Simulador
              </button>

              <button
                onClick={() => setShowCalculator(true)}
                className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors text-center"
                title="Calcular riesgo para tu capital"
              >
                🧮 Riesgo
              </button>

              <a
                href={krakenUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors text-center col-span-1"
                title="Abrir en Kraken Futures"
              >
                🏛️ Kraken
              </a>

              <Link
                to={`/signals/${signal.id}`}
                className="rounded-lg bg-brand-500/20 border border-brand-500/40 px-2 py-1.5 text-xs font-bold text-brand-300 hover:bg-brand-500/30 transition-colors text-center col-span-2 sm:col-span-1"
              >
                Ver Detalle →
              </Link>
            </div>
          </footer>
        </article>
      </div>

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
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={clsx("mt-0.5 font-mono text-sm font-semibold", tone || "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}

function BiasTag({ label, bias, signal }: { label: string; bias: string; signal: TradingSignalDoc }) {
  const [showModal, setShowModal] = useState(false);
  const isLong = bias.includes("LONG");
  const color = isLong
    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
    : "bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20";

  // Calculate parameters for this timeframe
  const is15m = label.includes("15m") || label.includes("15");
  const is1h = label.includes("1h");

  // Timeframe specific multipliers for SL and TP
  const slFactor = is15m ? 0.6 : is1h ? 1.0 : 1.5; // 15m tighter SL, 4h wider SL
  const calculatedSlPct = Math.max(0.8, signal.sl_pct * slFactor);
  const calculatedTp1Pct = calculatedSlPct * 1.8;
  const calculatedTp2Pct = calculatedSlPct * 3.2;

  // Capital calculation & user input overrides for trade registration
  const [customMargin, setCustomMargin] = useState<number>(30);
  const [customLeverage, setCustomLeverage] = useState<number>(Math.min(10, signal.leverage));
  const [tradeRegistered, setTradeRegistered] = useState(false);
  const { balance, openTradeParams, trades, closeTrade } = usePaperTrading();

  const entry = signal.entry_price;
  const slPrice = isLong ? entry * (1 - calculatedSlPct / 100) : entry * (1 + calculatedSlPct / 100);
  const tp1Price = isLong ? entry * (1 + calculatedTp1Pct / 100) : entry * (1 - calculatedTp1Pct / 100);
  const tp2Price = isLong ? entry * (1 + calculatedTp2Pct / 100) : entry * (1 - calculatedTp2Pct / 100);

  // Exact timestamp calculations
  const createdDate =
    typeof signal.created_at === "string"
      ? new Date(signal.created_at)
      : new Date(signal.created_at.seconds * 1000 + (signal.created_at.nanoseconds || 0) / 1e6);
  const validCreated = !Number.isNaN(createdDate.getTime()) ? createdDate : new Date();

  const durationMinutes = is15m ? 25 : is1h ? 120 : 480;
  const maxExitMinutes = is15m ? 45 : is1h ? 240 : 1440;

  const targetExitTime = new Date(validCreated.getTime() + durationMinutes * 60 * 1000);
  const maxExitTime = new Date(validCreated.getTime() + maxExitMinutes * 60 * 1000);

  const formatClock = (d: Date) =>
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const activeTrade = trades.find((t: PaperTrade) => t.signalId === signal.id && t.status === "OPEN");

  const handleRegisterTrade = () => {
    openTradeParams({
      symbol: signal.symbol,
      direction: isLong ? "LONG" : "SHORT",
      orderType: "MARKET",
      marginMode: "ISOLATED",
      entryPrice: entry,
      marginUsd: customMargin,
      leverage: customLeverage,
      slPct: calculatedSlPct,
      tp1Pct: calculatedTp1Pct,
      tp2Pct: calculatedTp2Pct,
      signalId: signal.id,
    });
    setTradeRegistered(true);
    setTimeout(() => setTradeRegistered(false), 3000);
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={clsx(
          "rounded-md border px-2 py-0.5 text-xs font-mono font-bold inline-flex items-center gap-1 transition-all cursor-pointer shadow-sm group",
          color
        )}
        title={`Haz clic para ver plan operativo de ${label}`}
      >
        <span className="text-[10px] text-slate-400 font-sans uppercase font-bold">{label}:</span>
        <span>{bias}</span>
        <span className="text-[9px] opacity-60 group-hover:opacity-100">🔍</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-y-auto">
          <div className="card w-full max-w-md border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4 rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏱️</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Plan Operativo ({label} - {signal.symbol})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Saldo Real/Simulado: <strong className="text-emerald-400 font-mono">${balance.toFixed(2)} USDT</strong>
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

            {/* REGISTER TRADE FORM INSIDE MODAL */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
              <span className="text-xs font-bold text-emerald-300 block uppercase tracking-wider">
                ✍️ Registra tu Entrada Personal
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Margen Aportado ($)</label>
                  <input
                    type="number"
                    value={customMargin}
                    onChange={(e) => setCustomMargin(Number(e.target.value))}
                    className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-100 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Apalancamiento (x)</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={customLeverage}
                    onChange={(e) => setCustomLeverage(Number(e.target.value))}
                    className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-amber-300 font-mono font-bold focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {!activeTrade ? (
                <button
                  onClick={handleRegisterTrade}
                  className="w-full rounded-lg bg-emerald-500 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all shadow-md mt-1"
                >
                  🚀 Registrar Orden en mi Cuenta (${customMargin} USDT en {customLeverage}x)
                </button>
              ) : (
                <div className="rounded bg-emerald-500/20 border border-emerald-500/30 p-2 text-center text-xs font-bold text-emerald-300">
                  ✅ Operación Registrada Activa (${activeTrade.marginUsd} USD a {activeTrade.leverage}x)
                </div>
              )}

              {tradeRegistered && (
                <p className="text-[10px] text-emerald-400 font-medium text-center">
                  ¡Registrado con éxito! Tu saldo se ha actualizado.
                </p>
              )}
            </div>

            {/* REGISTER WIN OR LOSS CONTROL FOR ACTIVE OR CURRENT TRADE */}
            {activeTrade && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <span className="text-xs font-bold text-amber-300 block uppercase tracking-wider">
                  🏁 Marcar Resultado Final (Auto-Aprendizaje Motor)
                </span>
                <p className="text-[10px] text-slate-300">
                  ¿Cómo ha finalizado tu operación? El motor analizará el fallo si marcas pérdida.
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => closeTrade(activeTrade.id, "CLOSED_TP1")}
                    className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-1.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                  >
                    🟢 Ganada TP1
                  </button>
                  <button
                    onClick={() => closeTrade(activeTrade.id, "CLOSED_TP2")}
                    className="rounded bg-emerald-500/30 border border-emerald-500/50 px-2 py-1.5 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/40"
                  >
                    🟢 Ganada TP2
                  </button>
                  <button
                    onClick={() => closeTrade(activeTrade.id, "CLOSED_SL")}
                    className="rounded bg-rose-500/20 border border-rose-500/40 px-2 py-1.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/30"
                  >
                    🔴 Perdida (SL)
                  </button>
                </div>
              </div>
            )}

            {/* EXACT HORARY EXIT CARD */}
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs space-y-2 shadow-md">
              <div className="font-bold text-amber-300 flex items-center justify-between border-b border-amber-500/20 pb-1.5">
                <span>⚡ CRONOGRAMA DE OPERACIÓN:</span>
                <span className="text-[10px] font-mono bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-200">
                  Entrada AHORA → Cierre en {durationMinutes} min
                </span>
              </div>

              <div className="flex justify-between items-center bg-slate-950/90 px-3 py-1.5 rounded border border-emerald-500/30 font-mono text-[11px]">
                <span className="text-emerald-400 font-sans font-bold">🟢 HORA DE ENTRADA (ABRIR AHORA):</span>
                <span className="text-slate-100 font-bold">{formatClock(validCreated)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[9px] font-sans uppercase font-bold">🎯 Hora Salida TP1 (Estimada)</span>
                  <span className="text-emerald-300 font-bold text-xs">{formatClock(targetExitTime)}</span>
                  <span className="text-[9px] text-slate-400 block font-sans">(~{durationMinutes} min tras entrar)</span>
                </div>

                <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[9px] font-sans uppercase font-bold">🛑 Hora Salida Máx. (Incondicional)</span>
                  <span className="text-rose-400 font-bold text-xs">{formatClock(maxExitTime)}</span>
                  <span className="text-[9px] text-slate-400 block font-sans">(Cierra si no tocó TP1)</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-slate-800">
                <span className="text-slate-400 font-bold">Precio de Entrada:</span>
                <span className="font-mono font-bold text-slate-100">${entry.toFixed(4)}</span>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-rose-500/20">
                <span className="text-rose-400 font-bold">Stop Loss ({calculatedSlPct.toFixed(1)}%):</span>
                <span className="font-mono font-bold text-rose-400">${slPrice.toFixed(4)}</span>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-emerald-500/20">
                <span className="text-emerald-400 font-bold">Take Profit 1 (50%):</span>
                <span className="font-mono font-bold text-emerald-400">${tp1Price.toFixed(4)} (+${(customMargin * (calculatedTp1Pct / 100) * customLeverage * 0.5).toFixed(2)})</span>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-emerald-500/20">
                <span className="text-emerald-300 font-bold">Take Profit 2 (100%):</span>
                <span className="font-mono font-bold text-emerald-300">${tp2Price.toFixed(4)} (+${(customMargin * (calculatedTp2Pct / 100) * customLeverage).toFixed(2)})</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              💡 <strong>Regla de Salida a las {formatClock(maxExitTime)}:</strong> {is15m ? `En scalping de 15m no te quedes atascado. A las ${formatClock(maxExitTime)} (máximo 45 min), si el mercado no ha llegado a TP1, cierra la operación manualmente a mercado.` : `En ${label}, si a las ${formatClock(maxExitTime)} no ha llegado a TP1, cierra para liberar el margen.`}
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="w-full rounded-xl bg-white/10 py-2 text-xs font-bold text-slate-200 hover:bg-white/20 transition-colors"
            >
              Cerrar Ventana
            </button>
          </div>
        </div>
      )}
    </>
  );
}
