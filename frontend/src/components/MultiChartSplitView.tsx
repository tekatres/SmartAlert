import { useState } from "react";
import { TradingSignalDoc } from "@/types";
import { TradingViewChart } from "@/components/TradingViewChart";
import { clsx } from "clsx";

interface Props {
  signals: TradingSignalDoc[];
}

export function MultiChartSplitView({ signals }: Props) {
  const [globalTf, setGlobalTf] = useState<"15" | "60" | "240">("60");
  const [gridCols, setGridCols] = useState<1 | 2>(2);

  // If no signals are present, offer popular default pairs
  const activeSignals = signals.length > 0
    ? signals
    : [
        { id: "s1", symbol: "BTC", direction: "LONG", confluence_score: 9 },
        { id: "s2", symbol: "ETH", direction: "LONG", confluence_score: 8 },
        { id: "s3", symbol: "SOL", direction: "LONG", confluence_score: 8 },
        { id: "s4", symbol: "BNB", direction: "SHORT", confluence_score: 7 },
      ] as any[];

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl bg-slate-900/90 p-4 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 font-bold text-lg">
            🖥️
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span>Vista Dividida Multi-Gráficos</span>
              <span className="badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                {activeSignals.length} Pares en Vivo
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Gráficos de velas de Binance Futures simultáneos con herramientas de análisis
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Global Timeframe Selector */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-500 font-bold px-2 uppercase">Timeframe:</span>
            {(["15", "60", "240"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setGlobalTf(tf)}
                className={clsx(
                  "rounded px-2.5 py-1 text-xs font-bold transition-all",
                  globalTf === tf
                    ? "bg-emerald-500 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {tf === "15" ? "15m" : tf === "60" ? "1h" : "4h"}
              </button>
            ))}
          </div>

          {/* Grid Layout Toggle */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setGridCols(1)}
              className={clsx(
                "rounded px-2.5 py-1 text-xs font-bold transition-all",
                gridCols === 1
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              )}
              title="Columna Única"
            >
              █ 1 Columna
            </button>
            <button
              onClick={() => setGridCols(2)}
              className={clsx(
                "rounded px-2.5 py-1 text-xs font-bold transition-all",
                gridCols === 2
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              )}
              title="Cuadrícula 2x2"
            >
              ▌▌ 2 Columnas
            </button>
          </div>
        </div>
      </div>

      {/* Split Charts Grid */}
      <div
        className={clsx(
          "grid gap-4 transition-all",
          gridCols === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"
        )}
      >
        {activeSignals.map((signal) => (
          <div key={signal.id} className="relative">
            <TradingViewChart
              symbol={signal.symbol}
              height={450}
              interval={globalTf}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
