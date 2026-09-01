import { format } from "date-fns";
import { clsx } from "clsx";
import { Link } from "react-router-dom";
import { AlertDoc, AlertSeverity, AlertType } from "@/types";
import { ScoreTooltip } from "@/components/ScoreTooltip";

const TYPE_LABEL: Record<AlertType, string> = {
  price_surge: "Subida",
  price_dump: "Caída",
  volume_spike: "Volumen",
  breakout: "Breakout",
};

const TYPE_COLOR: Record<AlertType, string> = {
  price_surge: "text-emerald-300 bg-emerald-500/10",
  price_dump: "text-rose-300 bg-rose-500/10",
  volume_spike: "text-sky-300 bg-sky-500/10",
  breakout: "text-amber-300 bg-amber-500/10",
};

function scoreColor(score: number) {
  if (score >= 75) return "text-score-high";
  if (score >= 50) return "text-score-medium";
  return "text-score-low";
}

function scoreBarColor(score: number) {
  if (score >= 75) return "bg-score-high";
  if (score >= 50) return "bg-score-medium";
  return "bg-score-low";
}

function formatTime(ts: AlertDoc["created_at"]) {
  const date =
    typeof ts === "string"
      ? new Date(ts)
      : new Date(ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "HH:mm:ss");
}

function formatPrice(p: number) {
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(6)}`;
}

function formatVolume(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

export function ScoreBadge({
  score,
  breakdown,
  isPremium,
}: {
  score: number;
  breakdown?: AlertDoc["score_breakdown"];
  isPremium?: boolean;
}) {
  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1">
        <span className={clsx("text-2xl font-semibold tabular-nums", scoreColor(score))}>
          {score}
        </span>
        <ScoreTooltip score={score} breakdown={breakdown ?? null} isPremium={!!isPremium} />
      </div>
      <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
        <div
          className={clsx("h-full transition-all", scoreBarColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export function AlertCard({
  alert,
  isPremium = false,
}: {
  alert: AlertDoc;
  isPremium?: boolean;
}) {
  const positive = alert.change_pct >= 0;
  return (
    <Link
      to={`/alerts/${alert.id}`}
      className="card card-hover block p-5 no-underline"
      aria-label={`Ver detalle de ${alert.title}`}
    >
      <article>
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-sm font-semibold">
              {alert.symbol}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {alert.title}
              </h3>
              <p className="text-xs text-slate-400">
                {alert.name} · {formatTime(alert.created_at)}
              </p>
            </div>
          </div>
          <ScoreBadge
            score={alert.score}
            breakdown={alert.score_breakdown}
            isPremium={isPremium}
          />
        </header>

        <p className="mt-4 text-sm text-slate-300">{alert.summary}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Precio" value={formatPrice(alert.price_usd)} />
          <Stat
            label="Cambio"
            value={`${positive ? "+" : ""}${alert.change_pct.toFixed(2)}%`}
            tone={positive ? "text-emerald-400" : "text-rose-400"}
          />
          <Stat label="Volumen 24h" value={formatVolume(alert.volume_24h_usd)} />
          <Stat label="Vol ratio" value={`${alert.volume_ratio.toFixed(2)}x`} />
        </div>

        <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Análisis IA
          </p>
          <p className="mt-1 text-sm text-slate-300">{alert.explanation}</p>
          {alert.recommended_action && (
            <p className="mt-2 text-sm text-brand-400">
              <span className="text-slate-500">Acción: </span>
              {alert.recommended_action}
            </p>
          )}
        </div>

        <footer className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={clsx("badge", TYPE_COLOR[alert.type])}>
              {TYPE_LABEL[alert.type]}
            </span>
            {alert.outcome?.profitable_1h === true && (
              <span className="badge bg-emerald-500/10 text-emerald-300">
                ✓ Acertada
              </span>
            )}
            {alert.outcome?.profitable_1h === false && (
              <span className="badge bg-rose-500/10 text-rose-300">
                × Fallida
              </span>
            )}
          </div>
          <SeverityPill severity={alert.severity} />
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

function SeverityPill({ severity }: { severity: AlertSeverity }) {
  const map: Record<AlertSeverity, { label: string; cls: string }> = {
    low: { label: "Baja", cls: "bg-slate-500/10 text-slate-300" },
    medium: { label: "Media", cls: "bg-amber-500/10 text-amber-300" },
    high: { label: "Alta", cls: "bg-emerald-500/10 text-emerald-300" },
  };
  const { label, cls } = map[severity];
  return <span className={clsx("badge", cls)}>{label}</span>;
}
