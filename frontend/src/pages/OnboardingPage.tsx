import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/Toaster";
import { savePreferences } from "@/services/alerts";
import { UserPreferences, AlertType } from "@/types";
import { clsx } from "clsx";

const POPULAR_COINS = [
  { id: "bitcoin",       symbol: "BTC",  name: "Bitcoin",   note: "USDT · USDC" },
  { id: "ethereum",      symbol: "ETH",  name: "Ethereum",  note: "USDT" },
  { id: "solana",        symbol: "SOL",  name: "Solana",    note: "USDT" },
  { id: "binancecoin",   symbol: "BNB",  name: "BNB",       note: "USDT" },
  { id: "ripple",        symbol: "XRP",  name: "XRP",       note: "USDT" },
  { id: "cardano",       symbol: "ADA",  name: "Cardano",   note: "USDT" },
  { id: "dogecoin",      symbol: "DOGE", name: "Dogecoin",  note: "USDT" },
  { id: "polkadot",      symbol: "DOT",  name: "Polkadot",  note: "USDT" },
  { id: "matic-network", symbol: "POL",  name: "Polygon",   note: "USDT" },
  { id: "avalanche-2",   symbol: "AVAX", name: "Avalanche", note: "USDT" },
  { id: "chainlink",     symbol: "LINK", name: "Chainlink", note: "USDT" },
  { id: "pepe",          symbol: "PEPE", name: "Pepe",      note: "USDT" },
];

const TYPE_LABEL: Record<AlertType, string> = {
  price_surge: "Subidas",
  price_dump: "Caídas",
  volume_spike: "Volumen",
  breakout: "Breakouts",
};

const ALL_TYPES: AlertType[] = ["price_surge", "price_dump", "volume_spike", "breakout"];

export default function OnboardingPage() {
  const { user, preferences } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [coins, setCoins] = useState<string[]>([]);
  const [types, setTypes] = useState<AlertType[]>([...ALL_TYPES]);
  const [sensitivity, setSensitivity] = useState<"low" | "medium" | "high">("medium");
  const [pushOptIn, setPushOptIn] = useState(false);

  if (!user) return null;

  function toggleCoin(id: string) {
    setCoins((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }
  function toggleType(t: AlertType) {
    setTypes((arr) => (arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]));
  }

  async function finish() {
    if (!user) return;
    setBusy(true);
    try {
      const prefs: UserPreferences = {
        sensitivity,
        enabled_types: types.length ? types : [...ALL_TYPES],
        min_score: 0,
        muted_coins: POPULAR_COINS.map((c) => c.id).filter((id) => !coins.includes(id)),
        plan: preferences?.plan ?? "free",
      };
      // Write directly to Firestore — no Cloud Function needed
      await savePreferences(user.uid, prefs);
      toast({ tone: "success", title: "¡Listo!", description: "Tu cuenta está configurada." });
      navigate("/", { replace: true });
    } catch (e: any) {
      toast({ tone: "error", title: "No se pudo guardar", description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      title: "Elige tus activos",
      description: "Recibirás alertas sólo de los coins que selecciones.",
      content: (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {POPULAR_COINS.map((c) => {
            const on = coins.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCoin(c.id)}
                className={clsx(
                  "rounded-lg border px-3 py-3 text-sm font-medium transition-colors",
                  on
                    ? "border-brand-500 bg-brand-500/10 text-brand-300"
                    : "border-white/10 text-slate-300 hover:bg-white/5"
                )}
              >
                <div className="text-base font-semibold">{c.symbol}</div>
                <div className="text-xs opacity-70">{c.name}</div>
                {"note" in c && (
                  <div className="mt-0.5 text-[10px] opacity-40">{c.note}</div>
                )}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "¿Qué eventos te interesan?",
      description: "Puedes cambiar esto más tarde desde Ajustes.",
      content: (
        <div className="grid grid-cols-2 gap-2">
          {ALL_TYPES.map((t) => {
            const on = types.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={clsx(
                  "rounded-lg border px-3 py-3 text-sm font-medium transition-colors",
                  on
                    ? "border-brand-500 bg-brand-500/10 text-brand-300"
                    : "border-white/10 text-slate-300 hover:bg-white/5"
                )}
              >
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Sensibilidad",
      description: "Más alta = más alertas, más baja = sólo movimientos fuertes.",
      content: (
        <div className="grid grid-cols-3 gap-2">
          {(["low", "medium", "high"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSensitivity(s)}
              className={clsx(
                "rounded-lg border px-3 py-4 text-sm font-medium transition-colors",
                sensitivity === s
                  ? "border-brand-500 bg-brand-500/10 text-brand-300"
                  : "border-white/10 text-slate-300 hover:bg-white/5"
              )}
            >
              {s === "low" ? "Baja" : s === "medium" ? "Media" : "Alta"}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Notificaciones push",
      description: "Recomendado para no perderte ninguna oportunidad.",
      content: (
        <div className="space-y-3">
          <button
            onClick={() => setPushOptIn(!pushOptIn)}
            className={clsx(
              "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors",
              pushOptIn
                ? "border-brand-500 bg-brand-500/10 text-brand-300"
                : "border-white/10 text-slate-300 hover:bg-white/5"
            )}
          >
            <span className="text-sm font-medium">
              {pushOptIn ? "Activadas" : "Activar"}
            </span>
            <span
              className={clsx(
                "flex h-6 w-10 items-center rounded-full p-0.5 transition-colors",
                pushOptIn ? "bg-brand-500" : "bg-white/10"
              )}
            >
              <span
                className={clsx(
                  "h-5 w-5 rounded-full bg-white transition-transform",
                  pushOptIn ? "translate-x-4" : "translate-x-0"
                )}
              />
            </span>
          </button>
          <p className="text-xs text-slate-500">
            Podrás activarlas o desactivarlas en cualquier momento desde el header.
          </p>
        </div>
      ),
    },
  ];

  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  return (
    <div className="mx-auto max-w-xl py-8">
      <div className="mb-6">
        <div className="flex gap-1.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={clsx(
                "h-1 flex-1 rounded-full transition-colors",
                i <= step ? "bg-brand-500" : "bg-white/10"
              )}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Paso {step + 1} de {steps.length}
        </p>
      </div>

      <div className="card p-6">
        <h2 className="text-xl font-semibold">{steps[step].title}</h2>
        <p className="mt-1 text-sm text-slate-400">{steps[step].description}</p>
        <div className="mt-6">{steps[step].content}</div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => (isFirst ? navigate("/") : setStep(step - 1))}
          className="btn-ghost"
        >
          {isFirst ? "Saltar" : "Atrás"}
        </button>
        <button
          onClick={() => (isLast ? finish() : setStep(step + 1))}
          disabled={busy}
          className="btn-primary disabled:opacity-60"
        >
          {busy ? "Guardando…" : isLast ? "Empezar" : "Siguiente"}
        </button>
      </div>
    </div>
  );
}
