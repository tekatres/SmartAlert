import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect } from "react";
import { httpsCallable, getFunctions } from "firebase/functions";
import { db } from "@/services/firebase";
import { useAppStore } from "@/store/useAppStore";
import { AlertDoc } from "@/types";
import { Sparkline, Bars } from "@/components/Chart";
import { Skeleton } from "@/components/Skeleton";
import { ScoreBreakdownPanel } from "@/components/ScoreBreakdown";
import { useToast } from "@/components/Toaster";
import { buildPriceSeries, buildVolumeSeries } from "@/utils/chartSeries";

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [alert, setAlert] = useState<AlertDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const isPremium = useAppStore((s) => s.preferences?.plan === "premium" || s.preferences?.plan === "pro");
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const ref = doc(db, "alerts", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setAlert({ id: snap.id, ...(snap.data() as any) });
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

  const priceSeries = useMemo(() => {
    if (!alert) return [];
    return buildPriceSeries(alert.price_usd, alert.previous_price_usd, 24).map((p) => p.price);
  }, [alert]);

  const volumeSeries = useMemo(() => {
    if (!alert) return [];
    return buildVolumeSeries(alert.coin_id.length, 24);
  }, [alert]);

  async function sendFeedback(kind: "useful" | "not_useful" | "acted_on" | "false_positive") {
    if (!alert) return;
    try {
      const fn = httpsCallable(getFunctions(), "submitAlertFeedback");
      await fn({ alert_id: alert.id, kind });
      toast({ tone: "success", title: "Gracias por tu feedback" });
    } catch (e: any) {
      toast({ tone: "error", title: "No se pudo enviar", description: e?.message });
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !alert) {
    return (
      <div className="card p-12 text-center">
        <p className="text-slate-300">Alerta no encontrada</p>
        <p className="mt-1 text-xs text-slate-500">
          Es posible que haya expirado o sido eliminada.
        </p>
        <Link to="/" className="btn-ghost mt-4 inline-flex">
          ← Volver al dashboard
        </Link>
      </div>
    );
  }

  // Premium gate
  if (!isPremium && alert.min_tier === "premium") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-bg-surface p-8 text-center">
          <span className="text-4xl">✦</span>
          <h1 className="mt-3 text-2xl font-semibold">Alerta Premium</h1>
          <p className="mt-2 text-sm text-slate-300">
            {alert.premium_only_reason || "Setup avanzado con score alto."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Mejora a Premium para ver el detalle completo y recibir este tipo de
            alertas con entrega inmediata.
          </p>
          <Link to="/premium" className="btn-primary mt-6 inline-flex">
            Ver planes
          </Link>
        </div>
      </div>
    );
  }

  const created =
    typeof alert.created_at === "string"
      ? new Date(alert.created_at)
      : new Date(alert.created_at.seconds * 1000);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/" className="text-xs text-slate-500 hover:text-slate-300">
          ← Volver
        </Link>
      </div>

      <header className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{alert.type}</p>
            <h1 className="mt-1 text-2xl font-semibold">{alert.title}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {alert.name} ({alert.symbol}) · {format(created, "PPpp")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums">{alert.score}</p>
            <p className="text-[10px] text-slate-500">SCORE</p>
          </div>
        </div>
        <p className="mt-4 text-slate-300">{alert.summary}</p>
      </header>

      <ScoreBreakdownPanel
        breakdown={alert.score_breakdown ?? null}
        isPremium={isPremium}
      />

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Precio (5m, 24 velas)
        </h2>
        <div className="mt-4">
          <Sparkline
            values={priceSeries}
            height={140}
            stroke={alert.change_pct >= 0 ? "#22c55e" : "#ef4444"}
            fill={
              alert.change_pct >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"
            }
          />
        </div>
        <div className="mt-3 flex justify-between text-xs text-slate-500">
          <span>Hace ~2h</span>
          <span>Ahora</span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Volumen (24 velas)
        </h2>
        <div className="mt-4">
          <Bars values={volumeSeries} height={120} />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Análisis IA
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-200">{alert.explanation}</p>
        {alert.recommended_action && (
          <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">
              Acción sugerida
            </p>
            <p className="mt-1 text-sm text-brand-200">{alert.recommended_action}</p>
          </div>
        )}
      </section>

      {alert.outcome && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Resultado verificado
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Precio 1h después: <span className="font-mono">
              {alert.outcome.price_after_1h
                ? `$${alert.outcome.price_after_1h.toLocaleString()}`
                : "—"}
            </span>
          </p>
          {alert.outcome.profitable_1h === true && (
            <p className="mt-1 text-sm text-emerald-300">✓ El trade habría sido rentable.</p>
          )}
          {alert.outcome.profitable_1h === false && (
            <p className="mt-1 text-sm text-rose-300">× El trade habría sido perdedor.</p>
          )}
        </section>
      )}

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Datos del evento
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Row label="Precio actual" value={`$${alert.price_usd.toLocaleString()}`} />
          <Row label="Precio previo" value={`$${alert.previous_price_usd.toLocaleString()}`} />
          <Row
            label="Cambio"
            value={`${alert.change_pct >= 0 ? "+" : ""}${alert.change_pct.toFixed(2)}%`}
            tone={alert.change_pct >= 0 ? "text-emerald-400" : "text-rose-400"}
          />
          <Row label="Volumen 24h" value={`$${alert.volume_24h_usd.toLocaleString()}`} />
          <Row label="Vol ratio" value={`${alert.volume_ratio.toFixed(2)}x`} />
          <Row label="Severidad" value={alert.severity} />
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          ¿Te resultó útil?
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Tu feedback entrena el modelo y mejora la precisión del score.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => sendFeedback("useful")} className="btn-ghost text-xs">
            👍 Útil
          </button>
          <button onClick={() => sendFeedback("not_useful")} className="btn-ghost text-xs">
            👎 No útil
          </button>
          <button onClick={() => sendFeedback("acted_on")} className="btn-ghost text-xs">
            ⚡ Operé con ella
          </button>
          <button onClick={() => sendFeedback("false_positive")} className="btn-ghost text-xs">
            ⚠ Falsa alarma
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({
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
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-sm ${tone || "text-slate-100"}`}>{value}</dd>
    </div>
  );
}
