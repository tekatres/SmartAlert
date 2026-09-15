import { useEffect, useState } from "react";
import {
  getMacroBlackout,
  getWeekendStatus,
  MacroBlackoutResult,
} from "@/services/marketFilters";

export function MarketProtectionBanner() {
  const [blackout, setBlackout] = useState<MacroBlackoutResult | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;
    getMacroBlackout().then((r) => {
      if (!cancelled) setBlackout(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const weekend = getWeekendStatus(now);

  if (blackout?.blocked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-rose-500/50 bg-rose-950/40 px-4 py-3 text-xs shadow-lg animate-pulse">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base">🚨</span>
          <span className="font-black uppercase tracking-widest text-rose-300">
            Modo REFUGIO / NO OPERAR
          </span>
          <span className="rounded bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 font-mono font-bold text-rose-200">
            {blackout.activeEvents.map((e) => `${e.title} (${e.country})`).join(" · ")}
          </span>
        </div>
        <span className="text-rose-200/90">
          El motor bloquea señales ±30 min alrededor de eventos macro de alto impacto. Evita entrar hasta que pase la volatilidad.
        </span>
      </div>
    );
  }

  if (weekend.isWeekend) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base">📅</span>
          <span className="font-black uppercase tracking-widest text-amber-300">
            Guard de Fin de Semana
          </span>
          <span className="rounded bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 font-mono font-bold text-amber-200">
            Confluencia mínima elevada a 9-10/12
          </span>
        </div>
        <span className="text-amber-200/80">
          Liquidez institucional reducida en fin de semana — solo se emiten señales de confluencia alta.{" "}
          {blackout?.nextEvent
            ? `Próximo evento macro: ${blackout.nextEvent.title} (${blackout.nextEvent.country}) · ${new Date(blackout.nextEvent.date).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : "Sin eventos macro de alto impacto previstos esta semana."}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-base">🛡️</span>
        <span className="font-bold uppercase tracking-wider text-slate-300">
          Filtros de Protección
        </span>
        <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 font-mono font-bold text-emerald-300">
          ACTIVOS
        </span>
      </div>
      <span className="text-slate-400">
        {blackout?.nextEvent
          ? `Próximo evento macro: ${blackout.nextEvent.title} (${blackout.nextEvent.country}) · ${new Date(blackout.nextEvent.date).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
          : "Sin eventos macro de alto impacto previstos esta semana."}
      </span>
    </div>
  );
}