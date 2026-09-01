import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { clsx } from "clsx";
import { TradingSignalDoc } from "@/types";
import { PositionRiskCalculator } from "@/components/PositionRiskCalculator";
import { TradingViewChart } from "@/components/TradingViewChart";

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
  const [showChart, setShowChart] = useState(false);
  const isLong = signal.direction === "LONG";
  const dirColor = isLong
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
    : "text-rose-300 bg-rose-500/10 border-rose-500/20";
  const dirEmoji = isLong ? "🟢" : "🔴";
  const isHighConfluence = signal.confluence_score >= 8;

  const krakenSymbol = (signal as any).kraken_symbol || `PF_${signal.symbol === 'BTC' ? 'XBT' : signal.symbol}USD`;
  const krakenUrl = `https://futures.kraken.com/trade/${krakenSymbol}`;

  return (
    <>
      <div
        className={clsx(
          "card card-hover block p-5 border relative transition-all space-y-4",
          isLong ? "border-emerald-500/30 hover:border-emerald-500/50" : "border-rose-500/30 hover:border-rose-500/50"
        )}
      >
        <article>
          {/* Header */}
          <header className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={clsx(
                  "flex h-11 w-11 items-center justify-center rounded-xl font-black text-sm shadow-md",
                  isLong ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                )}
              >
                {signal.symbol}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={clsx("badge border text-xs font-bold px-2 py-0.5", dirColor)}>
                    {dirEmoji} {signal.direction}
                  </span>
                  <span className="rounded-md bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300">
                    {signal.leverage}x
                  </span>
                  {isHighConfluence && (
                    <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      ⚡ ALTA CONFLUENCIA
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {signal.name} · {formatTime(signal.created_at)}
                </p>
              </div>
            </div>

            {/* Confluence score */}
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Confluencia</p>
              <ConfluenceBar
                score={signal.confluence_score}
                total={signal.confluence_total}
              />
            </div>
          </header>

          {/* Trade levels */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
            <Stat label="Entrada" value={formatPrice(signal.entry_price)} />
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
          <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300 font-mono">
                R:R {signal.risk_reward.toFixed(2)}
              </span>
              <BiasTag label="15m" bias={signal.bias_15m} />
              <BiasTag label="1h" bias={signal.bias_1h} />
              <BiasTag label="4h" bias={signal.bias_4h} />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowChart(!showChart)}
                className={clsx(
                  "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                  showChart
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                )}
              >
                📊 {showChart ? "Ocultar Gráfico" : "Ver Gráfico"}
              </button>

              <button
                onClick={() => setShowCalculator(true)}
                className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                title="Calcular riesgo para tu capital"
              >
                🧮 Riesgo
              </button>

              <a
                href={krakenUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                title="Abrir en Kraken Futures"
              >
                🏛️ Kraken ↗
              </a>

              <Link
                to={`/signals/${signal.id}`}
                className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
              >
                Detalle →
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

function BiasTag({ label, bias }: { label: string; bias: string }) {
  const color =
    bias === "LONG"
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      : bias === "SHORT"
      ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
      : "bg-white/5 text-slate-500 border border-white/5";
  return (
    <span className={clsx("rounded px-2 py-0.5 text-xs font-medium", color)}>
      {label}: {bias}
    </span>
  );
}

