import { TradingSignalDoc } from "@/types";
import { clsx } from "clsx";

interface Props {
  signal: TradingSignalDoc;
  sentimentValue?: number; // 0-100, Fear & Greed
}

type CheckResult = {
  label: string;
  pass: boolean;
  value: string;
  tip: string;
};

function Check({ label, pass, value, tip }: CheckResult) {
  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/60">
      <span
        className={clsx(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
          pass
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
        )}
      >
        {pass ? "✓" : "✕"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-200">{label}</span>
          <span
            className={clsx(
              "text-[10px] font-mono font-bold shrink-0 rounded px-1.5 py-0.5 border",
              pass
                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                : "bg-rose-500/10 text-rose-300 border-rose-500/20"
            )}
          >
            {value}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">{tip}</p>
      </div>
    </div>
  );
}

export function SignalDecisionGuide({ signal, sentimentValue = 50 }: Props) {
  const isLong = signal.direction === "LONG";
  const score = signal.confluence_score ?? 0;
  const total = signal.confluence_total ?? 12;
  const hasConflict = (signal as any).timeframe_conflict === true;
  const rr = signal.risk_reward ?? 0;

  // Parse timeframe biases
  const bias15m = ((signal as any).bias_15m || "NEUTRAL").split(" ")[0] as string;
  const bias1h = ((signal as any).bias_1h || "NEUTRAL").split(" ")[0] as string;
  const bias4h = ((signal as any).bias_4h || "NEUTRAL").split(" ")[0] as string;

  const dir = signal.direction || "LONG";
  const aligned15m = bias15m === dir;
  const aligned1h = bias1h === dir;
  const aligned4h = bias4h === dir;
  const allAligned = aligned15m && aligned1h && aligned4h;
  const majorAligned = aligned1h && aligned4h; // at least 1H + 4H

  const sentimentOk =
    isLong ? sentimentValue > 25 : sentimentValue < 75;

  // Compute overall verdict
  const checks: CheckResult[] = [
    {
      label: "Confluencia Cuantitativa (≥ 9/12)",
      pass: score >= 9,
      value: `${score}/${total}`,
      tip:
        score >= 9
          ? "Alta confluencia. Los pilares están muy alineados en la dirección de la señal."
          : score >= 7
          ? "Confluencia media. Espera confirmación adicional antes de entrar."
          : "Confluencia débil. Alto riesgo de falsa señal.",
    },
    {
      label: "Sin conflicto entre 15M y 4H",
      pass: !hasConflict,
      value: hasConflict ? "⚠️ CONFLICTO" : "✅ Limpio",
      tip: hasConflict
        ? "15M y 4H están en dirección contraria a la señal. Riesgo de reversión a corto plazo."
        : "Las tres temporalidades están alineadas. Señal más fiable.",
    },
    {
      label: "Alineación de Temporalidades",
      pass: majorAligned,
      value: allAligned ? "3/3 Alineadas" : majorAligned ? "1H+4H ✓" : "Sin alineación",
      tip: allAligned
        ? "15M + 1H + 4H todas confirman la dirección. Entrada ideal."
        : majorAligned
        ? "1H y 4H confirman. 15M diverge. Considera esperar entrada en 15M."
        : "Las temporalidades no confirman la dirección. No entrar.",
    },
    {
      label: "Ratio Riesgo/Beneficio (R:R ≥ 2.0)",
      pass: rr >= 2.0,
      value: `${rr.toFixed(2)}:1`,
      tip:
        rr >= 2.5
          ? "Excelente R:R. Por cada 1 USD de riesgo, el motor espera ganar $" + rr.toFixed(2) + "."
          : rr >= 2.0
          ? "R:R aceptable. Asegúrate de respetar el SL sin moverlo."
          : "R:R por debajo de 2:1. Riesgo no justificado por la recompensa potencial.",
    },
    {
      label: "Sentimiento de Mercado Favorable",
      pass: sentimentOk,
      value: `F&G: ${sentimentValue}/100`,
      tip: isLong
        ? sentimentValue <= 25
          ? "Miedo extremo. Riesgo de continuación bajista. Más cautela en LONG."
          : "Sentimiento permite entrada LONG con normalidad."
        : sentimentValue >= 75
        ? "Codicia extrema. El mercado puede estar cerca de un techo. Más cautela en SHORT."
        : "Sentimiento permite entrada SHORT con normalidad.",
    },
  ];

  const passCount = checks.filter((c) => c.pass).length;
  const verdict =
    passCount === 5
      ? { label: "✅ ENTRAR — Señal Fuerte", color: "emerald", action: "Entra con el tamaño de posición calculado. Respeta SL y TP al 100%." }
      : passCount >= 4
      ? { label: "🟡 ESPERAR — Confirmación", color: "amber", action: "Espera confirmación adicional en el gráfico de 15M antes de entrar." }
      : passCount >= 3
      ? { label: "🟠 PRECAUCIÓN — Señal Débil", color: "orange", action: "Reduce el tamaño de posición a la mitad o no entres." }
      : { label: "🔴 NO ENTRAR — Riesgo Alto", color: "rose", action: "Las condiciones no justifican el riesgo. Espera una señal más limpia." };

  // Recommended timeframe logic
  const recommendedTF = allAligned ? "1H (confirmación principal)" : majorAligned ? "1H ó 4H" : "4H (swing más seguro)";

  // Exit strategy with safe fallbacks
  const slPrice = signal.stop_loss ?? 0;
  const tp1Price = signal.take_profit_1 ?? 0;
  const tp2Price = signal.take_profit_2 ?? 0;
  const slPct = signal.sl_pct ?? 0;
  const tp1Pct = signal.tp1_pct ?? 0;
  const tp2Pct = signal.tp2_pct ?? 0;

  return (
    <div className="space-y-5">
      {/* ── VEREDICTO FINAL ──────────────────────────────────── */}
      <div
        className={clsx(
          "rounded-2xl border-2 p-5 space-y-2",
          verdict.color === "emerald" && "border-emerald-500/40 bg-emerald-500/5",
          verdict.color === "amber" && "border-amber-500/40 bg-amber-500/5",
          verdict.color === "orange" && "border-orange-500/40 bg-orange-500/5",
          verdict.color === "rose" && "border-rose-500/40 bg-rose-500/5"
        )}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3
            className={clsx(
              "text-lg font-black",
              verdict.color === "emerald" && "text-emerald-300",
              verdict.color === "amber" && "text-amber-300",
              verdict.color === "orange" && "text-orange-300",
              verdict.color === "rose" && "text-rose-400"
            )}
          >
            {verdict.label}
          </h3>
          <span className="text-xs font-bold text-slate-400">
            {passCount}/5 condiciones OK
          </span>
        </div>
        <p className="text-sm text-slate-300 font-medium">{verdict.action}</p>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] font-bold uppercase text-slate-500">Temporalidad Recomendada:</span>
          <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-xs font-bold text-slate-200">
            📊 {recommendedTF}
          </span>
        </div>
      </div>

      {/* ── CHECKLIST ENTRADA ────────────────────────────────── */}
      <div className="space-y-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <span>🔍</span> Checklist de Entrada ({passCount}/5)
        </h4>
        <div className="space-y-1.5">
          {checks.map((c) => (
            <Check key={c.label} {...c} />
          ))}
        </div>
      </div>

      {/* ── ESTRATEGIA DE SALIDA ─────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <span>🎯</span> Estrategia de Salida Recomendada
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          {/* TP1 */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase text-emerald-400">TP1 — Parcial (50%)</span>
              <span className="text-emerald-300 font-bold">+{tp1Pct.toFixed(1)}%</span>
            </div>
            <div className="text-lg font-black text-emerald-300">${tp1Price.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">
              Cierra el 50% aquí. Mueve el SL a precio de entrada (breakeven) para proteger capital.
            </p>
          </div>

          {/* TP2 */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase text-emerald-400">TP2 — Final (50%)</span>
              <span className="text-emerald-300 font-bold">+{tp2Pct.toFixed(1)}%</span>
            </div>
            <div className="text-lg font-black text-emerald-300">${tp2Price.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">
              Cierra el resto aquí o usa trailing stop si hay momentum fuerte.
            </p>
          </div>

          {/* SL */}
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase text-rose-400">Stop Loss — Fijo</span>
              <span className="text-rose-300 font-bold">-{slPct.toFixed(1)}%</span>
            </div>
            <div className="text-lg font-black text-rose-400">${slPrice.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">
              Nunca muevas el SL en contra. Si el precio lo toca, cierra sin dudar.
            </p>
          </div>
        </div>

        {/* Temporalidades de Gestión */}
        <div className="pt-2 border-t border-slate-800 space-y-2">
          <h5 className="text-[10px] uppercase font-bold text-slate-500">¿Cuándo cerrar antes del TP?</h5>
          <ul className="space-y-1.5 text-[11px] text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">⚡</span>
              <span>
                <strong className="text-slate-300">Cierre anticipado (exit parcial):</strong> Si el precio llega a TP1 y el volumen colapsa o aparece una vela de reversión fuerte en 15M.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-rose-400 mt-0.5">🛑</span>
              <span>
                <strong className="text-slate-300">Salida de emergencia:</strong> Si la 1H cierra contra tu posición con cuerpo grande antes de alcanzar TP1.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5">📅</span>
              <span>
                <strong className="text-slate-300">Tiempo máximo:</strong> Si pasan más de 8 horas sin movimiento significativo, cierra aunque no hayas tocado SL.
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* ── GUÍA DE TEMPORALIDAD ─────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <span>⏱️</span> ¿Con qué temporalidad operar?
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {/* 15M */}
          <div className={clsx("rounded-lg border p-3 space-y-1", aligned15m ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-950/50 opacity-60")}>
            <div className="flex justify-between">
              <span className="font-bold text-slate-200">15M — Scalping</span>
              <span className={aligned15m ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                {aligned15m ? "✓ " + dir : "✕ " + (isLong ? "SHORT" : "LONG")}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Úsalo para afinar el punto de entrada. No para decidir la dirección.</p>
          </div>

          {/* 1H */}
          <div className={clsx("rounded-lg border p-3 space-y-1", aligned1h ? "border-amber-500/30 bg-amber-500/5" : "border-slate-800 bg-slate-950/50 opacity-60")}>
            <div className="flex justify-between">
              <span className="font-bold text-slate-200">1H — Primaria ⭐</span>
              <span className={aligned1h ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                {aligned1h ? "✓ " + dir : "✕ " + (isLong ? "SHORT" : "LONG")}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Temporalidad principal del motor. Aquí se valida la señal y se decide entrar.</p>
          </div>

          {/* 4H */}
          <div className={clsx("rounded-lg border p-3 space-y-1", aligned4h ? "border-sky-500/30 bg-sky-500/5" : "border-slate-800 bg-slate-950/50 opacity-60")}>
            <div className="flex justify-between">
              <span className="font-bold text-slate-200">4H — Estructura</span>
              <span className={aligned4h ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                {aligned4h ? "✓ " + dir : "✕ " + (isLong ? "SHORT" : "LONG")}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Define la tendencia macro. Si contradice la señal, el riesgo aumenta mucho.</p>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800">
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-200">Regla de oro:</strong> La señal se genera en 1H. La 4H te dice si la tendencia mayor apoya la operación. La 15M te da el punto de entrada preciso con menor riesgo.
          </p>
        </div>
      </div>
    </div>
  );
}
