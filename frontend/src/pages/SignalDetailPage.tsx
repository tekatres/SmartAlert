import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { doc, onSnapshot } from "firebase/firestore";
import { clsx } from "clsx";
import { db } from "@/services/firebase";
import { TradingSignalDoc, SignalVote } from "@/types";
import { Skeleton } from "@/components/Skeleton";
import { PositionRiskCalculator } from "@/components/PositionRiskCalculator";
import { TradingViewChart } from "@/components/TradingViewChart";
import { SignalOutcomeBadge } from "@/components/SignalOutcomeBadge";
import { useSignalSetupStats } from "@/hooks/useSignalStats";

export default function SignalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [signal, setSignal] = useState<TradingSignalDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const ref = doc(db, "trading_signals", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setSignal({ id: snap.id, ...(snap.data() as any) });
          setNotFound(false);
        } else {
          setNotFound(true);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !signal) {
    return (
      <div className="card p-12 text-center">
        <p className="text-slate-300">Señal no encontrada</p>
        <p className="mt-1 text-xs text-slate-500">
          Es posible que haya expirado o sido eliminada.
        </p>
        <Link to="/" className="btn-ghost mt-4 inline-flex">
          ← Volver al dashboard
        </Link>
      </div>
    );
  }

  const isLong = signal.direction === "LONG";
  const dirEmoji = isLong ? "🟢" : "🔴";

  const created =
    typeof signal.created_at === "string"
      ? new Date(signal.created_at)
      : new Date(signal.created_at.seconds * 1000);

  const longVotes = signal.votes.filter((v) => v.vote === "LONG");
  const shortVotes = signal.votes.filter((v) => v.vote === "SHORT");
  const neutralVotes = signal.votes.filter((v) => v.vote === "NEUTRAL");

  const { stats: setupStats, winrate } = useSignalSetupStats(signal.signal_type);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/" className="text-xs text-slate-500 hover:text-slate-300">
          ← Volver al dashboard
        </Link>
      </div>

      {/* Header */}
      <header className={clsx(
        "card p-6 border",
        isLong ? "border-emerald-500/25" : "border-rose-500/25"
      )}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Señal de Trading · {format(created, "PPpp")}
            </p>
            <h1 className="mt-1 text-3xl font-bold">
              {dirEmoji} {signal.direction}{" "}
              <span className="text-slate-400">{signal.symbol}</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">{signal.name} · {signal.signal_type}</p>
          </div>
          <div className={clsx(
            "rounded-xl px-4 py-3 text-center",
            isLong ? "bg-emerald-500/10" : "bg-rose-500/10"
          )}>
            <p className={clsx(
              "text-3xl font-bold",
              isLong ? "text-emerald-300" : "text-rose-300"
            )}>
              {signal.leverage}x
            </p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">
              Apalancamiento
            </p>
          </div>
        </div>

        {/* Confluence bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Confluencia de indicadores</span>
            <span className="font-semibold text-slate-300">
              {signal.confluence_score}/{signal.confluence_total} votos alineados
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                isLong ? "bg-emerald-500" : "bg-rose-500"
              )}
              style={{
                width: `${signal.confluence_total > 0
                  ? (signal.confluence_score / signal.confluence_total) * 100
                  : 0}%`,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Confianza: {(signal.confidence * 100).toFixed(0)}%
          </p>
        </div>
      </header>

      {/* Interactive Candlestick Chart Section */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-200 flex items-center gap-2">
            <span>📊</span> Gráfico en Tiempo Real (Binance Futures)
          </h2>
          <span className="text-xs text-slate-400 font-mono">Pau/Velas 1 hora</span>
        </div>
        <TradingViewChart symbol={signal.symbol} height={420} interval="60" />
      </section>

      {/* Risk Management Panel */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Gestión de Riesgo & Niveles
          </h2>
          <button
            onClick={() => setShowCalculator(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
          >
            🧮 Abrir Calculadora de Riesgo
          </button>
        </div>
        <PriceLevel signal={signal} />
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <RiskRow label="Precio de entrada" value={formatPrice(signal.entry_price)} />
          <RiskRow
            label="Stop-Loss"
            value={`${formatPrice(signal.stop_loss)} (-${signal.sl_pct.toFixed(2)}%)`}
            tone="text-rose-400"
          />
          <RiskRow
            label="Take-Profit 1 (50%)"
            value={`${formatPrice(signal.take_profit_1)} (+${signal.tp1_pct.toFixed(2)}%)`}
            tone="text-emerald-400"
          />
          <RiskRow
            label="Take-Profit 2 (100%)"
            value={`${formatPrice(signal.take_profit_2)} (+${signal.tp2_pct.toFixed(2)}%)`}
            tone="text-emerald-300"
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-4">
          <RiskRow label="Risk/Reward" value={`1:${signal.risk_reward.toFixed(2)}`} />
          <RiskRow label="ATR (14, 1h)" value={formatPrice(signal.atr)} />
          <RiskRow
            label="Funding Rate"
            value={`${(signal.funding_rate * 100).toFixed(4)}%`}
            tone={signal.funding_rate < 0 ? "text-emerald-400" : "text-rose-400"}
          />
        </div>
      </section>

      {/* Signal outcome (filled by scoreOutcomeJob) */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Resultado de la señal
          </h2>
          <SignalOutcomeBadge outcome={signal.outcome} />
        </div>

        {signal.outcome?.result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <RiskRow
                label="Nivel alcanzado"
                value={signal.outcome.hit_level || "Ninguno"}
              />
              <RiskRow
                label="Beneficio 1h"
                value={boolLabel(signal.outcome.profitable_1h)}
                tone={toneFor(signal.outcome.profitable_1h)}
              />
              <RiskRow
                label="Beneficio 4h"
                value={boolLabel(signal.outcome.profitable_4h)}
                tone={toneFor(signal.outcome.profitable_4h)}
              />
              <RiskRow
                label="Precio a 1h"
                value={
                  signal.outcome.price_1h
                    ? formatPrice(signal.outcome.price_1h)
                    : "—"
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <RiskRow
                label="Máx. favorable"
                value={`${signal.outcome.max_favorable_excursion_pct?.toFixed(2) ?? "—"}%`}
                tone="text-emerald-400"
              />
              <RiskRow
                label="Máx. adverso"
                value={`${signal.outcome.max_adverse_excursion_pct?.toFixed(2) ?? "—"}%`}
                tone="text-rose-400"
              />
              <RiskRow
                label="Evaluado"
                value={formatTimeShort(signal.outcome.checked_at)}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Aún no evaluada. El job de outcomes la puntuará en ~1h (WIN si
            alcanza TP1 antes que SL).
          </p>
        )}

        {/* Win-rate histórico del setup */}
        <div className="border-t border-white/5 pt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Win-rate histórico del setup{" "}
              <span className="font-mono text-slate-300">{signal.signal_type}</span>
            </span>
            {setupStats && (
              <span className="font-mono font-semibold text-slate-200">
                {winrate !== null ? `${(winrate * 100).toFixed(0)}%` : "—"} ·{" "}
                {setupStats.wins}W/{setupStats.losses}L
              </span>
            )}
          </div>
          {setupStats && winrate !== null && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={clsx(
                  "h-full rounded-full transition-all",
                  winrate >= 0.5 ? "bg-emerald-500" : "bg-rose-500"
                )}
                style={{ width: `${Math.min(100, winrate * 100)}%` }}
              />
            </div>
          )}
          {!setupStats && (
            <p className="mt-2 text-xs text-slate-600">
              Sin historial todavía — necesitamos ≥1 outcome evaluado.
            </p>
          )}
        </div>
      </section>

      {/* Pre-Trade Checklist */}
      <section className="card border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300 flex items-center gap-2">
          <span>📋</span> Checklist Pre-Trade (Antes de enviar la orden)
        </h2>
        <div className="space-y-2 text-xs text-slate-300">
          <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
            <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
            <span>Confirmar que la vela del marco temporal principal (15m o 1h) ha cerrado.</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
            <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
            <span>Configurar el tipo de margen como <strong>Aislado (Isolated)</strong> en el exchange.</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
            <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
            <span>Calcular y no arriesgar más del 2% de la cuenta en esta operación.</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
            <input type="checkbox" className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
            <span>Ingresar las órdenes de Stop Loss (${formatPrice(signal.stop_loss)}) y Take Profit (${formatPrice(signal.take_profit_1)}) junto con la orden de entrada.</span>
          </label>
        </div>
      </section>

      {/* Timeframe bias */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Sesgo por Timeframe
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <BiasCard label="15 minutos" bias={signal.bias_15m} />
          <BiasCard label="1 hora" bias={signal.bias_1h} />
          <BiasCard label="4 horas" bias={signal.bias_4h} />
        </div>
      </section>

      {/* Indicators breakdown */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-1">
          Desglose de Indicadores
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          {longVotes.length} LONG · {shortVotes.length} SHORT · {neutralVotes.length} NEUTRAL
        </p>
        <div className="space-y-3">
          {signal.votes.map((vote) => (
            <VoteRow key={vote.name} vote={vote} />
          ))}
        </div>
      </section>

      {/* Strategy guide */}
      <section className={clsx(
        "card border p-5",
        isLong ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5"
      )}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Plan de Ejecución
        </h2>
        <ol className="space-y-2 text-sm text-slate-300">
          <li>
            <span className="font-semibold">1. Entra</span> en{" "}
            <span className={isLong ? "text-emerald-300" : "text-rose-300"}>
              {signal.direction}
            </span>{" "}
            a precio de mercado ~{formatPrice(signal.entry_price)} con apalancamiento{" "}
            <strong>{signal.leverage}x</strong>.
          </li>
          <li>
            <span className="font-semibold">2. Coloca el SL</span> inmediatamente en{" "}
            <span className="text-rose-300">{formatPrice(signal.stop_loss)}</span>{" "}
            ({signal.sl_pct.toFixed(2)}% de pérdida máxima).
          </li>
          <li>
            <span className="font-semibold">3. TP1</span> en{" "}
            <span className="text-emerald-400">{formatPrice(signal.take_profit_1)}</span>{" "}
            — cierra el 50% de la posición (+{signal.tp1_pct.toFixed(2)}%).
          </li>
          <li>
            <span className="font-semibold">4. TP2</span> en{" "}
            <span className="text-emerald-300">{formatPrice(signal.take_profit_2)}</span>{" "}
            — cierra el 100% restante (+{signal.tp2_pct.toFixed(2)}%).
          </li>
          <li className="text-slate-500 text-xs">
            Si el precio cierra un candle de 1h en sentido contrario a la señal antes de TP1, considera cerrar manualmente.
          </li>
        </ol>
      </section>

      <PositionRiskCalculator
        signal={signal}
        isOpen={showCalculator}
        onClose={() => setShowCalculator(false)}
      />
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------

function formatPrice(p: number) {
  if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${p.toFixed(6)}`;
}

function boolLabel(v?: boolean | null) {
  if (v === null || v === undefined) return "—";
  return v ? "Sí" : "No";
}

function toneFor(v?: boolean | null) {
  if (v === null || v === undefined) return undefined;
  return v ? "text-emerald-400" : "text-rose-400";
}

function formatTimeShort(ts?: string | { seconds: number; nanoseconds: number } | null) {
  if (!ts) return "—";
  const date =
    typeof ts === "string" ? new Date(ts) : new Date(ts.seconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm dd/MM");
}

function RiskRow({
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

function VoteRow({ vote }: { vote: SignalVote }) {
  const badgeColor =
    vote.vote === "LONG"
      ? "bg-emerald-500/10 text-emerald-300"
      : vote.vote === "SHORT"
      ? "bg-rose-500/10 text-rose-300"
      : "bg-white/5 text-slate-400";
  const voteIcon =
    vote.vote === "LONG" ? "↑" : vote.vote === "SHORT" ? "↓" : "—";

  return (
    <div className="flex items-start gap-3 rounded-lg bg-white/[0.02] p-3">
      <div className={clsx("mt-0.5 flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-bold", badgeColor)}>
        {voteIcon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-200">{vote.name}</span>
          <span className="text-xs text-slate-500">×{vote.weight}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">{vote.explanation}</p>
      </div>
    </div>
  );
}

function BiasCard({ label, bias }: { label: string; bias: string }) {
  const isLong = bias.includes("LONG");
  const color = isLong
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-rose-500/30 bg-rose-500/10 text-rose-300";
  return (
    <div className={clsx("rounded-xl border p-3 text-center transition-all", color)}>
      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-sm font-black font-mono tracking-tight">{bias}</p>
    </div>
  );
}

function PriceLevel({ signal }: { signal: TradingSignalDoc }) {
  const isLong = signal.direction === "LONG";

  // Build a mini visual level chart using SVG
  const entry = signal.entry_price;
  const sl = signal.stop_loss;
  const tp1 = signal.take_profit_1;
  const tp2 = signal.take_profit_2;

  const allPrices = [sl, entry, tp1, tp2];
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;

  const pct = (price: number) =>
    isLong
      ? (1 - (price - minP) / range) * 100
      : ((price - minP) / range) * 100;

  const levels = [
    { label: "TP2", price: tp2, color: "#22c55e", opacity: 0.8, dash: "4 2" },
    { label: "TP1", price: tp1, color: "#4ade80", opacity: 1, dash: "4 2" },
    { label: "ENTRADA", price: entry, color: "#94a3b8", opacity: 1, dash: "" },
    { label: "SL", price: sl, color: "#ef4444", opacity: 1, dash: "4 2" },
  ].sort((a, b) => (isLong ? b.price - a.price : a.price - b.price));

  return (
    <div className="mt-4 overflow-hidden rounded-lg bg-white/[0.02] p-4">
      <p className="mb-3 text-[10px] uppercase tracking-wide text-slate-500">
        Niveles de precio
      </p>
      <div className="relative" style={{ height: 120 }}>
        <svg width="100%" height="120" className="overflow-visible">
          {levels.map((level) => {
            const y = (pct(level.price) / 100) * 120;
            const isEntry = level.label === "ENTRADA";
            return (
              <g key={level.label}>
                <line
                  x1="40"
                  y1={y}
                  x2="100%"
                  y2={y}
                  stroke={level.color}
                  strokeWidth={isEntry ? 2 : 1}
                  strokeOpacity={level.opacity}
                  strokeDasharray={level.dash || "0"}
                />
                <text
                  x="0"
                  y={y + 4}
                  fill={level.color}
                  fontSize="9"
                  fontFamily="monospace"
                  fillOpacity={level.opacity}
                >
                  {level.label}
                </text>
                <text
                  x="100%"
                  y={y + 4}
                  textAnchor="end"
                  fill={level.color}
                  fontSize="9"
                  fontFamily="monospace"
                  fillOpacity={level.opacity}
                >
                  {formatPrice(level.price)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
