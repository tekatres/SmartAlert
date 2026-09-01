import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/Toaster";
import { useTrackCta } from "@/hooks/useConversionStats";
import { createCheckoutSessionFn } from "@/services/alerts";
import { clsx } from "clsx";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    features: [
      "Top 8 criptomonedas",
      "Score multi-factor (sin desglose)",
      "Alertas con 3 min de delay",
      "Feedback en alertas",
    ],
    cta: "Tu plan actual",
  },
  {
    id: "premium",
    name: "Premium",
    price: 9,
    featured: true,
    features: [
      "Desglose completo de los 6 factores del score",
      "Entrega inmediata (sin delay)",
      "Top scores desbloqueados (≥80)",
      "Setups avanzados (breakouts)",
      "Top 50 criptomonedas",
      "Soporte prioritario",
    ],
    cta: "Mejorar a Premium",
  },
  {
    id: "pro",
    name: "Pro",
    price: 29,
    features: [
      "Todo lo de Premium",
      "Activos custom",
      "Backtesting de estrategias",
      "Webhooks + API access",
      "Onboarding 1-a-1",
    ],
    cta: "Próximamente",
  },
];

export default function PremiumPage() {
  const { user, preferences } = useAuth();
  const toast = useToast();
  const track = useTrackCta();
  const [busy, setBusy] = useState<string | null>(null);
  const current = preferences?.plan ?? "free";

  async function checkout() {
    if (!user) return;
    setBusy("premium");
    track("click", "premium_page", { plan: "premium" });
    try {
      const { data } = await createCheckoutSessionFn({});
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast({ tone: "error", title: "No se pudo crear la sesión" });
      }
    } catch (e: any) {
      toast({
        tone: "error",
        title: "Error al iniciar el pago",
        description: e?.message ?? "Inténtalo de nuevo",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">
          Pricing
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Elige tu plan</h1>
        <p className="mt-2 text-sm text-slate-400">
          Empieza gratis. Mejora cuando quieras. Cancela en un click.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = current === p.id;
          return (
            <div
              key={p.id}
              className={clsx(
                "card relative flex flex-col p-6",
                p.featured && "border-brand-500/50 shadow-glow"
              )}
            >
              {p.featured && (
                <span className="absolute -top-3 right-6 rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 px-3 py-0.5 text-[10px] font-semibold text-bg-base">
                  RECOMENDADO
                </span>
              )}
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-semibold">€{p.price}</span>
                {p.price > 0 && <span className="text-sm text-slate-500">/ mes</span>}
              </div>
              <ul className="mt-5 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    <span className="text-slate-300">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex-1" />
              <button
                onClick={p.id === "premium" ? checkout : undefined}
                disabled={p.id === "pro" || isCurrent || busy === p.id}
                className={clsx(
                  p.featured ? "btn-primary" : "btn-ghost border border-white/10",
                  "w-full",
                  (isCurrent || p.id === "pro" || busy === p.id) && "opacity-60"
                )}
              >
                {busy === p.id ? "Procesando…" : isCurrent ? "Plan activo" : p.cta}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card p-5 text-center text-xs text-slate-500">
        <p>Pagos procesados por Stripe. Cancela cuando quieras desde tu cuenta.</p>
        <p className="mt-1">
          ¿Necesitas factura? Escríbenos a{" "}
          <a className="text-brand-400" href="mailto:billing@smartalerts.ai">
            billing@smartalerts.ai
          </a>
        </p>
      </div>
    </div>
  );
}
