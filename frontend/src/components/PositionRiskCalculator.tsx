import { useState } from "react";
import { TradingSignalDoc } from "@/types";
import { clsx } from "clsx";

interface Props {
  signal?: TradingSignalDoc | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PositionRiskCalculator({ signal, isOpen, onClose }: Props) {
  if (!isOpen) return null;

  // Defaults or pre-filled from signal
  const defaultEntry = signal ? signal.entry_price : 100;
  const defaultSlPct = signal ? signal.sl_pct : 2.5;
  const defaultTp1Pct = signal ? signal.tp1_pct : 3.5;
  const defaultTp2Pct = signal ? signal.tp2_pct : 7.0;
  const defaultLeverage = signal ? Math.min(10, signal.leverage) : 5;
  const defaultDirection = signal ? signal.direction : "LONG";

  const [accountCapital, setAccountCapital] = useState<number>(200);
  const [riskPct, setRiskPct] = useState<number>(2); // 2% risk per trade
  const [entryPrice, setEntryPrice] = useState<number>(defaultEntry);
  const [slPct, setSlPct] = useState<number>(defaultSlPct);
  const [tp1Pct, setTp1Pct] = useState<number>(defaultTp1Pct);
  const [tp2Pct, setTp2Pct] = useState<number>(defaultTp2Pct);
  const [leverage, setLeverage] = useState<number>(defaultLeverage);
  const [direction, setDirection] = useState<"LONG" | "SHORT">(
    defaultDirection === "SHORT" ? "SHORT" : "LONG"
  );
  const [copied, setCopied] = useState(false);

  // Calculations
  const maxRiskUsd = (accountCapital * riskPct) / 100;
  // Position size in USDT = Risk USD / (SL Pct / 100)
  const positionSizeUsdt = slPct > 0 ? maxRiskUsd / (slPct / 100) : 0;
  const marginRequiredUsdt = leverage > 0 ? positionSizeUsdt / leverage : 0;
  
  const tp1Usd = positionSizeUsdt * (tp1Pct / 100);
  const tp2Usd = positionSizeUsdt * (tp2Pct / 100);
  
  const isLong = direction === "LONG";
  const calculatedSlPrice = isLong
    ? entryPrice * (1 - slPct / 100)
    : entryPrice * (1 + slPct / 100);

  const calculatedTp1Price = isLong
    ? entryPrice * (1 + tp1Pct / 100)
    : entryPrice * (1 - tp1Pct / 100);

  const calculatedTp2Price = isLong
    ? entryPrice * (1 + tp2Pct / 100)
    : entryPrice * (1 - tp2Pct / 100);

  const handleCopyParams = () => {
    const text = `
🎯 [SmartAlert Params - ${signal?.symbol || "CUSTOM"} ${direction}]
- Modo: ${leverage}x Aislado/Cruzado
- Entrada: $${entryPrice.toFixed(4)}
- Margen Sugerido: $${marginRequiredUsdt.toFixed(2)} USDT (Posición: $${positionSizeUsdt.toFixed(2)})
- Stop Loss: $${calculatedSlPrice.toFixed(4)} (-$${maxRiskUsd.toFixed(2)})
- Take Profit 1 (50%): $${calculatedTp1Price.toFixed(4)} (+$${(tp1Usd * 0.5).toFixed(2)})
- Take Profit 2 (100%): $${calculatedTp2Price.toFixed(4)} (+$${tp2Usd.toFixed(2)})
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4 overflow-hidden">
      <div className="card w-full sm:max-w-xl border border-slate-700 bg-slate-900 p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 animate-in fade-in slide-in-from-bottom-4 sm:zoom-in duration-200 max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 font-bold text-lg">
              🧮
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                Calculadora de Riesgo de Posición
              </h2>
              <p className="text-xs text-slate-400">
                {signal ? `Configurada para ${signal.symbol} (${signal.direction})` : "Gestión de capital para futuros"}
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

        {/* Direction Switch & Signal Banner */}
        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDirection("LONG")}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                direction === "LONG"
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              )}
            >
              🟢 LONG
            </button>
            <button
              onClick={() => setDirection("SHORT")}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                direction === "SHORT"
                  ? "bg-rose-500 text-slate-950"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              )}
            >
              🔴 SHORT
            </button>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">Apalancamiento: </span>
            <span className="font-mono font-bold text-amber-300">{leverage}x</span>
          </div>
        </div>

        {/* Input Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Capital de Cuenta ($ USDT)
            </label>
            <input
              type="number"
              value={accountCapital}
              onChange={(e) => setAccountCapital(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Riesgo Máximo por Operación (%)
            </label>
            <input
              type="number"
              step="0.5"
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Precio Entrada ($)
            </label>
            <input
              type="number"
              step="any"
              value={entryPrice}
              onChange={(e) => setEntryPrice(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Apalancamiento (x)
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={leverage}
              onChange={(e) => setLeverage(Math.min(10, Number(e.target.value)))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
            {leverage > 5 && (
              <p className="mt-1 text-[10px] text-amber-400 font-medium">
                ⚠️ Apalancamiento elevado. Usa Modo Aislado y no arriesgues más del 2%.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Stop-Loss (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={slPct}
              onChange={(e) => setSlPct(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-rose-400 focus:border-rose-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Take-Profit 1 (50%) (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={tp1Pct}
              onChange={(e) => setTp1Pct(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-emerald-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Take-Profit 2 (100%) (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={tp2Pct}
              onChange={(e) => setTp2Pct(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-emerald-300 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Calculated Results Box */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              📊 Resultados de Gestión de Riesgo
            </h3>
            {signal?.atr && (
              <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                ATR (14, 1h): ${signal.atr}
              </span>
            )}
          </div>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-300 space-y-1">
            <div className="font-bold flex items-center justify-between">
              <span>🎯 Orden Exacta Recomendada para tu Cuenta de 200 €:</span>
              <span className="font-mono bg-emerald-500/20 px-2 py-0.5 rounded text-[11px] text-emerald-200">
                Margen a usar: ~${marginRequiredUsdt.toFixed(2)} USDT
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-normal">
              Entras con un <strong>margen de ${marginRequiredUsdt.toFixed(2)} USDT</strong> ({leverage}x Apalancamiento Aislado). Tu posición total será de <strong>${positionSizeUsdt.toFixed(2)} USDT</strong>. Si salta el Stop Loss a ${calculatedSlPrice.toFixed(4)}, solo perderás el 2% de tu cuenta (<strong>-${maxRiskUsd.toFixed(2)} USDT</strong>).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-900/90 p-2.5 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-medium">
                Pérdida Máxima (SL)
              </span>
              <span className="font-mono text-sm font-bold text-rose-400">
                -${maxRiskUsd.toFixed(2)} USD
              </span>
            </div>

            <div className="rounded-lg bg-slate-900/90 p-2.5 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-medium">
                Margen Requerido
              </span>
              <span className="font-mono text-sm font-bold text-amber-300">
                ${marginRequiredUsdt.toFixed(2)} USD
              </span>
            </div>

            <div className="rounded-lg bg-slate-900/90 p-2.5 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-medium">
                Tamaño Posición
              </span>
              <span className="font-mono text-sm font-bold text-slate-200">
                ${positionSizeUsdt.toFixed(2)} USD
              </span>
            </div>

            <div className="rounded-lg bg-slate-900/90 p-2.5 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-medium">
                Ganancia TP1 (50%)
              </span>
              <span className="font-mono text-sm font-bold text-emerald-400">
                +${(tp1Usd * 0.5).toFixed(2)} USD
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs font-mono text-slate-400">
            <div>
              <span>SL Price: </span>
              <span className="text-rose-400 font-bold">${calculatedSlPrice.toFixed(4)}</span>
            </div>
            <div>
              <span>TP1 Price: </span>
              <span className="text-emerald-400 font-bold">${calculatedTp1Price.toFixed(4)}</span>
            </div>
            <div>
              <span>TP2 Price: </span>
              <span className="text-emerald-300 font-bold">${calculatedTp2Price.toFixed(4)}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2">
          <button
            onClick={handleCopyParams}
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/20 flex-1"
          >
            {copied ? "✓ Copiado" : "📋 Copiar Parámetros"}
          </button>

          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors sm:w-auto"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
