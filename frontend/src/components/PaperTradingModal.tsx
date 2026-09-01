import { useState } from "react";
import { TradingSignalDoc } from "@/types";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { clsx } from "clsx";

interface Props {
  signal?: TradingSignalDoc | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PaperTradingModal({ signal, isOpen, onClose }: Props) {
  const { balance, trades, openTrade, closeTrade, resetAccount, winRate, netPnl } = usePaperTrading();
  const [riskUsd, setRiskUsd] = useState<number>(200);

  if (!isOpen) return null;

  const handleExecute = () => {
    if (!signal) return;
    openTrade(signal, riskUsd);
    onClose();
  };

  const openTrades = trades.filter((t) => t.status === "OPEN");
  const closedTrades = trades.filter((t) => t.status !== "OPEN");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="card w-full max-w-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xl">
              🎮
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <span>Modo Simulador · Paper Trading</span>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">
                  Sin Riesgo Real
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Pon a prueba las señales cuantitativas del motor en tiempo real.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Account Balance Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl bg-slate-950/80 p-4 border border-slate-800">
          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-500">
              Saldo Virtual
            </span>
            <span className="font-mono text-base font-bold text-emerald-400">
              ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-500">
              PnL Acumulado
            </span>
            <span
              className={clsx(
                "font-mono text-base font-bold",
                netPnl >= 0 ? "text-emerald-300" : "text-rose-400"
              )}
            >
              {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} USD
            </span>
          </div>

          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-500">
              Win-Rate Simulación
            </span>
            <span className="font-mono text-base font-bold text-amber-300">
              {winRate.toFixed(1)}%
            </span>
          </div>

          <div className="text-right">
            <button
              onClick={resetAccount}
              className="text-[10px] font-bold text-slate-500 hover:text-rose-400 transition-colors underline"
            >
              Reiniciar $10,000
            </button>
          </div>
        </div>

        {/* Execute Trade Form if signal provided */}
        {signal && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center justify-between">
              <span>🚀 Abrir Posición Simulada ({signal.symbol} {signal.direction})</span>
              <span className="font-mono text-slate-400">Entrada: ${signal.entry_price}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Margen Virtual USD ($)</label>
                <input
                  type="number"
                  step="50"
                  value={riskUsd}
                  onChange={(e) => setRiskUsd(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                onClick={handleExecute}
                className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
              >
                🎮 Ejecutar Orden en Simulador Ahora
              </button>
            </div>
          </div>
        )}

        {/* Open Trades Section */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            🟢 Posiciones Abiertas ({openTrades.length})
          </h3>

          {openTrades.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">No tienes posiciones simuladas abiertas.</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {openTrades.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-slate-950/70 p-3 border border-slate-800 text-xs font-mono"
                >
                  <div>
                    <span className={clsx("font-bold mr-2", t.direction === "LONG" ? "text-emerald-400" : "text-rose-400")}>
                      {t.symbol} {t.direction} {t.leverage}x
                    </span>
                    <span className="text-slate-400">Margen: ${t.marginUsd} USD</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => closeTrade(t.id, "CLOSED_TP1")}
                      className="rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                    >
                      TP1 (+{t.tp1Pct}%)
                    </button>
                    <button
                      onClick={() => closeTrade(t.id, "CLOSED_TP2")}
                      className="rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                    >
                      TP2 (+{t.tp2Pct}%)
                    </button>
                    <button
                      onClick={() => closeTrade(t.id, "CLOSED_SL")}
                      className="rounded bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/30"
                    >
                      SL (-{t.slPct}%)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Closed Trades History */}
        {closedTrades.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              📋 Historial de Simulaciones Cerradas ({closedTrades.length})
            </h3>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-xs font-mono">
              {closedTrades.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-slate-950/40 p-2.5 border border-slate-800/60"
                >
                  <div>
                    <span className="font-bold text-slate-200 mr-2">{t.symbol} {t.direction}</span>
                    <span className="text-slate-500">{t.status}</span>
                  </div>
                  <span className={clsx("font-bold", t.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {t.pnlUsd >= 0 ? "+" : ""}${t.pnlUsd.toFixed(2)} USD ({t.roePct >= 0 ? "+" : ""}{t.roePct.toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 text-right">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
