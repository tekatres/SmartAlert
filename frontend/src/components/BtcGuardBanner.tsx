import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { fetchBtcGuard, BtcGuardData } from "@/services/btcGuard";

function formatPrice(p: number) {
  if (p <= 0) return "—";
  if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${p.toFixed(4)}`;
}

export function BtcGuardBanner() {
  const [guard, setGuard] = useState<BtcGuardData | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchBtcGuard().then((data) => {
      if (!cancelled) setGuard(data);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!guard) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs text-slate-400">
        <span className="animate-pulse">🛡️ Evaluando BTC Beta Guard...</span>
      </div>
    );
  }

  if (guard.direction === "NEUTRAL") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-base">🛡️</span>
          <span className="font-black uppercase tracking-wider text-slate-300">
            BTC Beta Guard
          </span>
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 font-mono font-bold text-slate-300">
            NEUTRAL
          </span>
        </div>
        <span className="text-slate-400">
          Bitcoin en rango lateral ({guard.strength}/10). Sin bloqueo de señales ·
          Actualizado {guard.updatedAt}
        </span>
      </div>
    );
  }

  const isLong = guard.direction === "LONG";

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs",
        isLong
          ? "border-emerald-500/40 bg-emerald-950/30"
          : "border-rose-500/40 bg-rose-950/30"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base">{isLong ? "🛡️" : "⚠️"}</span>
        <span className="font-black uppercase tracking-wider text-slate-100">
          BTC Beta Guard
        </span>
        <span
          className={clsx(
            "rounded px-2 py-0.5 font-mono font-black",
            isLong
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
          )}
        >
          {isLong ? "ALINEADO" : "BLOQUEADO"}
        </span>
        <span className="text-slate-300 font-semibold">
          BTC {isLong ? "Alcista" : "Bajista"} en 1h ({guard.strength}/10)
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
        <span className="text-slate-400">
          Precio <strong className={isLong ? "text-emerald-300" : "text-rose-300"}>{formatPrice(guard.price)}</strong>
        </span>
        <span className="text-slate-400">
          24h{" "}
          <strong className={guard.priceChangePct >= 0 ? "text-emerald-300" : "text-rose-300"}>
            {guard.priceChangePct >= 0 ? "+" : ""}
            {guard.priceChangePct.toFixed(2)}%
          </strong>
        </span>
        <span className="text-slate-400">
          EMA50 <strong className="text-slate-200">{formatPrice(guard.ema50)}</strong>
        </span>
        <span className="text-slate-400">
          RSI 1h <strong className="text-slate-200">{guard.rsi1h.toFixed(0)}</strong>
        </span>
        <span className="text-slate-400">
          RSI 15m <strong className="text-slate-200">{guard.rsi15m.toFixed(0)}</strong>
        </span>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="rounded-lg bg-white/5 border border-white/10 px-2 py-0.5 font-sans text-slate-300 hover:bg-white/10 transition-colors"
          title="Actualizar estado de Bitcoin"
        >
          🔄
        </button>
      </div>

      <div
        className={clsx(
          "w-full text-[11px] font-medium",
          isLong ? "text-emerald-400/80" : "text-rose-400/80"
        )}
      >
        {isLong
          ? "BTC impulsa el mercado → LONGs habilitados. Evita SHORTs contra el líder."
          : "BTC arrastra al mercado → LONGs bloqueados en altcoins. Solo SHORTs o esperar confirmación."}
      </div>
    </div>
  );
}