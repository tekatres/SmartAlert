import { useState, useMemo, useEffect, useRef } from "react";
import { TradingSignalDoc } from "@/types";
import { usePaperTrading, MarginMode, OrderType, PaperTrade, PendingOrder } from "@/hooks/usePaperTrading";
import { TradingViewChart } from "@/components/TradingViewChart";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useTickerData } from "@/hooks/useTickerData";
import { useFundingRate } from "@/hooks/useFundingRate";
import { clsx } from "clsx";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, dec = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtPrice = (n: number) => {
  if (n >= 10000) return fmt(n, 1);
  if (n >= 100) return fmt(n, 2);
  if (n >= 1) return fmt(n, 3);
  return fmt(n, 4);
};

const fmtCompact = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
};

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Animated order book row */
function OBRow({
  price,
  qty,
  total,
  maxTotal,
  side,
}: {
  price: number;
  qty: number;
  total: number;
  maxTotal: number;
  side: "ask" | "bid";
}) {
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  return (
    <div className="relative flex items-center justify-between px-2 py-[3px] text-[11px] font-mono hover:bg-white/5 transition-colors cursor-default group">
      <div
        className={clsx(
          "absolute inset-0 transition-all duration-300",
          side === "ask" ? "bg-rose-500/10" : "bg-emerald-500/10"
        )}
        style={{ width: `${pct}%`, ...(side === "ask" ? { right: 0, left: "auto" } : { left: 0 }) }}
      />
      <span className={side === "ask" ? "text-rose-400 z-10" : "text-emerald-400 z-10"}>
        {fmtPrice(price)}
      </span>
      <span className="text-slate-400 z-10">{qty.toFixed(3)}</span>
      <span className="text-slate-500 z-10 hidden group-hover:inline">{fmt(total, 0)}</span>
    </div>
  );
}

/** Quick % margin buttons */
function PctButton({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 rounded py-1 text-[10px] font-bold border transition-all",
        active
          ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
          : "bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300"
      )}
    >
      {label}
    </button>
  );
}

/** Stat card for account overview */
function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-950 p-3 border border-slate-800/80 space-y-0.5">
      <span className="block text-[9px] uppercase tracking-widest font-bold text-slate-500">
        {label}
      </span>
      <span className={clsx("block font-black text-sm font-mono leading-tight", color ?? "text-slate-200")}>
        {value}
      </span>
      {sub && <span className="block text-[10px] text-slate-500 font-mono">{sub}</span>}
    </div>
  );
}

// ─── Order Book ────────────────────────────────────────────────────────────────

function OrderBook({ markPrice, symbol }: { markPrice: number; symbol: string }) {
  const [levels] = useState(10);

  // Generate semi-realistic order book around mark price
  // In a real app you'd subscribe to depth WebSocket
  const asks = useMemo(() => {
    const rows = [];
    let cumTotal = 0;
    for (let i = 0; i < levels; i++) {
      const price = markPrice * (1 + 0.0002 * (i + 1) + Math.random() * 0.0001);
      const qty = (Math.random() * 5 + 0.1) * (levels - i) * 0.3;
      cumTotal += price * qty;
      rows.push({ price, qty, total: cumTotal });
    }
    return rows.reverse();
  }, [markPrice, levels]);

  const bids = useMemo(() => {
    const rows = [];
    let cumTotal = 0;
    for (let i = 0; i < levels; i++) {
      const price = markPrice * (1 - 0.0002 * (i + 1) - Math.random() * 0.0001);
      const qty = (Math.random() * 5 + 0.1) * (levels - i) * 0.3;
      cumTotal += price * qty;
      rows.push({ price, qty, total: cumTotal });
    }
    return rows;
  }, [markPrice, levels]);

  const maxAskTotal = asks[asks.length - 1]?.total ?? 1;
  const maxBidTotal = bids[bids.length - 1]?.total ?? 1;
  const spread = asks[asks.length - 1] && bids[0]
    ? asks[asks.length - 1].price - bids[0].price
    : 0;
  const spreadPct = markPrice > 0 ? (spread / markPrice) * 100 : 0;

  return (
    <div className="h-full flex flex-col font-mono text-[11px]">
      {/* Header */}
      <div className="flex justify-between px-2 py-1.5 text-[9px] uppercase font-bold text-slate-500 border-b border-slate-800">
        <span>Precio ({symbol}USDT)</span>
        <span>Cantidad</span>
      </div>

      {/* Asks */}
      <div className="flex flex-col-reverse overflow-hidden flex-1">
        {asks.map((row, i) => (
          <OBRow key={i} {...row} maxTotal={maxAskTotal} side="ask" />
        ))}
      </div>

      {/* Spread */}
      <div className="py-1.5 text-center border-y border-slate-800 bg-slate-950/80">
        <span className="text-emerald-400 font-black text-sm">${fmtPrice(markPrice)}</span>
        <span className="ml-2 text-[9px] text-slate-500">
          Spread: ${spread.toFixed(2)} ({spreadPct.toFixed(3)}%)
        </span>
      </div>

      {/* Bids */}
      <div className="flex flex-col overflow-hidden flex-1">
        {bids.map((row, i) => (
          <OBRow key={i} {...row} maxTotal={maxBidTotal} side="bid" />
        ))}
      </div>
    </div>
  );
}

