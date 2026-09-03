import { TradingSignalDoc } from "@/types";
import { clsx } from "clsx";

export function ExecutiveSummaryCard({ signal }: { signal: TradingSignalDoc }) {
  const isLong = signal.direction === "LONG";
  const score = signal.confluence_score ?? 0;
  const hasConflict = (signal as any).timeframe_conflict === true;

  // Defensive fallbacks for numeric fields that may be missing on old signals
  const entryPrice   = signal.entry_price   ?? 0;
  const stopLoss     = signal.stop_loss     ?? 0;
  const tp1Price     = signal.take_profit_1 ?? 0;
  const slPct        = signal.sl_pct        ?? 0;
  const tp1Pct       = signal.tp1_pct       ?? 0;
  // Simple verdict logic
  let actionStatus = "ENTRAR AHORA";
  let actionBg = "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
  let badgeColor = "bg-emerald-500 text-slate-950";
  let summaryText = `Oportunidad recomendada. La estructura cuantitativa de ${signal.symbol} muestra fuerza ${isLong ? "alcista" : "bajista"} sólida.`;

  if (score < 7 || hasConflict) {
    actionStatus = "ESPERAR CONFIRMACIÓN";
    actionBg = "bg-amber-500/10 border-amber-500/30 text-amber-300";
    badgeColor = "bg-amber-500 text-slate-950";
    summaryText = `Mercado con señales mixtas en ${signal.symbol}. Se recomienda esperar a que se confirmen las temporalidades.`;
  } else if (score < 5) {
    actionStatus = "NO ENTRAR";
    actionBg = "bg-rose-500/10 border-rose-500/30 text-rose-400";
    badgeColor = "bg-rose-500 text-slate-950";
    summaryText = `Baja alineación de indicadores. Riesgo alto de movimiento falso en ${signal.symbol}.`;
  }

  const confidencePct = Math.round((score / 12) * 100);

  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-slate-900/90 p-4 sm:p-5 space-y-3 sm:space-y-4 shadow-2xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 font-bold text-xl">
            💡
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Resumen Ejecutivo Simple
              </span>
              <span className={clsx("rounded px-2 py-0.5 text-[10px] font-black uppercase", badgeColor)}>
                {actionStatus}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-black text-slate-100 leading-tight">
              ¿Qué hacer? — {signal.symbol} Guía Rápida
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs self-start sm:self-auto">
          <span className="text-slate-400">Fiabilidad Cuantitativa:</span>
          <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
            {confidencePct}% ({score}/12 Pilares)
          </span>
        </div>
      </div>

      {/* Main Verdict Box */}
      <div className={clsx("rounded-xl p-3.5 border text-xs leading-relaxed font-medium", actionBg)}>
        <p className="text-sm font-bold mb-1">
          {isLong ? "🚀 Recomendación ALCISTA (LONG)" : "📉 Recomendación BAJISTA (SHORT)"}
        </p>
        <p>{summaryText}</p>
      </div>

      {/* 3 Key Numbers (Big & Clear) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        {/* Entry */}
        <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            1. Precio de Entrada Recomendado
          </span>
          <span className="block font-mono text-xl font-black text-slate-100">
            ${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </span>
          <span className="block text-[10px] text-slate-500">
            Punto óptimo para colocar la orden
          </span>
        </div>

        {/* Take Profit */}
        <div className="rounded-xl bg-slate-950 p-3.5 border border-emerald-500/30 space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            2. Meta de Ganancia (TP1)
          </span>
          <span className="block font-mono text-xl font-black text-emerald-300">
            ${tp1Price.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </span>
          <span className="block text-[10px] font-bold text-emerald-400">
            +{tp1Pct.toFixed(1)}% de rendimiento directo
          </span>
        </div>

        {/* Stop Loss */}
        <div className="rounded-xl bg-slate-950 p-3.5 border border-rose-500/30 space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-400">
            3. Límite de Pérdida (Stop Loss)
          </span>
          <span className="block font-mono text-xl font-black text-rose-400">
            ${stopLoss.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </span>
          <span className="block text-[10px] font-bold text-rose-400">
            Máxima pérdida protegida: -{slPct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* INSTRUCCIÓN PASO A PASO DIRECTA Y PRECISA */}
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 sm:p-4 space-y-2.5">
        <h4 className="text-xs font-black uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
          <span>⚡</span> Instrucciones Exactas para Enviar la Orden
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
          <div className="rounded-lg bg-slate-950/70 p-2.5 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Paso 1: Tipo & Entrada</span>
            <p className="mt-0.5 font-medium">
              Abre posición <strong className={isLong ? "text-emerald-400 font-black" : "text-rose-400 font-black"}>{signal.direction}</strong> con margen <strong>Aislado (Isolated)</strong> a <strong className="font-mono text-slate-100">${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong> (Apalancamiento: <strong className="text-amber-300">{signal.leverage || 5}x</strong>).
            </p>
          </div>
          <div className="rounded-lg bg-slate-950/70 p-2.5 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Paso 2: Protección Stop Loss</span>
            <p className="mt-0.5 font-medium">
              Pon orden SL en <strong className="font-mono text-rose-400 font-bold">${stopLoss.toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong> (-{slPct.toFixed(2)}%). <span className="text-slate-400">Nunca muevas el SL en contra.</span>
            </p>
          </div>
          <div className="rounded-lg bg-slate-950/70 p-2.5 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Paso 3: Salida Parcial TP1 (50%)</span>
            <p className="mt-0.5 font-medium">
              Venta programada en <strong className="font-mono text-emerald-400 font-bold">${tp1Price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong> (+{tp1Pct.toFixed(2)}%). Al tocarlo, <span className="text-amber-300 font-semibold">mueve SL a Breakeven</span> (precio de entrada).
            </p>
          </div>
          <div className="rounded-lg bg-slate-950/70 p-2.5 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Paso 4: Salida Final TP2 (100%)</span>
            <p className="mt-0.5 font-medium">
              Cierra el 50% restante en <strong className="font-mono text-emerald-300 font-bold">${(signal.take_profit_2 ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong> (+{(signal.tp2_pct ?? 0).toFixed(2)}%) o usa Trailing Stop.
            </p>
          </div>
        </div>
      </div>

      {/* 2 Simple Reasons Why It's Reliable */}
      <div className="rounded-xl bg-slate-950/60 p-3.5 border border-slate-800 space-y-2 text-xs">
        <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
          <span>🛡️</span> ¿Por qué es confiable esta operación?
        </h4>
        <ul className="space-y-1 text-slate-400 text-[11px]">
          <li className="flex items-center gap-2">
            <span className="text-emerald-400 font-bold">✓</span>
            <span><strong>Alineación Cuantitativa:</strong> {score} de los 12 pilares técnicos apuntan exactamente en la misma dirección.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-emerald-400 font-bold">✓</span>
            <span><strong>Protección Volatilidad ATR:</strong> El Stop Loss está calculado con 1.5x ATR para evitar barridos bruscos de mercado.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
