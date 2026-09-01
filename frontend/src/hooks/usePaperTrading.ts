import { useState, useEffect } from "react";
import { TradingSignalDoc } from "@/types";

export type MarginMode = "ISOLATED" | "CROSS";
export type OrderType = "MARKET" | "LIMIT";

export interface PaperTrade {
  id: string;
  signalId?: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  orderType: OrderType;
  marginMode: MarginMode;
  entryPrice: number;
  limitPrice?: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  leverage: number;
  marginUsd: number;
  positionUsd: number;
  quantityCoins: number;
  liqPrice: number;
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  status: "OPEN" | "CLOSED_TP1" | "CLOSED_TP2" | "CLOSED_SL" | "CLOSED_MANUAL";
  pnlUsd: number;
  roePct: number;
  createdAt: string;
  closedAt?: string;
}

const STORAGE_KEY_BALANCE = "smartalert_binance_paper_balance";
const STORAGE_KEY_TRADES = "smartalert_binance_paper_trades";
const INITIAL_BALANCE = 10000;

export function usePaperTrading() {
  const [balance, setBalance] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_BALANCE);
    return saved ? parseFloat(saved) : INITIAL_BALANCE;
  });

  const [trades, setTrades] = useState<PaperTrade[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TRADES);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BALANCE, balance.toString());
  }, [balance]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(trades));
  }, [trades]);

  const openTradeParams = (params: {
    symbol: string;
    direction: "LONG" | "SHORT";
    orderType: OrderType;
    marginMode: MarginMode;
    entryPrice: number;
    marginUsd: number;
    leverage: number;
    slPct: number;
    tp1Pct: number;
    tp2Pct: number;
    signalId?: string;
  }) => {
    const { symbol, direction, orderType, marginMode, entryPrice, marginUsd, leverage, slPct, tp1Pct, tp2Pct, signalId } = params;

    const positionUsd = marginUsd * leverage;
    const quantityCoins = entryPrice > 0 ? positionUsd / entryPrice : 0;

    // Estimate Binance Futures Liquidation Price
    // Long Liq = Entry * (1 - 1/Leverage + MaintenanceMarginRatio (~0.5%))
    // Short Liq = Entry * (1 + 1/Leverage - MaintenanceMarginRatio (~0.5%))
    const mmr = 0.005; // 0.5% MMR
    const isLong = direction === "LONG";
    const liqPrice = isLong
      ? entryPrice * (1 - 1 / leverage + mmr)
      : entryPrice * (1 + 1 / leverage - mmr);

    const slPrice = isLong ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
    const tp1Price = isLong ? entryPrice * (1 + tp1Pct / 100) : entryPrice * (1 - tp1Pct / 100);
    const tp2Price = isLong ? entryPrice * (1 + tp2Pct / 100) : entryPrice * (1 - tp2Pct / 100);

    const newTrade: PaperTrade = {
      id: `binance_trade_${Date.now()}`,
      signalId,
      symbol,
      direction,
      orderType,
      marginMode,
      entryPrice,
      stopLoss: slPrice,
      tp1: tp1Price,
      tp2: tp2Price,
      leverage,
      marginUsd,
      positionUsd,
      quantityCoins,
      liqPrice: Math.max(0, parseFloat(liqPrice.toFixed(4))),
      slPct,
      tp1Pct,
      tp2Pct,
      status: "OPEN",
      pnlUsd: 0,
      roePct: 0,
      createdAt: new Date().toISOString(),
    };

    setTrades((prev) => [newTrade, ...prev]);
    setBalance((prev) => prev - marginUsd);
  };

  const openTrade = (signal: TradingSignalDoc, marginUsd: number) => {
    openTradeParams({
      symbol: signal.symbol,
      direction: signal.direction === "SHORT" ? "SHORT" : "LONG",
      orderType: "MARKET",
      marginMode: "ISOLATED",
      entryPrice: signal.entry_price,
      marginUsd,
      leverage: Math.min(10, signal.leverage),
      slPct: signal.sl_pct,
      tp1Pct: signal.tp1_pct,
      tp2Pct: signal.tp2_pct,
      signalId: signal.id,
    });
  };

  const closeTrade = (tradeId: string, outcome: "CLOSED_TP1" | "CLOSED_TP2" | "CLOSED_SL" | "CLOSED_MANUAL" | "CLOSED_MARKET", livePnlUsd?: number) => {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== tradeId) return t;

        let profitUsd = 0;
        let roePct = 0;

        if (outcome === "CLOSED_MARKET" && livePnlUsd !== undefined) {
          // Close at real live price PnL
          profitUsd = livePnlUsd;
          roePct = (livePnlUsd / t.marginUsd) * 100;
        } else if (outcome === "CLOSED_TP1") {
          roePct = t.tp1Pct * t.leverage * 0.5;
          profitUsd = t.positionUsd * (t.tp1Pct / 100) * 0.5;
        } else if (outcome === "CLOSED_TP2") {
          roePct = t.tp2Pct * t.leverage;
          profitUsd = t.positionUsd * (t.tp2Pct / 100);
        } else if (outcome === "CLOSED_SL") {
          roePct = -t.slPct * t.leverage;
          profitUsd = -t.positionUsd * (t.slPct / 100);
        } else {
          roePct = 1.0 * t.leverage;
          profitUsd = t.positionUsd * 0.01;
        }

        const returnTotal = t.marginUsd + profitUsd;
        setBalance((b) => b + returnTotal);

        return {
          ...t,
          status: outcome === "CLOSED_MARKET" ? "CLOSED_MANUAL" : outcome,
          pnlUsd: profitUsd,
          roePct,
          closedAt: new Date().toISOString(),
        };
      })
    );
  };

  const resetAccount = () => {
    setBalance(INITIAL_BALANCE);
    setTrades([]);
    localStorage.removeItem(STORAGE_KEY_BALANCE);
    localStorage.removeItem(STORAGE_KEY_TRADES);
  };

  const closedTrades = trades.filter((t) => t.status !== "OPEN");
  const winTrades = closedTrades.filter((t) => t.pnlUsd > 0);
  const winRate = closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0;
  const netPnl = balance - INITIAL_BALANCE;

  return {
    balance,
    trades,
    openTrade,
    openTradeParams,
    closeTrade,
    resetAccount,
    winRate,
    netPnl,
  };
}