// ─── Order Form ────────────────────────────────────────────────────────────────

interface OrderFormProps {
  symbol: string;
  markPrice: number;
  balance: number;
  onLong: (params: {
    orderType: OrderType;
    marginMode: MarginMode;
    entryPrice: number;
    marginUsd: number;
    leverage: number;
    slPct: number;
    tp1Pct: number;
    tp2Pct: number;
  }) => void;
  onShort: (params: {
    orderType: OrderType;
    marginMode: MarginMode;
    entryPrice: number;
    marginUsd: number;
    leverage: number;
    slPct: number;
    tp1Pct: number;
    tp2Pct: number;
  }) => void;
}

function OrderForm({ symbol, markPrice, balance, onLong, onShort }: OrderFormProps) {
  const [marginMode, setMarginMode] = useState<MarginMode>("ISOLATED");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [leverage, setLeverage] = useState(10);
  const [marginUsd, setMarginUsd] = useState(250);
  const [limitPrice, setLimitPrice] = useState(markPrice);
  const [slPct, setSlPct] = useState(2.5);
  const [tp1Pct, setTp1Pct] = useState(3.5);
  const [tp2Pct, setTp2Pct] = useState(7.0);
  const [tpSlEnabled, setTpSlEnabled] = useState(true);
  const [showLevSlider, setShowLevSlider] = useState(false);
  const [activeMarginPct, setActiveMarginPct] = useState<number | null>(null);

  // Keep limit price in sync with market price when switching to limit
  useEffect(() => {
    if (orderType === "LIMIT" || orderType === "STOP_MARKET" || orderType === "STOP_LIMIT") {
      setLimitPrice(markPrice);
    }
  }, [orderType, markPrice]);

  const execPrice = orderType === "MARKET" ? markPrice : limitPrice;
  const positionUsd = marginUsd * leverage;
  const quantityCoins = execPrice > 0 ? positionUsd / execPrice : 0;
  const mmr = 0.005;
  const longLiq = execPrice * (1 - 1 / leverage + mmr);
  const shortLiq = execPrice * (1 + 1 / leverage - mmr);
  const fee = positionUsd * (orderType === "MARKET" ? 0.0004 : 0.0002);

  const setMarginByPct = (pct: number) => {
    setActiveMarginPct(pct);
    setMarginUsd(Math.max(10, Math.floor(balance * (pct / 100))));
  };

  const getParams = () => ({
    orderType,
    marginMode,
    entryPrice: execPrice,
    marginUsd,
    leverage,
    slPct: tpSlEnabled ? slPct : 0,
    tp1Pct: tpSlEnabled ? tp1Pct : 0,
    tp2Pct: tpSlEnabled ? tp2Pct : 0,
  });

  const LEVERAGES = [1, 2, 3, 5, 10, 15, 20, 25, 50, 75, 100];

  return (
    <div className="p-4 space-y-3 h-full overflow-y-auto">
      {/* Margin Mode + Leverage */}
      <div className="flex gap-2">
        <button
          onClick={() => setMarginMode(marginMode === "ISOLATED" ? "CROSS" : "ISOLATED")}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 py-1.5 text-[11px] font-bold text-slate-300 hover:border-amber-500/60 transition-colors"
        >
          {marginMode === "ISOLATED" ? "⬡ Isolated" : "⬢ Cross"}
        </button>
        <button
          onClick={() => setShowLevSlider(!showLevSlider)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-amber-400 hover:border-amber-500/60 transition-colors"
        >
          <span className="font-mono">{leverage}x</span>
          <span className="text-slate-500 text-[9px]">▾</span>
        </button>
      </div>

      {/* Leverage preset grid */}
      {showLevSlider && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {LEVERAGES.map((lv) => (
              <button
                key={lv}
                onClick={() => { setLeverage(lv); setShowLevSlider(false); }}
                className={clsx(
                  "rounded py-1.5 text-[11px] font-black font-mono border transition-all",
                  leverage === lv
                    ? "bg-amber-500 text-slate-950 border-amber-400"
                    : "bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/50"
                )}
              >
                {lv}x
              </button>
            ))}
          </div>
          <input
            type="range" min="1" max="100" value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer"
          />
          {leverage >= 20 && (
            <p className="text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded p-2">
              ⚠️ Apalancamiento alto. Riesgo de liquidación elevado.
            </p>
          )}
        </div>
      )}

      {/* Order type tabs */}
      <div className="flex rounded-lg bg-[#0b0e14] p-0.5 border border-slate-800 text-[10px] font-bold">
        {(["MARKET", "LIMIT", "STOP_MARKET"] as OrderType[]).map((ot) => (
          <button
            key={ot}
            onClick={() => setOrderType(ot)}
            className={clsx(
              "flex-1 rounded py-1.5 transition-colors",
              orderType === ot
                ? "bg-amber-500 text-slate-950"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {ot === "MARKET" ? "Market" : ot === "LIMIT" ? "Limit" : "Stop"}
          </button>
        ))}
      </div>

      {/* Limit / Stop price input */}
      {(orderType === "LIMIT" || orderType === "STOP_MARKET" || orderType === "STOP_LIMIT") && (
        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
            {orderType === "LIMIT" ? "Precio Límite" : "Precio Trigger"} (USDT)
          </label>
          <div className="flex rounded-lg border border-slate-700 bg-[#0b0e14] overflow-hidden">
            <button
              onClick={() => setLimitPrice((p) => parseFloat((p * 0.999).toFixed(4)))}
              className="px-3 text-slate-400 hover:text-slate-200 font-black text-lg border-r border-slate-700 hover:bg-slate-800 transition-colors"
            >
              −
            </button>
            <input
              type="number" step="any" value={limitPrice}
              onChange={(e) => setLimitPrice(Number(e.target.value))}
              className="flex-1 bg-transparent px-3 py-1.5 font-mono text-xs text-slate-100 focus:outline-none text-center"
            />
            <button
              onClick={() => setLimitPrice((p) => parseFloat((p * 1.001).toFixed(4)))}
              className="px-3 text-slate-400 hover:text-slate-200 font-black text-lg border-l border-slate-700 hover:bg-slate-800 transition-colors"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Margin input */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-400 font-bold mb-1">
          <span>Margen (USDT)</span>
          <span className="text-slate-500">Disponible: <span className="text-slate-300 font-mono">${fmt(balance)}</span></span>
        </div>
        <div className="flex rounded-lg border border-slate-700 bg-[#0b0e14] overflow-hidden">
          <button
            onClick={() => setMarginUsd((v) => Math.max(10, v - 50))}
            className="px-3 text-slate-400 hover:text-slate-200 font-black text-lg border-r border-slate-700 hover:bg-slate-800 transition-colors"
          >
            −
          </button>
          <input
            type="number" step="10" value={marginUsd}
            onChange={(e) => { setMarginUsd(Math.max(10, Number(e.target.value))); setActiveMarginPct(null); }}
            className="flex-1 bg-transparent px-3 py-1.5 font-mono text-xs text-slate-100 focus:outline-none text-center"
          />
          <button
            onClick={() => setMarginUsd((v) => Math.min(balance, v + 50))}
            className="px-3 text-slate-400 hover:text-slate-200 font-black text-lg border-l border-slate-700 hover:bg-slate-800 transition-colors"
          >
            +
          </button>
        </div>
        <div className="flex gap-1 mt-1.5">
          {[10, 25, 50, 75, 100].map((pct) => (
            <PctButton
              key={pct}
              label={`${pct}%`}
              active={activeMarginPct === pct}
              onClick={() => setMarginByPct(pct)}
            />
          ))}
        </div>
      </div>

      {/* TP/SL Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-slate-400">TP / SL</span>
        <button
          onClick={() => setTpSlEnabled(!tpSlEnabled)}
          className={clsx(
            "relative w-9 h-5 rounded-full border transition-all",
            tpSlEnabled ? "bg-emerald-500 border-emerald-400" : "bg-slate-700 border-slate-600"
          )}
        >
          <span
            className={clsx(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
              tpSlEnabled ? "left-4" : "left-0.5"
            )}
          />
        </button>
      </div>

      {tpSlEnabled && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[9px] uppercase font-bold text-emerald-500 mb-1">TP1 %</label>
              <input
                type="number" step="0.5" min="0.5" value={tp1Pct}
                onChange={(e) => setTp1Pct(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-emerald-300 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[9px] uppercase font-bold text-emerald-400 mb-1">TP2 %</label>
              <input
                type="number" step="0.5" min="0.5" value={tp2Pct}
                onChange={(e) => setTp2Pct(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-emerald-300 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[9px] uppercase font-bold text-rose-500 mb-1">SL %</label>
              <input
                type="number" step="0.5" min="0.1" value={slPct}
                onChange={(e) => setSlPct(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-rose-300 focus:border-rose-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Order Preview */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[11px] font-mono space-y-1.5">
        <div className="flex justify-between">
          <span className="text-slate-500">Tamaño Posición</span>
          <span className="text-slate-200 font-bold">${fmt(positionUsd)} USD</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Cantidad</span>
          <span className="text-amber-300 font-bold">{quantityCoins.toFixed(4)} {symbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Precio {orderType === "MARKET" ? "Mark" : "Orden"}</span>
          <span className="text-slate-200">${fmtPrice(execPrice)}</span>
        </div>
        <div className="border-t border-slate-900 pt-1 mt-1 space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Liq. LONG</span>
            <span className="text-rose-400 font-bold">${fmtPrice(longLiq)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Liq. SHORT</span>
            <span className="text-rose-400 font-bold">${fmtPrice(shortLiq)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Fee Est.</span>
            <span className="text-slate-400">${fee.toFixed(3)} USDT ({orderType === "MARKET" ? "0.04%" : "0.02%"})</span>
          </div>
        </div>
      </div>

      {/* Execute buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={() => onLong(getParams())}
          className="rounded-xl bg-emerald-500 py-3.5 text-xs font-black text-slate-950 hover:bg-emerald-400 active:scale-95 transition-all shadow-lg shadow-emerald-500/20"
        >
          <div>↑ Buy / Long</div>
          <div className="text-[10px] font-bold opacity-80 mt-0.5">
            {leverage}x · ${fmt(positionUsd, 0)}
          </div>
        </button>
        <button
          onClick={() => onShort(getParams())}
          className="rounded-xl bg-rose-500 py-3.5 text-xs font-black text-slate-950 hover:bg-rose-400 active:scale-95 transition-all shadow-lg shadow-rose-500/20"
        >
          <div>↓ Sell / Short</div>
          <div className="text-[10px] font-bold opacity-80 mt-0.5">
            {leverage}x · ${fmt(positionUsd, 0)}
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function BinanceFuturesSimulator({ signals }: { signals: TradingSignalDoc[] }) {
  const {
    balance, trades, pendingOrders,
    openTradeParams, closeTrade, closePartial, cancelPendingOrder,
    checkAndFillPendingOrders, resetAccount, syncStatus, stats,
  } = usePaperTrading();

  const [symbol, setSymbol] = useState<string>(signals.length > 0 ? signals[0].symbol : "BTC");
  const [activeTab, setActiveTab] = useState<"positions" | "pending" | "history" | "assets">("positions");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Live price data
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const liveSymbols = useMemo(() => {
    const syms = new Set<string>([symbol]);
    openTrades.forEach((t) => syms.add(t.symbol));
    pendingOrders.filter((o) => o.status === "PENDING").forEach((o) => syms.add(o.symbol));
    const sigSymbols = signals.slice(0, 8).map((s) => s.symbol);
    sigSymbols.forEach((s) => syms.add(s));
    ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"].forEach((s) => syms.add(s));
    return Array.from(syms);
  }, [symbol, openTrades.length, pendingOrders.length, signals.length]);

  const livePrices = useLivePrices(liveSymbols, 2000);
  const tickers = useTickerData(liveSymbols.slice(0, 10));
  const funding = useFundingRate(symbol);

  const activeSignal = signals.find((s) => s.symbol === symbol);
  const staticFallback = activeSignal
    ? activeSignal.entry_price
    : symbol === "BTC" ? 77950 : symbol === "ETH" ? 2445 : 102;
  const markPrice = livePrices[symbol] ?? staticFallback;
  const ticker24h = tickers[symbol];

  // Auto-fill pending limit orders
  const livePricesRef = useRef(livePrices);
  useEffect(() => { livePricesRef.current = livePrices; }, [livePrices]);
  useEffect(() => {
    const id = setInterval(() => {
      checkAndFillPendingOrders(livePricesRef.current);
    }, 2500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slPct = activeSignal ? activeSignal.sl_pct : 2.5;
  const tp1Pct = activeSignal ? activeSignal.tp1_pct : 3.5;
  const tp2Pct = activeSignal ? activeSignal.tp2_pct : 7.0;

  const handleOrder = (direction: "LONG" | "SHORT") => (params: {
    orderType: OrderType;
    marginMode: MarginMode;
    entryPrice: number;
    marginUsd: number;
    leverage: number;
    slPct: number;
    tp1Pct: number;
    tp2Pct: number;
  }) => {
    openTradeParams({
      symbol,
      direction,
      signalId: activeSignal?.id,
      ...params,
    });
  };

  const calcUnrealizedPnl = (t: PaperTrade) => {
    const livePrice = livePrices[t.symbol] ?? t.entryPrice;
    const priceDiff =
      t.direction === "LONG" ? livePrice - t.entryPrice : t.entryPrice - livePrice;
    const pnlUsd = (priceDiff / t.entryPrice) * t.positionUsd;
    const roePct = (pnlUsd / t.marginUsd) * 100;
    return { livePrice, pnlUsd, roePct };
  };

  // Symbols ribbon
  const ribbonSymbols = useMemo(() => {
    const fromSignals = signals.map((s) => s.symbol);
    const defaults = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LINK", "AVAX", "DOT"];
    return Array.from(new Set([...fromSignals, ...defaults])).slice(0, 20);
  }, [signals]);

  const changeColor =
    ticker24h
      ? ticker24h.priceChangePercent >= 0 ? "text-emerald-400" : "text-rose-400"
      : "text-slate-400";

  const totalUnrealizedPnl = openTrades.reduce((sum, t) => {
    const { pnlUsd } = calcUnrealizedPnl(t);
    return sum + pnlUsd;
  }, 0);

  const totalEquity = balance + totalUnrealizedPnl;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0b0e14] text-slate-100 shadow-2xl overflow-hidden font-sans">
      {/* ── TOP HEADER TICKER BAR ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0d1117] px-4 py-2.5 border-b border-slate-800/80">
        {/* Symbol + price */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/20">
              <span className="text-amber-400 font-black text-sm">⚡</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm text-slate-100">{symbol}USDT</span>
                <span className="text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  Perpetual
                </span>
              </div>
              <span className="text-[10px] text-slate-500">Futuros USD-M</span>
            </div>
          </div>

          <div className="font-mono">
            <div className="flex items-baseline gap-2">
              <span className={clsx("font-black text-xl", changeColor)}>
                ${fmtPrice(markPrice)}
              </span>
              {ticker24h && (
                <span className={clsx("text-xs font-bold", changeColor)}>
                  {ticker24h.priceChangePercent >= 0 ? "▲" : "▼"}{" "}
                  {Math.abs(ticker24h.priceChangePercent).toFixed(2)}%
                </span>
              )}
            </div>
          </div>

          {ticker24h && (
            <div className="hidden md:flex items-center gap-4 text-[11px] font-mono">
              <div>
                <span className="block text-[9px] uppercase text-slate-500 font-bold">24h High</span>
                <span className="text-slate-200 font-bold">${fmtPrice(ticker24h.highPrice)}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase text-slate-500 font-bold">24h Low</span>
                <span className="text-slate-200 font-bold">${fmtPrice(ticker24h.lowPrice)}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase text-slate-500 font-bold">Vol 24h</span>
                <span className="text-slate-300">${fmtCompact(ticker24h.quoteVolume)}</span>
              </div>
            </div>
          )}

          {/* Funding rate */}
          <div className="hidden lg:block text-[11px] font-mono">
            <span className="block text-[9px] uppercase text-slate-500 font-bold">Funding / Countdown</span>
            <span className={clsx("font-bold", funding.rate >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {funding.rateStr}
            </span>
            <span className="ml-1.5 text-slate-400">{funding.countdown}</span>
          </div>
        </div>

        {/* Account summary */}
        <div className="flex items-center gap-3 bg-slate-900/80 rounded-xl border border-slate-800 px-3 py-2">
          <div>
            <span className="block text-[9px] uppercase font-bold text-slate-500">Equity</span>
            <span className="font-mono text-xs font-black text-slate-100">
              ${fmt(totalEquity)} <span className="text-[9px] text-slate-400">USDT</span>
            </span>
          </div>
          <div className="w-px h-6 bg-slate-700" />
          <div>
            <span className="block text-[9px] uppercase font-bold text-slate-500">Balance</span>
            <span className="font-mono text-xs font-bold text-emerald-400">${fmt(balance)}</span>
          </div>
          <div className="w-px h-6 bg-slate-700" />
          <div>
            <span className="block text-[9px] uppercase font-bold text-slate-500">PnL No Real.</span>
            <span className={clsx("font-mono text-xs font-bold", totalUnrealizedPnl >= 0 ? "text-emerald-300" : "text-rose-400")}>
              {totalUnrealizedPnl >= 0 ? "+" : ""}${fmt(totalUnrealizedPnl)}
            </span>
          </div>
          <div className="w-px h-6 bg-slate-700" />
          <div className="flex items-center gap-1.5">
            <div className={clsx(
              "h-2 w-2 rounded-full",
              syncStatus === "synced" ? "bg-emerald-400" : syncStatus === "syncing" ? "bg-amber-400 animate-pulse" : "bg-slate-500"
            )} />
            <span className="text-[9px] text-slate-500 font-bold uppercase">
              {syncStatus === "synced" ? "Cloud" : syncStatus === "syncing" ? "Syncing..." : "Local"}
            </span>
          </div>
          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-[10px] text-slate-600 hover:text-rose-400 font-bold transition-colors ml-1"
            >
              Reset
            </button>
          ) : (
            <div className="flex gap-1">
              <button
                onClick={() => { resetAccount(); setShowResetConfirm(false); }}
                className="text-[10px] bg-rose-500/20 border border-rose-500/40 text-rose-300 rounded px-2 py-0.5 font-bold hover:bg-rose-500/30"
              >
                Confirmar
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-bold"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── SYMBOL RIBBON ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-[#0a0d13] px-3 py-1.5 border-b border-slate-800/60 overflow-x-auto">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 shrink-0 mr-1">
          Mercados:
        </span>
        {ribbonSymbols.map((sym) => {
          const tk = tickers[sym];
          const chg = tk?.priceChangePercent ?? 0;
          return (
            <button
              key={sym}
              onClick={() => setSymbol(sym)}
              className={clsx(
                "shrink-0 rounded px-2.5 py-1 text-[10px] font-bold border transition-all flex flex-col items-center min-w-[54px]",
                symbol === sym
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                  : "bg-transparent border-transparent text-slate-500 hover:border-slate-700 hover:text-slate-300"
              )}
            >
              <span className="font-black text-[11px]">{sym}</span>
              {tk && (
                <span className={clsx("text-[9px]", chg >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── MAIN GRID: Chart + OrderBook + OrderForm ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-0 bg-[#0b0e14]" style={{ minHeight: 540 }}>
        {/* Chart: 7 cols */}
        <div className="xl:col-span-7 border-b xl:border-b-0 xl:border-r border-slate-800">
          <TradingViewChart symbol={symbol} height={540} interval="60" />
        </div>

        {/* Order Book: 2 cols (hidden below xl) */}
        <div className="xl:col-span-2 xl:border-r border-slate-800 hidden xl:flex flex-col" style={{ height: 540 }}>
          <div className="px-2 py-1.5 border-b border-slate-800 bg-[#0d1117] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-slate-500">Order Book</span>
            <span className="text-[9px] text-slate-600 font-mono">10 niveles</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <OrderBook markPrice={markPrice} symbol={symbol} />
          </div>
        </div>

        {/* Order Form: 3 cols */}
        <div className="xl:col-span-3 bg-[#0d1117] border-t xl:border-t-0 border-slate-800" style={{ maxHeight: 540, overflowY: "auto" }}>
          <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-[#0d1117] z-10">
            <span className="text-[10px] font-bold uppercase text-slate-400">Colocar Orden</span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping opacity-75" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </div>
          </div>
          <OrderForm
            symbol={symbol}
            markPrice={markPrice}
            balance={balance}
            onLong={handleOrder("LONG")}
            onShort={handleOrder("SHORT")}
          />
        </div>
      </div>

      {/* ── BOTTOM TERMINAL ───────────────────────────────────────────────────── */}
      <div className="border-t border-slate-800 bg-[#0d1117]">
        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-slate-800 text-xs font-bold overflow-x-auto">
          {(["positions", "pending", "history", "assets"] as const).map((tab) => {
            const labels: Record<typeof tab, string> = {
              positions: `Posiciones (${openTrades.length})`,
              pending: `Órdenes Activas (${pendingOrders.filter((o) => o.status === "PENDING").length})`,
              history: `Historial (${trades.filter((t) => t.status !== "OPEN").length})`,
              assets: `Cuenta`,
            };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  "shrink-0 px-5 py-3 border-b-2 transition-colors",
                  activeTab === tab
                    ? "border-amber-400 text-amber-300 bg-amber-500/5"
                    : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/5"
                )}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* ── Positions Tab ── */}
        {activeTab === "positions" && (
          <div className="overflow-x-auto p-1">
            {openTrades.length === 0 ? (
              <div className="text-center py-12 text-slate-600">
                <div className="text-3xl mb-2">📊</div>
                <p className="text-sm font-bold">Sin posiciones abiertas</p>
                <p className="text-xs text-slate-700 mt-1">Usa el formulario de la derecha para abrir tu primera operación</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[9px] text-slate-500 uppercase font-bold">
                    <th className="py-2.5 px-3">Símbolo / Dir.</th>
                    <th className="py-2.5 px-2">Tamaño</th>
                    <th className="py-2.5 px-2">Entrada</th>
                    <th className="py-2.5 px-2">Mark</th>
                    <th className="py-2.5 px-2">Liq.</th>
                    <th className="py-2.5 px-2">TP1 / TP2 / SL</th>
                    <th className="py-2.5 px-2 text-emerald-500">PnL No Real. (ROE%)</th>
                    <th className="py-2.5 px-3 text-right">Cerrar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {openTrades.map((t) => {
                    const { livePrice, pnlUsd, roePct } = calcUnrealizedPnl(t);
                    const isProfit = pnlUsd >= 0;
                    return (
                      <tr key={t.id} className="hover:bg-white/3 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className={clsx(
                              "px-2 py-1 rounded-lg text-[10px] font-black border",
                              t.direction === "LONG"
                                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                            )}>
                              {t.direction === "LONG" ? "↑ LONG" : "↓ SHORT"}
                            </span>
                            <div>
                              <div className="font-black text-slate-200">{t.symbol}USDT</div>
                              <div className="text-[9px] text-slate-500">{t.leverage}x · {t.marginMode}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-slate-300">
                          <div className="font-bold">${fmt(t.positionUsd)}</div>
                          <div className="text-[9px] text-slate-500">{t.quantityCoins.toFixed(4)} {t.symbol}</div>
                        </td>
                        <td className="py-3 px-2 text-slate-300">${fmtPrice(t.entryPrice)}</td>
                        <td className="py-3 px-2">
                          <div className="font-bold text-amber-300">${fmtPrice(livePrice)}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                            <span className="text-[8px] text-emerald-400 font-bold">LIVE</span>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-rose-400 font-bold">${fmtPrice(t.liqPrice)}</td>
                        <td className="py-3 px-2">
                          <div className="text-[10px] space-y-0.5">
                            <div className="text-emerald-400">TP1: ${fmtPrice(t.tp1)} (+{t.tp1Pct}%)</div>
                            <div className="text-emerald-300">TP2: ${fmtPrice(t.tp2)} (+{t.tp2Pct}%)</div>
                            <div className="text-rose-400">SL: ${fmtPrice(t.stopLoss)} (-{t.slPct}%)</div>
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <div className={clsx(
                            "font-black text-sm font-mono transition-all duration-100",
                            isProfit ? "text-emerald-400" : "text-rose-400"
                          )}>
                            {isProfit ? "+" : ""}{fmt(pnlUsd)} USDT
                          </div>
                          <div className={clsx(
                            "text-[10px] font-bold",
                            isProfit ? "text-emerald-300" : "text-rose-300"
                          )}>
                            ROE: {isProfit ? "+" : ""}{roePct.toFixed(2)}%
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1 items-end min-w-[130px]">
                            {/* Market close */}
                            <button
                              onClick={() => closeTrade(t.id, "CLOSED_MARKET", pnlUsd)}
                              className={clsx(
                                "rounded-lg px-3 py-1.5 text-[10px] font-black transition-all border w-full text-center",
                                isProfit
                                  ? "bg-emerald-500 text-slate-950 border-emerald-400 hover:bg-emerald-400"
                                  : "bg-rose-500 text-slate-950 border-rose-400 hover:bg-rose-400"
                              )}
                            >
                              ✕ Mercado ({isProfit ? "+" : ""}{fmt(pnlUsd, 2)}$)
                            </button>
                            {/* Partial close */}
                            <div className="flex gap-1 w-full">
                              {[25, 50, 75].map((pct) => (
                                <button
                                  key={pct}
                                  onClick={() => closePartial(t.id, pct, livePrice)}
                                  className="flex-1 rounded bg-slate-800 border border-slate-700 px-1 py-1 text-[9px] font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                                  title={`Cerrar ${pct}% de la posición`}
                                >
                                  {pct}%
                                </button>
                              ))}
                            </div>
                            {/* TP/SL quick close */}
                            <div className="flex gap-1 w-full">
                              <button
                                onClick={() => closeTrade(t.id, "CLOSED_TP1")}
                                className="flex-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1 py-1 text-[9px] font-bold text-emerald-400 hover:bg-emerald-500/20"
                              >
                                TP1
                              </button>
                              <button
                                onClick={() => closeTrade(t.id, "CLOSED_TP2")}
                                className="flex-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1 py-1 text-[9px] font-bold text-emerald-300 hover:bg-emerald-500/20"
                              >
                                TP2
                              </button>
                              <button
                                onClick={() => closeTrade(t.id, "CLOSED_SL")}
                                className="flex-1 rounded bg-rose-500/10 border border-rose-500/20 px-1 py-1 text-[9px] font-bold text-rose-400 hover:bg-rose-500/20"
                              >
                                SL
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

        {/* ── Pending Orders Tab ── */}
        {activeTab === "pending" && (
          <div className="overflow-x-auto p-1">
            {pendingOrders.filter((o) => o.status === "PENDING").length === 0 ? (
              <div className="text-center py-12 text-slate-600">
                <div className="text-3xl mb-2">⏳</div>
                <p className="text-sm font-bold">Sin órdenes pendientes</p>
                <p className="text-xs text-slate-700 mt-1">Coloca una orden Limit o Stop para verla aquí</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[9px] text-slate-500 uppercase font-bold">
                    <th className="py-2.5 px-3">Símbolo</th>
                    <th className="py-2.5 px-2">Tipo</th>
                    <th className="py-2.5 px-2">Precio Trigger</th>
                    <th className="py-2.5 px-2">Mark Actual</th>
                    <th className="py-2.5 px-2">Margen</th>
                    <th className="py-2.5 px-2">Apalancamiento</th>
                    <th className="py-2.5 px-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {pendingOrders
                    .filter((o) => o.status === "PENDING")
                    .map((o: PendingOrder) => {
                      const lp = livePrices[o.symbol] ?? 0;
                      const distPct = lp > 0 ? ((o.triggerPrice - lp) / lp) * 100 : 0;
                      return (
                        <tr key={o.id} className="hover:bg-white/3 transition-colors">
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <span className={clsx(
                                "px-2 py-1 rounded text-[10px] font-black border",
                                o.direction === "LONG"
                                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                  : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                              )}>
                                {o.direction === "LONG" ? "↑ LONG" : "↓ SHORT"}
                              </span>
                              <span className="font-bold text-slate-200">{o.symbol}USDT</span>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <span className="bg-blue-500/10 border border-blue-500/30 text-blue-300 px-2 py-0.5 rounded text-[10px] font-bold">
                              {o.orderType}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-amber-300 font-bold">${fmtPrice(o.triggerPrice)}</td>
                          <td className="py-3 px-2">
                            <div className="text-slate-300">${lp > 0 ? fmtPrice(lp) : "--"}</div>
                            <div className={clsx(
                              "text-[9px] font-bold",
                              Math.abs(distPct) < 0.5 ? "text-amber-400" : "text-slate-500"
                            )}>
                              {distPct >= 0 ? "+" : ""}{distPct.toFixed(2)}% desde mark
                            </div>
                          </td>
                          <td className="py-3 px-2 text-slate-300 font-bold">${fmt(o.marginUsd)}</td>
                          <td className="py-3 px-2 text-amber-400 font-bold font-mono">{o.leverage}x</td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => cancelPendingOrder(o.id)}
                              className="rounded-lg px-3 py-1.5 text-[10px] font-black bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition-colors"
                            >
                              Cancelar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── History Tab ── */}
        {activeTab === "history" && (
          <div className="overflow-x-auto p-1">
            {trades.filter((t) => t.status !== "OPEN").length === 0 ? (
              <div className="text-center py-12 text-slate-600">
                <div className="text-3xl mb-2">📜</div>
                <p className="text-sm font-bold">Sin historial de operaciones</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[9px] text-slate-500 uppercase font-bold">
                    <th className="py-2.5 px-3">Símbolo / Dir.</th>
                    <th className="py-2.5 px-2">Entrada</th>
                    <th className="py-2.5 px-2">Tamaño</th>
                    <th className="py-2.5 px-2">Resultado</th>
                    <th className="py-2.5 px-2">Fee</th>
                    <th className="py-2.5 px-3 text-right">PnL Realizado (ROE%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {trades
                    .filter((t) => t.status !== "OPEN")
                    .map((t) => {
                      const isWin = t.pnlUsd >= 0;
                      const resultLabel: Record<string, string> = {
                        CLOSED_TP1: "TP1 ✓",
                        CLOSED_TP2: "TP2 ✓",
                        CLOSED_SL: "SL ✗",
                        CLOSED_MANUAL: "Manual",
                      };
                      return (
                        <tr key={t.id} className={clsx(
                          "hover:bg-white/3 transition-colors",
                          isWin ? "border-l-2 border-emerald-500/30" : "border-l-2 border-rose-500/30"
                        )}>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <span className={clsx(
                                "px-2 py-1 rounded text-[10px] font-black",
                                t.direction === "LONG"
                                  ? "bg-emerald-500/10 text-emerald-300"
                                  : "bg-rose-500/10 text-rose-300"
                              )}>
                                {t.direction === "LONG" ? "↑" : "↓"} {t.direction}
                              </span>
                              <div>
                                <div className="font-bold text-slate-200">{t.symbol}USDT</div>
                                <div className="text-[9px] text-slate-500">{t.leverage}x · {new Date(t.createdAt).toLocaleDateString()}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-slate-400">${fmtPrice(t.entryPrice)}</td>
                          <td className="py-3 px-2 text-slate-300">${fmt(t.positionUsd)}</td>
                          <td className="py-3 px-2">
                            <span className={clsx(
                              "px-2 py-1 rounded text-[10px] font-bold border",
                              isWin
                                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            )}>
                              {resultLabel[t.status] ?? t.status}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-slate-500">-${(t.fee ?? 0).toFixed(3)}</td>
                          <td className="py-3 px-3 text-right">
                            <div className={clsx(
                              "font-black text-sm",
                              isWin ? "text-emerald-400" : "text-rose-400"
                            )}>
                              {isWin ? "+" : ""}{fmt(t.pnlUsd)} USDT
                            </div>
                            <div className={clsx(
                              "text-[10px] font-bold",
                              isWin ? "text-emerald-300" : "text-rose-300"
                            )}>
                              ROE: {t.roePct >= 0 ? "+" : ""}{t.roePct.toFixed(2)}%
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

        {/* ── Assets / Account Stats Tab ── */}
        {activeTab === "assets" && (
          <div className="p-4 space-y-4">
            {/* Balance overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Balance Inicial"
                value="$10,000.00"
                color="text-slate-300"
              />
              <StatCard
                label="Balance Actual"
                value={`$${fmt(balance)}`}
                color="text-emerald-400"
              />
              <StatCard
                label="Equity Total"
                value={`$${fmt(totalEquity)}`}
                sub={`PnL no real.: ${totalUnrealizedPnl >= 0 ? "+" : ""}$${fmt(totalUnrealizedPnl)}`}
                color={totalEquity >= 10000 ? "text-emerald-400" : "text-rose-400"}
              />
              <StatCard
                label="PnL Neto Total"
                value={`${stats.netPnl >= 0 ? "+" : ""}$${fmt(stats.netPnl)}`}
                color={stats.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
              />
            </div>

            {/* Performance */}
            <div>
              <h3 className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-widest">
                Estadísticas de Rendimiento
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <StatCard
                  label="Win Rate"
                  value={`${stats.winRate.toFixed(1)}%`}
                  sub={`${stats.totalWins}W / ${stats.totalLosses}L`}
                  color={stats.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}
                />
                <StatCard
                  label="Profit Factor"
                  value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
                  color={stats.profitFactor >= 1 ? "text-emerald-400" : "text-rose-400"}
                />
                <StatCard
                  label="Max Drawdown"
                  value={`${stats.maxDrawdown.toFixed(2)}%`}
                  color={stats.maxDrawdown < 20 ? "text-amber-400" : "text-rose-400"}
                />
                <StatCard
                  label="Mejor Trade"
                  value={`+$${fmt(stats.bestTrade)}`}
                  color="text-emerald-400"
                />
                <StatCard
                  label="Peor Trade"
                  value={`$${fmt(stats.worstTrade)}`}
                  color="text-rose-400"
                />
                <StatCard
                  label="Fees Totales"
                  value={`-$${fmt(stats.totalFees)}`}
                  color="text-slate-400"
                />
                <StatCard
                  label="Avg Win"
                  value={`+$${fmt(stats.avgWin)}`}
                  color="text-emerald-300"
                />
                <StatCard
                  label="Avg Loss"
                  value={`-$${fmt(Math.abs(stats.avgLoss))}`}
                  color="text-rose-300"
                />
                <StatCard
                  label="Total Ops"
                  value={String(stats.totalTrades)}
                  color="text-slate-200"
                />
              </div>
            </div>

            {/* Equity bar */}
            {stats.totalTrades > 0 && (
              <div>
                <h3 className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-widest">
                  Distribución W/L
                </h3>
                <div className="flex rounded-full overflow-hidden h-3 bg-slate-800">
                  <div
                    className="bg-emerald-500 transition-all"
                    style={{ width: `${stats.winRate}%` }}
                  />
                  <div
                    className="bg-rose-500 transition-all"
                    style={{ width: `${100 - stats.winRate}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] mt-1 font-bold">
                  <span className="text-emerald-400">Win {stats.winRate.toFixed(1)}%</span>
                  <span className="text-rose-400">Loss {(100 - stats.winRate).toFixed(1)}%</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
