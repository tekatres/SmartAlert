import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { savePreferences } from "@/services/alerts";
import {
  EngineThresholdConfig,
  ENGINE_PRESETS,
  saveEngineConfig,
} from "@/services/alerts";
import { useEngineConfig } from "@/hooks/useEngineConfig";
import { AlertType, UserPreferences } from "@/types";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useToast } from "@/components/Toaster";
import { Link } from "react-router-dom";
import { clsx } from "clsx";

const TYPE_LABEL: Record<AlertType, string> = {
  price_surge: "Subidas",
  price_dump: "Caídas",
  volume_spike: "Volumen",
  breakout: "Breakouts",
};

const ALL_TYPES: AlertType[] = ["price_surge", "price_dump", "volume_spike", "breakout"];

const POPULAR_COINS = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "binancecoin", symbol: "BNB" },
  { id: "ripple", symbol: "XRP" },
  { id: "cardano", symbol: "ADA" },
  { id: "dogecoin", symbol: "DOGE" },
  { id: "polkadot", symbol: "DOT" },
];

export default function SettingsPage() {
  const { user, preferences } = useAuth();
  const { enable } = usePushNotifications();
  const toast = useToast();
  const [draft, setDraft] = useState<UserPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const { config: engineCfg } = useEngineConfig();
  const [engineDraft, setEngineDraft] = useState<EngineThresholdConfig | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);

  useEffect(() => {
    if (preferences) setDraft(preferences);
  }, [preferences]);

  useEffect(() => {
    if (engineCfg) setEngineDraft(engineCfg);
  }, [engineCfg]);

  if (!user || !draft) {
    return <div className="text-slate-400">Cargando…</div>;
  }

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  }

  function toggleType(t: AlertType) {
    if (!draft) return;
    const has = draft.enabled_types.includes(t);
    update(
      "enabled_types",
      has ? draft.enabled_types.filter((x) => x !== t) : [...draft.enabled_types, t]
    );
  }

  function toggleMute(coinId: string) {
    if (!draft) return;
    const has = draft.muted_coins.includes(coinId);
    update(
      "muted_coins",
      has ? draft.muted_coins.filter((x) => x !== coinId) : [...draft.muted_coins, coinId]
    );
  }

  async function save() {
    if (!user || !draft) return;
    setBusy(true);
    try {
      await savePreferences(user.uid, draft);
      setSaved(true);
      toast({ tone: "success", title: "Ajustes guardados" });
    } catch (e: any) {
      toast({ tone: "error", title: "Error al guardar", description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  function updateEngine<K extends keyof EngineThresholdConfig>(key: K, value: number) {
    setEngineDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function saveEngine() {
    if (!engineDraft) return;
    setEngineBusy(true);
    try {
      await saveEngineConfig(engineDraft);
      toast({ tone: "success", title: "Umbrales actualizados" });
    } catch (e: any) {
      toast({
        tone: "error",
        title: "Error al guardar umbrales",
        description:
          e?.message ||
          "¿Has redesplegado las Cloud Functions? (firebase deploy --only functions)",
      });
    } finally {
      setEngineBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ajustes</h1>
        <p className="text-sm text-slate-400">
          Configura cómo Smart Alerts AI te notifica.
        </p>
      </div>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Sensibilidad
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Define el umbral a partir del cual se genera una alerta.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["low", "medium", "high"] as const).map((s) => (
            <button
              key={s}
              onClick={() => update("sensitivity", s)}
              className={
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
                (draft.sensitivity === s
                  ? "border-brand-500 bg-brand-500/10 text-brand-400"
                  : "border-white/10 text-slate-300 hover:bg-white/5")
              }
            >
              {s === "low" ? "Baja" : s === "medium" ? "Media" : "Alta"}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Tipos de alerta
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ALL_TYPES.map((t) => {
            const on = draft.enabled_types.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
                  (on
                    ? "border-brand-500 bg-brand-500/10 text-brand-400"
                    : "border-white/10 text-slate-300 hover:bg-white/5")
                }
              >
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Score mínimo
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Sólo recibirás alertas con score igual o superior ({draft.min_score}).
        </p>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft.min_score}
          onChange={(e) => update("min_score", Number(e.target.value))}
          className="mt-4 w-full accent-brand-500"
        />
      </section>

      <section className="card border border-brand-500/20 p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-400">
            🎯 Motor de señales — umbrales
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Ajusta lo estricto que es el motor al emitir señales LONG/SHORT.
            <strong> Baja los umbrales</strong> para que detecte más operaciones,{" "}
            <strong>súbelos</strong> para operar solo los setups más claros.
            Los cambios se aplican en el siguiente escaneo (≈5 min).
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tramo de sensibilidad
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(["baja", "media", "alta"] as const).map((p) => {
              const preset = ENGINE_PRESETS[p];
              const active =
                engineDraft &&
                engineDraft.min_confluence === preset.min_confluence &&
                Math.abs(engineDraft.min_risk_reward - preset.min_risk_reward) < 0.01 &&
                engineDraft.min_adx === preset.min_adx;
              return (
                <button
                  key={p}
                  onClick={() => setEngineDraft(preset)}
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-brand-500 bg-brand-500/10 text-brand-400"
                      : "border-white/10 text-slate-300 hover:bg-white/5"
                  )}
                >
                  {p === "baja" ? "Baja" : p === "media" ? "Media" : "Alta"}
                  <span className="mt-0.5 block text-[10px] font-normal text-slate-500">
                    {p === "baja"
                      ? "menos señales"
                      : p === "media"
                      ? "óptimo calibrado"
                      : "más señales"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <EngineSlider
          label="Confluencia mínima (votos ponderados)"
          hint="Votos alineados necesarios de 15. Más bajo = más señales."
          value={engineDraft?.min_confluence ?? 8}
          min={3}
          max={12}
          step={1}
          onChange={(v) => updateEngine("min_confluence", v)}
        />

        <EngineSlider
          label="R:R mínimo (riesgo/beneficio)"
          hint="Si el setup no ofrece al menos este ratio, no se emite."
          value={engineDraft?.min_risk_reward ?? 1.8}
          min={1}
          max={3}
          step={0.1}
          onChange={(v) => updateEngine("min_risk_reward", v)}
        />

        <EngineSlider
          label="ADX mínimo (fuerza de tendencia)"
          hint="Mercado lateral con ADX bajo = no operar. Baja si quieres señales en más momentos."
          value={engineDraft?.min_adx ?? 20}
          min={5}
          max={40}
          step={1}
          onChange={(v) => updateEngine("min_adx", v)}
        />

        <div className="flex items-center justify-end gap-3 border-t border-white/5 pt-4">
          <button
            onClick={saveEngine}
            disabled={engineBusy}
            className="btn-primary disabled:opacity-60"
          >
            {engineBusy ? "Guardando…" : "Aplicar umbrales"}
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Monedas silenciadas
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          No recibirás alertas de los activos silenciados.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {POPULAR_COINS.map((c) => {
            const muted = draft.muted_coins.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleMute(c.id)}
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  muted
                    ? "border-slate-600 bg-slate-700/40 text-slate-400 line-through"
                    : "border-white/10 text-slate-300 hover:bg-white/5"
                )}
              >
                {c.symbol}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Notificaciones push
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Recibe las alertas directamente en tu dispositivo.
        </p>
        <button onClick={enable} className="btn-primary mt-4">
          Activar notificaciones
        </button>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Plan
        </h2>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                "badge",
                draft.plan === "premium"
                  ? "bg-gradient-to-r from-brand-500 to-cyan-400 text-bg-base"
                  : "bg-slate-500/10 text-slate-300"
              )}
            >
              {draft.plan === "premium" ? "✦ Premium" : "Free"}
            </span>
            {draft.plan === "free" && (
              <Link to="/premium" className="text-xs text-brand-400 hover:underline">
                Ver planes →
              </Link>
            )}
          </div>
          {draft.plan === "free" && (
            <Link to="/premium" className="btn-primary text-xs">
              Mejorar a Premium
            </Link>
          )}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-400">Guardado ✓</span>}
        <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-60">
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function EngineSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-200">{label}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-sm font-semibold text-brand-300">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full accent-brand-500"
      />
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
