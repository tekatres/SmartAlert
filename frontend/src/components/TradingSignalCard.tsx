import { Link } from "react-router-dom";
import { format } from "date-fns";
import { clsx } from "clsx";
import { TradingSignalDoc } from "@/types";

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
      <span className="text-xs tabular-nums text-slate-400">
        {score}/{total}
      </span>
    </div>
  );
}

export function TradingSignalCard({ signal }: { signal: TradingSignalDoc }) {
  const isLong = signal.direction === "LONG";
  const dirColor = isLong
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
    : "text-rose-300 bg-rose-500/10 border-rose-500/20";
  const dirEmoji = isLong ? "🟢" : "🔴";

  return (
    <Link
      to={`/signals/${signal.id}`}
      className={clsx(
        "card card-hover block p-5 no-underline border",
        isLong ? "border-emerald-500/20" : "border-rose-500/20"
      )}
      aria-label={`Ver señal ${signal.direction} de ${signal.symbol}`}
    >
      <article>
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold",
                isLong ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
              )}
            >
              {signal.symbol}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={clsx("badge border text-xs font-bold", dirColor)}>
                  {dirEmoji} {signal.direction}
                </span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
                  {signal.leverage}x
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {signal.name} · {formatTime(signal.created_at)}
              </p>
            </div>
          </div>
          {/* Confluence score */}
          <div className="text-right">
            <p className="text-xs text-slate-500">Confluencia</p>
            <ConfluenceBar
              score={signal.confluence_score}
              total={signal.confluence_total}
            />
          </div>
        </header>

        {/* Trade levels */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

        {/* Risk/Reward + Timeframe bias */}
        <footer className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">
            R:R {signal.risk_reward.toFixed(2)}
          </span>
          <BiasTag label="15m" bias={signal.bias_15m} />
          <BiasTag label="1h" bias={signal.bias_1h} />
          <BiasTag label="4h" bias={signal.bias_4h} />
          {signal.funding_rate !== 0 && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">
              FR {(signal.funding_rate * 100).toFixed(4)}%
            </span>
          )}
        </footer>
      </article>
    </Link>
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
      <p className={clsx("mt-0.5 font-mono text-sm", tone || "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}

function BiasTag({ label, bias }: { label: string; bias: string }) {
  const color =
    bias === "LONG"
      ? "bg-emerald-500/10 text-emerald-400"
      : bias === "SHORT"
      ? "bg-rose-500/10 text-rose-400"
      : "bg-white/5 text-slate-500";
  return (
    <span className={clsx("rounded px-2 py-0.5 text-xs", color)}>
      {label}: {bias}
    </span>
  );
}
