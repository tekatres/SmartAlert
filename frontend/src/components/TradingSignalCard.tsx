import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { clsx } from "clsx";
import { TradingSignalDoc } from "@/types";
import { PositionRiskCalculator } from "@/components/PositionRiskCalculator";
import { PaperTradingModal } from "@/components/PaperTradingModal";
import { TradingViewChart } from "@/components/TradingViewChart";
import { SignalOutcomeBadge } from "@/components/SignalOutcomeBadge";

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
          <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4 rounded-lg bg-slate-950/60 p-2.5 sm:p-3 border border-slate-800/80">
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
          <footer className="flex flex-col gap-2.5 pt-2 border-t border-slate-800/60">
            {/* Bias tags row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300 font-mono">
                R:R {signal.risk_reward.toFixed(2)}
              </span>
              <BiasTag label="15m" bias={signal.bias_15m} />
              <BiasTag label="1h" bias={signal.bias_1h} />
              <BiasTag label="4h" bias={signal.bias_4h} />
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

function BiasTag({ label, bias }: { label: string; bias: string }) {
  const isLong = bias.includes("LONG");
  const color = isLong
    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
    : "bg-rose-500/10 text-rose-300 border-rose-500/25";
  return (
    <span className={clsx("rounded-md border px-2 py-0.5 text-xs font-mono font-bold inline-flex items-center gap-1", color)}>
      <span className="text-[10px] text-slate-400 font-sans uppercase font-bold">{label}:</span>
      <span>{bias}</span>
    </span>
  );
}

