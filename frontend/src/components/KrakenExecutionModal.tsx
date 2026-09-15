import { useState } from "react";
import { TradingSignalDoc } from "@/types";
import { clsx } from "clsx";

interface Props {
  signal: TradingSignalDoc;
  isOpen: boolean;
  onClose: () => void;
}

const KRAKEN_FUTURES_MAP: Record<string, string> = {
  BTC: "PF_XBTUSD",
  ETH: "PF_ETHUSD",
  SOL: "PF_SOLUSD",
  XRP: "PF_XRPUSD",
  ADA: "PF_ADAUSD",
  DOGE: "PF_DOGEUSD",
  AVAX: "PF_AVAXUSD",
  LINK: "PF_LINKUSD",
  NEAR: "PF_NEARUSD",
  OP: "PF_OPUSD",
  ARB: "PF_ARBUSD",
  APT: "PF_APTUSD",
  INJ: "PF_INJUSD",
};

export function KrakenExecutionModal({ signal, isOpen, onClose }: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!isOpen) return null;

  const isLong = signal.direction === "LONG";
  const krakenSymbol = KRAKEN_FUTURES_MAP[signal.symbol.toUpperCase()] || `PF_${signal.symbol.toUpperCase()}USD`;
  const spotPair = `${signal.symbol.toUpperCase()}/USD`;
  const krakenFuturesUrl = `https://futures.kraken.com/trade/${krakenSymbol}`;
  const krakenSpotUrl = `https://pro.kraken.com/app/trade/${signal.symbol.toLowerCase()}-usd`;

  const entryMin = signal.entry_zone_min || (isLong ? signal.entry_price * 0.993 : signal.entry_price);
  const entryMax = signal.entry_zone_max || (isLong ? signal.entry_price : signal.entry_price * 1.007);
  const liqEst = signal.liquidation_price_est || (isLong
    ? signal.entry_price * (1 - (1 / Math.max(2, signal.leverage)) * 0.9)
    : signal.entry_price * (1 + (1 / Math.max(2, signal.leverage)) * 0.9));

  const formatPrice = (p: number) => {
    if (p >= 1000) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (p >= 1) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
    return `$${p.toFixed(6)}`;
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const fullKrakenPayload = `🐙 GUÍA DE ORDEN KRAKEN PRO
==============================
Contrato Kraken Futures: ${krakenSymbol}
Par Spot Margin: ${spotPair}
Dirección: ${signal.direction} (${signal.leverage}x Aislado)

1. TIPO DE ENTRADA: Limit (Post-Only)
   Rango Pullback Óptimo: ${formatPrice(entryMin)} - ${formatPrice(entryMax)}
   Precio Sugerido: ${formatPrice(signal.entry_price)}

2. GESTIÓN DE RIESGO:
   Stop Loss: ${formatPrice(signal.stop_loss)} (-${signal.sl_pct.toFixed(2)}%)
   Tipo de Stop: Stop Market (Trigger: Index Price, Reduce-Only)
   Liquidación Estimada: ~${formatPrice(liqEst)}

3. SALIDAS DE BENEFICIO:
   TP1 (50% tamaño): ${formatPrice(signal.take_profit_1)} (+${signal.tp1_pct.toFixed(2)}%)
   TP2 (50% tamaño): ${formatPrice(signal.take_profit_2)} (+${signal.tp2_pct.toFixed(2)}%)

4. REGLA INSTITUCIONAL KRAKEN:
   Al llenarse TP1 -> Mover SL a ${formatPrice(signal.entry_price)} (Riesgo 0€).
==============================`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-indigo-500/30 bg-slate-950 p-6 shadow-2xl overflow-y-auto">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg bg-white/5 border border-white/10 p-2 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          ✕
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-2xl">
            🐙
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="badge bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 text-xs font-bold">
                KRAKEN PRO COMPATIBLE
              </span>
              <span className={clsx(
                "badge text-xs font-bold",
                isLong
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                  : "bg-rose-500/10 text-rose-300 border border-rose-500/30"
              )}>
                {signal.direction} {signal.leverage}x
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 mt-1">
              Cómo Ejecutar esta Señal en Kraken Pro
            </h2>
            <p className="text-xs text-slate-400">
              Parámetros validados para comisiones mínimas (Maker 0.02%) y máxima protección de capital.
            </p>
          </div>
        </div>

        {/* Direct Link Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
          <a
            href={krakenFuturesUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600/90 hover:bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-all shadow-lg shadow-indigo-600/20"
          >
            <span>🐙 Abrir en Kraken Futures ({krakenSymbol})</span>
            <span>↗</span>
          </a>
          <a
            href={krakenSpotUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-200 transition-all"
          >
            <span>📊 Abrir en Kraken Pro Spot ({spotPair})</span>
            <span>↗</span>
          </a>
        </div>

        {/* Step-by-Step Instructions */}
        <div className="space-y-4 text-xs">
          {/* Step 1: Instrumento */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                <span>1️⃣</span> Selecciona el Contrato / Par
              </span>
              <span className="text-[10px] text-slate-500">Kraken Futures o Margin</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div className="flex items-center justify-between rounded-lg bg-slate-950 p-2 border border-slate-800">
                <div>
                  <div className="text-[10px] text-slate-500">Contrato Perpetuo:</div>
                  <div className="font-mono font-bold text-indigo-200 text-sm">{krakenSymbol}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(krakenSymbol, "krakenSymbol")}
                  className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-white/10"
                >
                  {copiedField === "krakenSymbol" ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-950 p-2 border border-slate-800">
                <div>
                  <div className="text-[10px] text-slate-500">Par Spot Margin:</div>
                  <div className="font-mono font-bold text-slate-200 text-sm">{spotPair}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(spotPair, "spotPair")}
                  className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-white/10"
                >
                  {copiedField === "spotPair" ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2: Orden Limit en Pullback */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>2️⃣</span> Entrada: Orden LIMIT (Anti-FOMO)
              </span>
              <span className="badge bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]">
                Maker Fee: 0.02%
              </span>
            </div>
            <p className="text-slate-300">
              No uses orden Market. Coloca una orden <strong>Limit</strong> dentro del rango de pullback (o activa <em>Post-Only</em>) para pagar la tarifa reducida de Kraken.
            </p>
            <div className="flex items-center justify-between rounded-lg bg-slate-950 p-2.5 border border-slate-800 font-mono">
              <div>
                <span className="text-slate-400 text-[11px]">Rango Pullback Óptimo: </span>
                <span className="text-amber-300 font-bold">{formatPrice(entryMin)} – {formatPrice(entryMax)}</span>
              </div>
              <button
                onClick={() => copyToClipboard(String(signal.entry_price), "entryPrice")}
                className="rounded bg-white/5 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-white/10"
              >
                {copiedField === "entryPrice" ? "✓ Copiado" : `Copiar $${signal.entry_price}`}
              </button>
            </div>
          </div>

          {/* Step 3: Stop Loss con Reduce Only */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-rose-300 flex items-center gap-1.5">
                <span>3️⃣</span> Stop Loss: Tipo STOP MARKET con Trigger Index
              </span>
              <span className="text-rose-400 font-mono font-bold">-{signal.sl_pct.toFixed(2)}%</span>
            </div>
            <p className="text-slate-300">
              En Kraken Pro, selecciona <strong>Stop Market</strong>. Muy importante: usa <strong>Trigger: Index Price</strong> para que las mechas de manipulación no te liquiden, y marca la casilla <strong className="text-rose-300 underline">Reduce-Only</strong>.
            </p>
            <div className="flex items-center justify-between rounded-lg bg-slate-950 p-2.5 border border-slate-800 font-mono">
              <div>
                <span className="text-slate-400 text-[11px]">Precio Disparador Stop: </span>
                <span className="text-rose-400 font-bold">{formatPrice(signal.stop_loss)}</span>
                <span className="text-slate-500 text-[10px] ml-2">(Liq. Est: {formatPrice(liqEst)})</span>
              </div>
              <button
                onClick={() => copyToClipboard(String(signal.stop_loss), "stopLoss")}
                className="rounded bg-white/5 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-white/10"
              >
                {copiedField === "stopLoss" ? "✓ Copiado" : `Copiar $${signal.stop_loss}`}
              </button>
            </div>
          </div>

          {/* Step 4: Take Profit Escalonado y Regla Break-Even */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                <span>4️⃣</span> Take Profit 50/50 + Regla Break-Even
              </span>
              <span className="badge bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px]">
                R:R {signal.risk_reward.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-950 p-2.5 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400">TP1 (Vender 50% posición):</div>
                  <div className="font-mono font-bold text-emerald-400">{formatPrice(signal.take_profit_1)}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(String(signal.take_profit_1), "tp1")}
                  className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-white/10"
                >
                  {copiedField === "tp1" ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
              <div className="rounded-lg bg-slate-950 p-2.5 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400">TP2 (Vender 50% restante):</div>
                  <div className="font-mono font-bold text-emerald-300">{formatPrice(signal.take_profit_2)}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(String(signal.take_profit_2), "tp2")}
                  className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-white/10"
                >
                  {copiedField === "tp2" ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
            </div>

            {/* Zero-risk highlight */}
            <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/30 p-2.5 text-emerald-200 flex items-start gap-2">
              <span className="text-base">🛡️</span>
              <div>
                <strong className="text-emerald-300">Regla de Oro en Kraken:</strong> En el momento en que Kraken ejecute tu TP1, edita la orden Stop Loss y muévela a <span className="font-mono font-bold text-white">${signal.entry_price}</span>. A partir de ese segundo, tu operación es <strong>100% libre de riesgo (0€ de pérdida posible)</strong>.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            onClick={() => copyToClipboard(fullKrakenPayload, "full")}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 px-4 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-500/30 transition-colors"
          >
            <span>{copiedField === "full" ? "✓ ¡Todos los datos copiados!" : "📋 Copiar Resumen Completo"}</span>
          </button>

          <button
            onClick={onClose}
            className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
