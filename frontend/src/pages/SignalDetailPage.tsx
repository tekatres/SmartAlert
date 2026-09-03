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
import { SignalDecisionGuide } from "@/components/SignalDecisionGuide";
import { ExecutiveSummaryCard } from "@/components/ExecutiveSummaryCard";
import { fetchMarketSentiment } from "@/services/marketSentiment";
import { useSignalSetupStats } from "@/hooks/useSignalStats";

export default function SignalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [signal, setSignal] = useState<TradingSignalDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [sentimentValue, setSentimentValue] = useState<number>(50);

  const { stats: setupStats, winrate } = useSignalSetupStats(signal?.signal_type || "");

  useEffect(() => {
    fetchMarketSentiment().then((s) => setSentimentValue(s.fearAndGreedValue));
  }, []);

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/" className="text-xs text-slate-500 hover:text-slate-300">
          ← Volver al dashboard
        </Link>
      </div>

      {/* EXECUTIVE SUMMARY AT VERY TOP */}
      <ExecutiveSummaryCard signal={signal} />

      {/* Header */}
      <header className={clsx(
        "card p-4 sm:p-6 border",
        isLong ? "border-emerald-500/25" : "border-rose-500/25"
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Señal de Trading · {format(created, "PPpp")}
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold break-words">
              {dirEmoji} {signal.direction}{" "}
              <span className="text-slate-400">{signal.symbol}</span>
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-400">{signal.name} · {signal.signal_type}</p>
          </div>
          <div className={clsx(
            "rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-center shrink-0",
            isLong ? "bg-emerald-500/10" : "bg-rose-500/10"
          )}>
            <p className={clsx(
              "text-2xl sm:text-3xl font-bold",
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

      {/* ── DECISION GUIDE ── */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <span className="text-lg">🧠</span>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-100">
              Guía de Decisión — ¿Entro o No?
            </h2>
            <p className="text-xs text-slate-400">
              Análisis automático de 5 condiciones para ayudarte a decidir si entrar, cuándo salir y con qué temporalidad.
            </p>
          </div>
        </div>
        <SignalDecisionGuide signal={signal} sentimentValue={sentimentValue} />
      </section>

      {/* Interactive Candlestick Chart Section */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-200 flex items-center gap-2">
            <span>📊</span> Gráfico en Tiempo Real (Binance Futures)
          </h2>
          <span className="text-xs text-slate-400 font-mono">Pau/Velas 1 hora</span>
        </div>
        <TradingViewChart symbol={signal.symbol} height={300} interval="60" />
      </section>

      {/* Risk Management Panel */}
      <section className="card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Gestión de Riesgo &amp; Niveles
          </h2>
          <button
            onClick={() => setShowCalculator(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-colors self-start sm:self-auto"
          >
            🧮 Calculadora de Riesgo
          </button>
        </div>
        <PriceLevel signal={signal} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <RiskRow label="Precio de entrada" value={formatPrice(signal.entry_price ?? 0)} />
          <RiskRow
            label="Stop-Loss"
            value={`${formatPrice(signal.stop_loss ?? 0)} (-${(signal.sl_pct ?? 0).toFixed(2)}%)`}
            tone="text-rose-400"
          />
          <RiskRow
            label="Take-Profit 1 (50%)"
            value={`${formatPrice(signal.take_profit_1 ?? 0)} (+${(signal.tp1_pct ?? 0).toFixed(2)}%)`}
            tone="text-emerald-400"
          />
          <RiskRow
            label="Take-Profit 2 (100%)"
            value={`${formatPrice(signal.take_profit_2 ?? 0)} (+${(signal.tp2_pct ?? 0).toFixed(2)}%)`}
            tone="text-emerald-300"
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-4">
          <RiskRow label="Risk/Reward" value={`1:${(signal.risk_reward ?? 0).toFixed(2)}`} />
          <RiskRow label="ATR (14, 1h)" value={formatPrice(signal.atr ?? 0)} />
          <RiskRow
            label="Funding Rate"
            value={`${((signal.funding_rate ?? 0) * 100).toFixed(4)}%`}
            tone={(signal.funding_rate ?? 0) < 0 ? "text-emerald-400" : "text-rose-400"}
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
          Sesgo por Timeframe (Haz clic en un timeframe para ver parámetros específicos)
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <BiasCard label="15 minutos" bias={signal.bias_15m} signal={signal} />
          <BiasCard label="1 hora" bias={signal.bias_1h} signal={signal} />
          <BiasCard label="4 horas" bias={signal.bias_4h} signal={signal} />
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

      {/* Professional Broker Execution & Risk Protocol */}
      <section className={clsx(
        "card border p-6 space-y-4 shadow-xl",
        isLong ? "border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 via-slate-900/60 to-slate-950" : "border-rose-500/30 bg-gradient-to-b from-rose-500/10 via-slate-900/60 to-slate-950"
      )}>
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">
                Protocolo Institucional de Ejecución (Estilo Broker Pro)
              </h2>
              <p className="text-[11px] text-slate-400">
                Reglas inquebrantables de gestión monetaria para proteger capital y maximizar expectativa matemática positiva.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-slate-800 border border-slate-700 px-3 py-1 font-mono text-[10px] font-bold text-amber-300">
            Regla del 1-2% Capital Máx.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/80 p-3.5 border border-slate-800/80 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
              <span>📍</span> 1. Entrada & Dimensionamiento de Posición
            </span>
            <p className="text-slate-300 leading-relaxed">
              Entrada en <strong className={isLong ? "text-emerald-300" : "text-rose-300"}>{signal.direction}</strong> a precio ~<strong>{formatPrice(signal.entry_price ?? 0)}</strong>.
              Calcula el tamaño para que la pérdida máxima al SL nunca exceda el <strong>1% al 2%</strong> del balance total de tu cuenta. Apalancamiento sugerido: <strong className="text-amber-300 font-mono">{signal.leverage || 5}x</strong> en modo <strong>Aislado</strong>.
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/80 p-3.5 border border-slate-800/80 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
              <span>🛑</span> 2. Stop Loss Estricto (Innegociable)
            </span>
            <p className="text-slate-300 leading-relaxed">
              SL colocado inmediatamente en <strong className="font-mono text-rose-400">{formatPrice(signal.stop_loss ?? 0)}</strong> (-{(signal.sl_pct ?? 0).toFixed(2)}%).
              Los brokers profesionales <strong>jamás promedian a la baja</strong> ni amplían el SL cuando el precio se acerca. Si el mercado invalida la tesis, se asume la pérdida calculada sin emociones.
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/80 p-3.5 border border-slate-800/80 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1">
              <span>🎯</span> 3. Toma de Beneficio Parcial (TP1) & Riesgo Cero
            </span>
            <p className="text-slate-300 leading-relaxed">
              Al alcanzar <strong className="font-mono text-emerald-400">{formatPrice(signal.take_profit_1 ?? 0)}</strong> (+{(signal.tp1_pct ?? 0).toFixed(2)}%), <strong>cierra el 50%</strong> del volumen.
              Inmediatamente <strong>mueve el Stop Loss al precio de entrada (Breakeven)</strong>. A partir de este momento, la operación es matemáticamente imposible de perder.
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/80 p-3.5 border border-slate-800/80 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1">
              <span>🚀</span> 4. Runner Final (TP2) o Trailing Stop
            </span>
            <p className="text-slate-300 leading-relaxed">
              Deja correr el 50% restante hasta <strong className="font-mono text-emerald-300">{formatPrice(signal.take_profit_2 ?? 0)}</strong> (+{(signal.tp2_pct ?? 0).toFixed(2)}%) o activa un <strong>Trailing Stop</strong> siguiendo la EMA21 de 15m para exprimir tendencias parabólicas.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-[11px] text-amber-300 flex items-start gap-2">
          <span className="text-base">⚠️</span>
          <p>
            <strong>Criterio de Salida por Invalidación Temporal:</strong> Si tras 6-8 horas de haber entrado el activo no ha alcanzado TP1 y cierra una vela de 1h en sentido contrario con volumen, los traders cuantitativos cierran manualmente para liberar liquidez y no pagar tasas de financiamiento innecesarias.
          </p>
        </div>
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

function BiasCard({ label, bias, signal }: { label: string; bias: string; signal: TradingSignalDoc }) {
  const [showModal, setShowModal] = useState(false);
  const isLong = bias.includes("LONG");
  const color = isLong
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
    : "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20";

  const is15m = label.includes("15");
  const is1h = label.includes("1 hora");

  const slFactor = is15m ? 0.6 : is1h ? 1.0 : 1.5;
  const calculatedSlPct = Math.max(0.8, signal.sl_pct * slFactor);
  const calculatedTp1Pct = calculatedSlPct * 1.8;
  const calculatedTp2Pct = calculatedSlPct * 3.2;

  const maxRiskEur = 4;
  const positionSizeEur = maxRiskEur / (calculatedSlPct / 100);
  const leverage = Math.min(10, signal.leverage);
  const marginEur = positionSizeEur / leverage;

  const entry = signal.entry_price;
  const slPrice = isLong ? entry * (1 - calculatedSlPct / 100) : entry * (1 + calculatedSlPct / 100);
  const tp1Price = isLong ? entry * (1 + calculatedTp1Pct / 100) : entry * (1 - calculatedTp1Pct / 100);
  const tp2Price = isLong ? entry * (1 + calculatedTp2Pct / 100) : entry * (1 - calculatedTp2Pct / 100);

  const createdDate =
    typeof signal.created_at === "string"
      ? new Date(signal.created_at)
      : new Date(signal.created_at.seconds * 1000 + (signal.created_at.nanoseconds || 0) / 1e6);
  const validCreated = !Number.isNaN(createdDate.getTime()) ? createdDate : new Date();

  const durationMinutes = is15m ? 25 : is1h ? 120 : 480;
  const maxExitMinutes = is15m ? 45 : is1h ? 240 : 1440;

  const targetExitTime = new Date(validCreated.getTime() + durationMinutes * 60 * 1000);
  const maxExitTime = new Date(validCreated.getTime() + maxExitMinutes * 60 * 1000);

  const formatClock = (d: Date) =>
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={clsx("rounded-xl border p-3 text-center transition-all cursor-pointer shadow-sm group w-full", color)}
      >
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-center gap-1">
          <span>{label}</span>
          <span className="opacity-50 group-hover:opacity-100">🔍</span>
        </p>
        <p className="mt-1 text-sm font-black font-mono tracking-tight">{bias}</p>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="card w-full max-w-md border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4 rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏱️</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Plan Operativo &amp; Horario ({label} - {signal.symbol})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Sesgo: <strong className={isLong ? "text-emerald-400" : "text-rose-400"}>{bias}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {/* EXACT HORARY EXIT CARD */}
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs space-y-2 shadow-md">
              <div className="font-bold text-amber-300 flex items-center justify-between border-b border-amber-500/20 pb-1.5">
                <span>⚡ CRONOGRAMA DE OPERACIÓN:</span>
                <span className="text-[10px] font-mono bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-200">
                  Entrada AHORA → Cierre en {durationMinutes} min
                </span>
              </div>

              <div className="flex justify-between items-center bg-slate-950/90 px-3 py-1.5 rounded border border-emerald-500/30 font-mono text-[11px]">
                <span className="text-emerald-400 font-sans font-bold">🟢 HORA DE ENTRADA (ABRIR AHORA):</span>
                <span className="text-slate-100 font-bold">{formatClock(validCreated)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[9px] font-sans uppercase font-bold">🎯 Hora Salida TP1 (Estimada)</span>
                  <span className="text-emerald-300 font-bold text-xs">{formatClock(targetExitTime)}</span>
                  <span className="text-[9px] text-slate-400 block font-sans">(~{durationMinutes} min tras entrar)</span>
                </div>

                <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[9px] font-sans uppercase font-bold">🛑 Hora Salida Máx. (Incondicional)</span>
                  <span className="text-rose-400 font-bold text-xs">{formatClock(maxExitTime)}</span>
                  <span className="text-[9px] text-slate-400 block font-sans">(Cierra si no tocó TP1)</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-300 space-y-1">
              <div className="font-bold">Euro Orden (Cuenta de 200 €):</div>
              <p className="text-sm font-mono font-black text-emerald-200">
                Gastas: ~${marginEur.toFixed(2)} USDT de margen ({leverage}x)
              </p>
              <p className="text-[10px] text-slate-400">
                Posición Total: ${positionSizeEur.toFixed(2)} USDT · Riesgo máximo: -$4.00 USDT (2%)
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-slate-800">
                <span className="text-slate-400 font-bold">Precio de Entrada:</span>
                <span className="font-mono font-bold text-slate-100">${entry.toFixed(4)}</span>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-rose-500/20">
                <span className="text-rose-400 font-bold">Stop Loss ({calculatedSlPct.toFixed(1)}%):</span>
                <span className="font-mono font-bold text-rose-400">${slPrice.toFixed(4)}</span>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-emerald-500/20">
                <span className="text-emerald-400 font-bold">Take Profit 1 (50%):</span>
                <span className="font-mono font-bold text-emerald-400">${tp1Price.toFixed(4)} (+${(marginEur * (calculatedTp1Pct / 100) * leverage * 0.5).toFixed(2)})</span>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-slate-950 p-2 border border-emerald-500/20">
                <span className="text-emerald-300 font-bold">Take Profit 2 (100%):</span>
                <span className="font-mono font-bold text-emerald-300">${tp2Price.toFixed(4)} (+${(marginEur * (calculatedTp2Pct / 100) * leverage).toFixed(2)})</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              💡 <strong>Regla de Salida a las {formatClock(maxExitTime)}:</strong> {is15m ? `En scalping de 15m no te quedes atascado. A las ${formatClock(maxExitTime)} (máximo 45 min), si el mercado no ha llegado a TP1, cierra la operación manualmente a mercado.` : `En ${label}, si a las ${formatClock(maxExitTime)} no ha llegado a TP1, cierra para liberar el margen.`}
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="w-full rounded-xl bg-white/10 py-2 text-xs font-bold text-slate-200 hover:bg-white/20 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PriceLevel({ signal }: { signal: TradingSignalDoc }) {
  const isLong = signal.direction === "LONG";

  // Build a mini visual level chart using SVG with safe defaults
  const entry = signal.entry_price ?? 0;
  const sl = signal.stop_loss ?? 0;
  const tp1 = signal.take_profit_1 ?? 0;
  const tp2 = signal.take_profit_2 ?? 0;

  const allPrices = [sl, entry, tp1, tp2].filter((p) => p > 0);
  const minP = allPrices.length > 0 ? Math.min(...allPrices) : 1;
  const maxP = allPrices.length > 0 ? Math.max(...allPrices) : 2;
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
