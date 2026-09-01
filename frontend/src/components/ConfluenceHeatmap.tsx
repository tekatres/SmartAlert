import { TradingSignalDoc } from "@/types";
import { clsx } from "clsx";
import { Link } from "react-router-dom";

const PILLAR_SHORT_NAMES = [
  "1. Estructura",
  "2. EMAs 9/21/50",
  "3. Volumen",
  "4. VWAP",
  "5. Momentum",
  "6. ADX Trend",
  "7. Div RSI",
  "8. Bollinger",
  "9. Velas/Funding",
];

export function ConfluenceHeatmap({ signals }: { signals: TradingSignalDoc[] }) {
  if (signals.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center">
        <p className="text-sm text-slate-400">Sin datos de matriz en vivo. Realiza un escaneo de mercado.</p>
      </div>
    );
  }

  // Sort signals by confluence score
  const sortedSignals = [...signals].sort((a, b) => b.confluence_score - a.confluence_score);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <span>🔥</span> Mapa de Calor de Confluencia en Tiempo Real ({signals.length} Activos)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Matriz de evaluación directa de los 9 pilares cuantitativos. Identifica rápida la alineación institucional.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-bold">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Alcista (LONG)
          </span>
          <span className="flex items-center gap-1 text-rose-400">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Bajista (SHORT)
          </span>
          <span className="flex items-center gap-1 text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" /> Neutro
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <th className="py-2 px-3">Par</th>
              <th className="py-2 px-2 text-center">Score</th>
              {PILLAR_SHORT_NAMES.map((name) => (
                <th key={name} className="py-2 px-1 text-center font-mono">
                  {name}
                </th>
              ))}
              <th className="py-2 px-3 text-right">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sortedSignals.map((signal) => {
              const isLong = signal.direction === "LONG";
              const score = signal.confluence_score;
              const hasConflict = (signal as any).timeframe_conflict;

              return (
                <tr
                  key={signal.id}
                  className="hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-2.5 px-3 font-bold text-slate-100 flex items-center gap-2">
                    <span
                      className={clsx(
                        "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-black",
                        isLong ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                      )}
                    >
                      {isLong ? "L" : "S"}
                    </span>
                    <span>{signal.symbol}</span>
                  </td>

                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={clsx(
                        "rounded px-2 py-0.5 font-mono font-bold text-[10px]",
                        score >= 9 && !hasConflict
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : score >= 7
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      )}
                    >
                      {score}/12
                    </span>
                  </td>

                  {/* 9 Pillars cells */}
                  {PILLAR_SHORT_NAMES.map((_, idx) => {
                    const vote = signal.votes[idx];
                    const voteType = vote ? vote.vote : "NEUTRAL";

                    return (
                      <td key={idx} className="py-2.5 px-1 text-center">
                        <div
                          title={vote ? `${vote.name}: ${vote.explanation}` : "Pilar no disponible"}
                          className={clsx(
                            "mx-auto h-6 w-full max-w-[48px] rounded flex items-center justify-center text-[10px] font-bold transition-all cursor-help border",
                            voteType === "LONG"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                              : voteType === "SHORT"
                              ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30"
                              : "bg-slate-800/40 text-slate-500 border-slate-800 hover:bg-slate-800"
                          )}
                        >
                          {voteType === "LONG" ? "▲" : voteType === "SHORT" ? "▼" : "—"}
                        </div>
                      </td>
                    );
                  })}

                  <td className="py-2.5 px-3 text-right">
                    <Link
                      to={`/signals/${signal.id}`}
                      className="rounded bg-white/5 border border-white/10 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-white/10 transition-colors"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
