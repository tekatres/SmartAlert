import { useState, useMemo } from "react";
import { TradingSignalDoc } from "@/types";
import { usePaperTrading, MarginMode, OrderType, PaperTrade } from "@/hooks/usePaperTrading";
import { TradingViewChart } from "@/components/TradingViewChart";
import { useLivePrices } from "@/hooks/useLivePrices";
import { clsx } from "clsx";

export function BinanceFuturesSimulator({ signals }: { signals: TradingSignalDoc[] }) {
  const { balance, trades, openTradeParams, closeTrade, resetAccount, winRate, netPnl } = usePaperTrading();

  // Selected symbol for Binance Terminal
  const [symbol, setSymbol] = useState<string>(signals.length > 0 ? signals[0].symbol : "BTC");
  const [marginMode, setMarginMode] = useState<MarginMode>("ISOLATED");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [leverage, setLeverage] = useState<number>(10);
  const [marginUsd, setMarginUsd] = useState<number>(250);
  const [activeTab, setActiveTab] = useState<"positions" | "history" | "assets">("positions");

  // All symbols that have open positions + the currently viewed one
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const liveSymbols = useMemo(() => {
    const syms = new Set<string>([symbol]);
    openTrades.forEach((t) => syms.add(t.symbol));
    return Array.from(syms);
  }, [symbol, openTrades.length]);

  // Live Binance Futures mark prices — poll every 3 seconds
  const livePrices = useLivePrices(liveSymbols, 3000);

  const activeSignal = signals.find((s) => s.symbol === symbol);
  const staticFallback = activeSignal ? activeSignal.entry_price : symbol === "BTC" ? 77950 : symbol === "ETH" ? 2445 : 102;
  // Use live price if available, otherwise fall back to signal entry price
  const markPrice = livePrices[symbol] ?? staticFallback;
  const [customPrice, setCustomPrice] = useState<number>(staticFallback);

  const slPct = activeSignal ? activeSignal.sl_pct : 2.5;
  const tp1Pct = activeSignal ? activeSignal.tp1_pct : 3.5;
  const tp2Pct = activeSignal ? activeSignal.tp2_pct : 7.0;

  const positionSizeUsd = marginUsd * leverage;
  const quantityCoins = markPrice > 0 ? positionSizeUsd / markPrice : 0;

  // Liquidation Price calculation
  const mmr = 0.005;
  const longLiq = markPrice * (1 - 1 / leverage + mmr);
  const shortLiq = markPrice * (1 + 1 / leverage - mmr);

  const handleExecuteLong = () => {
    openTradeParams({
      symbol,
      direction: "LONG",
      orderType,
      marginMode,
      entryPrice: orderType === "MARKET" ? markPrice : customPrice,
      marginUsd,
      leverage,
      slPct,
      tp1Pct,
      tp2Pct,
      signalId: activeSignal?.id,
    });
  };

  const handleExecuteShort = () => {
    openTradeParams({
      symbol,
      direction: "SHORT",
      orderType,
      marginMode,
      entryPrice: orderType === "MARKET" ? markPrice : customPrice,
      marginUsd,
      leverage,
      slPct,
      tp1Pct,
      tp2Pct,
      signalId: activeSignal?.id,
    });
  };

  const closedTrades = trades.filter((t) => t.status !== "OPEN");

  /** Compute unrealized PnL for an open position given current live price */
  const calcUnrealizedPnl = (t: PaperTrade) => {
    const livePrice = livePrices[t.symbol] ?? t.entryPrice;
    const priceDiff = t.direction === "LONG"
      ? livePrice - t.entryPrice
      : t.entryPrice - livePrice;
    const pnlUsd = (priceDiff / t.entryPrice) * t.positionUsd;
    const roePct = (pnlUsd / t.marginUsd) * 100;
    return { livePrice, pnlUsd, roePct };
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b0e14] text-slate-100 shadow-2xl overflow-hidden font-sans space-y-0">
      {/* ── TOP BINANCE FUTURES HEADER TICKER BAR ──────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#121621] px-5 py-3 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-amber-500/20 text-amber-400 font-black text-xs">
              ⚡
            </span>
            <div>
              <span className="font-black text-sm text-slate-100">{symbol}USDT</span>
              <span className="ml-1 text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                Perpetual
              </span>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          <div className="hidden sm:flex items-center gap-4 font-mono">
            <div>
              <span className="block text-[9px] uppercase text-slate-500 font-bold">Precio Marcación</span>
              <span className="font-bold text-emerald-400 text-sm">${markPrice.toLocaleString()}</span>
            </div>

            <div>
              <span className="block text-[9px] uppercase text-slate-500 font-bold">Tasa Financiación (8h)</span>
              <span className="text-emerald-400 text-xs">+0.0100% en <strong className="text-slate-300">03:42:15</strong></span>
            </div>

            <div>
              <span className="block text-[9px] uppercase text-slate-500 font-bold">Volumen 24h</span>
              <span className="text-slate-300">$1,482,920,400</span>
            </div>
          </div>
        </div>

        {/* Balance & Asset Overview */}
        <div className="flex items-center gap-3 bg-[#181e2b] px-3 py-1.5 rounded-xl border border-slate-800">
          <div>
            <span className="block text-[9px] uppercase font-bold text-slate-400">Billetera Futuros</span>
            <span className="font-mono text-xs font-bold text-emerald-400">
              ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </span>
          </div>
          <div className="border-l border-slate-700 pl-3">
            <span className="block text-[9px] uppercase font-bold text-slate-400">PnL Neto</span>
            <span className={clsx("font-mono text-xs font-bold", netPnl >= 0 ? "text-emerald-300" : "text-rose-400")}>
              {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}
            </span>
          </div>
          <button
            onClick={resetAccount}
            className="text-[10px] text-slate-500 hover:text-rose-400 underline font-bold"
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── ASSET QUICK SELECTOR RIBBON ────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 bg-[#0e121b] px-4 py-2 border-b border-slate-800/80 overflow-x-auto">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0 mr-2">
          Mercados Futuros:
        </span>
        {Array.from(new Set(signals.map((s) => s.symbol).concat(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LINK"]))).map((sym) => (
          <button
            key={sym}
            onClick={() => {
              setSymbol(sym);
              const sig = signals.find((s) => s.symbol === sym);
              if (sig) setCustomPrice(sig.entry_price);
            }}
            className={clsx(
              "rounded-md px-3 py-1 text-xs font-bold transition-all shrink-0 font-mono border",
              symbol === sym
                ? "bg-amber-500 text-slate-950 border-amber-400 shadow-md"
                : "bg-[#161b26] text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
            )}
          >
            {sym}USDT
          </button>
        ))}
      </div>

      {/* ── MAIN TERMINAL GRID (Chart + Order Book + Binance Form) ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 bg-[#0b0e14]">
        {/* LEFT 7 COLS: Live TradingView Chart */}
        <div className="lg:col-span-7 border-r border-b lg:border-b-0 border-slate-800 p-2">
          <TradingViewChart symbol={symbol} height={480} interval="60" />
        </div>

        {/* MIDDLE 2 COLS: Binance Live Order Book Simulation */}
        <div className="lg:col-span-2 border-r border-b lg:border-b-0 border-slate-800 p-3 hidden xl:block font-mono text-[11px] space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 text-[10px] font-bold uppercase text-slate-500">
            <span>Libro de Órdenes</span>
            <span>Cantidad</span>
          </div>

          {/* ASKS (RED / SELL ORDERS) */}
          <div className="space-y-1 text-rose-400">
            {[1.004, 1.003, 1.002, 1.001].map((mult, idx) => (
              <div key={idx} className="flex justify-between items-center bg-rose-500/5 px-1 py-0.5 rounded">
                <span>${(markPrice * mult).toFixed(2)}</span>
                <span className="text-slate-400">{(0.45 * (idx + 1)).toFixed(3)}</span>
              </div>
            ))}
          </div>

          {/* CURRENT MARK PRICE HIGHLIGHT */}
          <div className="py-1 text-center font-bold text-sm bg-slate-900 border-y border-slate-800 text-emerald-400">
            ${markPrice.toLocaleString()} USD
          </div>

          {/* BIDS (GREEN / BUY ORDERS) */}
          <div className="space-y-1 text-emerald-400">
            {[0.999, 0.998, 0.997, 0.996].map((mult, idx) => (
              <div key={idx} className="flex justify-between items-center bg-emerald-500/5 px-1 py-0.5 rounded">
                <span>${(markPrice * mult).toFixed(2)}</span>
                <span className="text-slate-400">{(0.52 * (idx + 1)).toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT 3 COLS: Professional Binance Order Form */}
        <div className="lg:col-span-5 xl:col-span-3 p-4 space-y-4 bg-[#121621]">
          {/* Margin Mode & Leverage Selector Header */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMarginMode(marginMode === "ISOLATED" ? "CROSS" : "ISOLATED")}
              className="flex-1 rounded-lg bg-[#1a2130] border border-slate-700 py-1.5 text-xs font-bold text-slate-200 hover:border-amber-500 transition-colors"
            >
              {marginMode === "ISOLATED" ? "Aislado (Isolated)" : "Cruzado (Cross)"}
            </button>

            <div className="flex-1 flex items-center justify-between rounded-lg bg-[#1a2130] border border-slate-700 px-3 py-1.5 text-xs font-bold">
              <span className="text-slate-400 text-[10px]">Apalancamiento:</span>
              <span className="font-mono text-amber-400">{leverage}x</span>
            </div>
          </div>

          {/* Leverage Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold text-slate-400">
              <span>1x</span>
              <span>5x</span>
              <span>10x</span>
              <span>15x</span>
              <span>25x</span>
            </div>
            <input
              type="range"
              min="1"
              max="25"
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* Order Type Selector Tabs */}
          <div className="flex rounded-lg bg-[#0b0e14] p-1 border border-slate-800 text-xs font-bold">
            <button
              onClick={() => setOrderType("MARKET")}
              className={clsx(
                "flex-1 rounded py-1 transition-colors",
                orderType === "MARKET" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              )}
            >
              Mercado (Market)
            </button>
            <button
              onClick={() => setOrderType("LIMIT")}
              className={clsx(
                "flex-1 rounded py-1 transition-colors",
                orderType === "LIMIT" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              )}
            >
              Límite (Limit)
            </button>
          </div>

          {/* Limit Price Input if Limit order */}
          {orderType === "LIMIT" && (
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Precio Orden Límite ($)</label>
              <input
                type="number"
                step="any"
                value={customPrice}
                onChange={(e) => setCustomPrice(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#0b0e14] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}

          {/* Margin Input */}
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 font-bold mb-1">
              <span>Margen USDT</span>
              <span className="font-mono text-slate-200">Posición: ${positionSizeUsd.toFixed(2)} USD</span>
            </div>
            <input
              type="number"
              step="50"
              value={marginUsd}
              onChange={(e) => setMarginUsd(Math.max(10, Number(e.target.value)))}
              className="w-full rounded-lg border border-slate-700 bg-[#0b0e14] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Estimated Liquidation & TP/SL Preview Box */}
          <div className="rounded-xl border border-slate-800 bg-[#0b0e14] p-3 text-xs space-y-1.5 font-mono">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Precio Marcación:</span>
              <span className="font-bold text-slate-200">${markPrice}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Est. Liq. (LONG):</span>
              <span className="font-bold text-rose-400">${longLiq.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Est. Liq. (SHORT):</span>
              <span className="font-bold text-rose-400">${shortLiq.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px] pt-1 border-t border-slate-900">
              <span className="text-slate-500">Cantidad Monedas:</span>
              <span className="font-bold text-amber-300">{quantityCoins.toFixed(4)} {symbol}</span>
            </div>
          </div>

          {/* Execute Buttons (Buy/Long & Sell/Short) */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={handleExecuteLong}
              className="rounded-xl bg-emerald-500 py-3 text-xs font-black text-slate-950 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
            >
              Comprar / LONG
            </button>
            <button
              onClick={handleExecuteShort}
              className="rounded-xl bg-rose-500 py-3 text-xs font-black text-slate-950 hover:bg-rose-400 transition-all shadow-lg shadow-rose-500/20"
            >
              Vender / SHORT
            </button>
          </div>
        </div>
      </div>

      {/* ── BOTTOM TERMINAL POSITIONS & ORDERS TABLE ───────────────────────────── */}
      <div className="border-t border-slate-800 bg-[#121621] p-4 space-y-3">
        {/* Tabs header */}
        <div className="flex items-center gap-4 border-b border-slate-800 pb-2 text-xs font-bold">
          <button
            onClick={() => setActiveTab("positions")}
            className={clsx(
              "pb-1 transition-colors border-b-2",
              activeTab === "positions"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            )}
          >
            Posiciones Abiertas ({openTrades.length})
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={clsx(
              "pb-1 transition-colors border-b-2",
              activeTab === "history"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            )}
          >
            Historial de Operaciones ({closedTrades.length})
          </button>
          <button
            onClick={() => setActiveTab("assets")}
            className={clsx(
              "pb-1 transition-colors border-b-2",
              activeTab === "assets"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            )}
          >
            Resumen de Cuenta (Win-rate: {winRate.toFixed(1)}%)
          </button>
        </div>

        {/* Tab content */}
        {activeTab === "positions" && (
          <div className="overflow-x-auto">
            {openTrades.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No hay posiciones abiertas en este momento.</p>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase font-bold">
                    <th className="py-2">Símbolo</th>
                    <th className="py-2">Tamaño (USDT)</th>
                    <th className="py-2">Entrada</th>
                    <th className="py-2">Mark Price</th>
                    <th className="py-2">Precio Liq.</th>
                    <th className="py-2 text-emerald-400">PnL No Real. (ROE%)</th>
                    <th className="py-2 text-right">Cierre</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {openTrades.map((t) => {
                    const { livePrice, pnlUsd, roePct } = calcUnrealizedPnl(t);
                    const isProfit = pnlUsd >= 0;
                    return (
                    <tr key={t.id} className="hover:bg-slate-900/60">
                      <td className="py-2.5 font-bold">
                        <span className={clsx("px-1.5 py-0.5 rounded text-[10px]", t.direction === "LONG" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                          {t.symbol} {t.direction} {t.leverage}x
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-200">${t.positionUsd.toFixed(2)}</td>
                      <td className="py-2.5 text-slate-300">${t.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 text-amber-300 font-bold font-mono">
                        ${livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        <span className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] text-emerald-300 font-sans border border-emerald-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" /> WS LIVE
                        </span>
                      </td>
                      <td className="py-2.5 text-rose-400">${t.liqPrice}</td>
                      <td className="py-2.5">
                        <div className={clsx("font-black text-sm leading-tight font-mono transition-all duration-100", isProfit ? "text-emerald-400" : "text-rose-400")}>
                          {isProfit ? "+" : ""}{pnlUsd.toFixed(2)} USDT
                        </div>
                        <div className={clsx("text-[10px] font-bold font-mono", isProfit ? "text-emerald-300" : "text-rose-300")}>
                          ROE: {isProfit ? "+" : ""}{roePct.toFixed(2)}%
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex flex-col gap-1.5 items-end">
                          {/* PRIMARY: Close at Market (uses live PnL) */}
                          <button
                            onClick={() => closeTrade(t.id, "CLOSED_MARKET", pnlUsd)}
                            className={clsx(
                              "rounded-lg px-3 py-1.5 text-[11px] font-black transition-all border shadow-md w-full",
                              isProfit
                                ? "bg-emerald-500 text-slate-950 border-emerald-400 hover:bg-emerald-400 shadow-emerald-500/20"
                                : "bg-rose-500 text-slate-950 border-rose-400 hover:bg-rose-400 shadow-rose-500/20"
                            )}
                          >
                            ✕ Cerrar a Mercado &nbsp;
                            <span className="font-mono">
                              ({isProfit ? "+" : ""}{pnlUsd.toFixed(2)} $)
                            </span>
                          </button>

                          {/* SECONDARY: Quick close at TP / SL targets */}
                          <div className="flex gap-1">
                            <button
                              onClick={() => closeTrade(t.id, "CLOSED_TP1")}
                              className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                              title={`Cerrar como si TP1 fuera alcanzado (+${t.tp1Pct}%)`}
                            >
                              TP1 +{t.tp1Pct}%
                            </button>
                            <button
                              onClick={() => closeTrade(t.id, "CLOSED_TP2")}
                              className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                              title={`Cerrar como si TP2 fuera alcanzado (+${t.tp2Pct}%)`}
                            >
                              TP2 +{t.tp2Pct}%
                            </button>
                            <button
                              onClick={() => closeTrade(t.id, "CLOSED_SL")}
                              className="rounded bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/25 transition-colors"
                              title={`Cerrar como si SL fuera tocado (-${t.slPct}%)`}
                            >
                              SL -{t.slPct}%
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="overflow-x-auto">
            {closedTrades.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Sin historial de cierres aún.</p>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase font-bold">
                    <th className="py-2">Símbolo / Dir.</th>
                    <th className="py-2">Entrada</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">PnL Realizado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {closedTrades.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 font-bold text-slate-200">{t.symbol} {t.direction} {t.leverage}x</td>
                      <td className="py-2 text-slate-400">${t.entryPrice}</td>
                      <td className="py-2 text-slate-400">{t.status}</td>
                      <td className={clsx("py-2 text-right font-bold", t.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {t.pnlUsd >= 0 ? "+" : ""}${t.pnlUsd.toFixed(2)} USD ({t.roePct >= 0 ? "+" : ""}{t.roePct.toFixed(1)}% ROE)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "assets" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-2 text-xs font-mono">
            <div className="rounded bg-slate-950 p-3 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-bold">Saldo Inicial</span>
              <span className="text-slate-200 font-bold">$10,000.00 USD</span>
            </div>
            <div className="rounded bg-slate-950 p-3 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-bold">Saldo Actual</span>
              <span className="text-emerald-400 font-bold">${balance.toFixed(2)} USD</span>
            </div>
            <div className="rounded bg-slate-950 p-3 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-bold">PnL Neto Total</span>
              <span className={clsx("font-bold", netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} USD
              </span>
            </div>
            <div className="rounded bg-slate-950 p-3 border border-slate-800">
              <span className="block text-[10px] text-slate-500 uppercase font-bold">Win-Rate (%)</span>
              <span className="text-amber-300 font-bold">{winRate.toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
