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
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-slate-900/90 p-5 space-y-4 shadow-2xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 font-bold text-xl">
            💡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Resumen Ejecutivo Simple
              </span>
              <span className={clsx("rounded px-2 py-0.5 text-[10px] font-black uppercase", badgeColor)}>
                {actionStatus}
              </span>
            </div>
            <h2 className="text-lg font-black text-slate-100">
              ¿Qué hacer con {signal.symbol}? — Guía Rápida para la Operación
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
