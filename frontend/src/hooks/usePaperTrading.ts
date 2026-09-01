import { useState, useEffect } from "react";
import { TradingSignalDoc } from "@/types";

export interface PaperTrade {
  id: string;
  signalId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  leverage: number;
  marginUsd: number;
  positionUsd: number;
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  status: "OPEN" | "CLOSED_TP1" | "CLOSED_TP2" | "CLOSED_SL" | "CLOSED_MANUAL";
  pnlUsd: number;
  pnlPct: number;
  createdAt: string;
  closedAt?: string;
}

const STORAGE_KEY_BALANCE = "smartalert_paper_balance";
const STORAGE_KEY_TRADES = "smartalert_paper_trades";
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

  const openTrade = (signal: TradingSignalDoc, marginUsd: number) => {
    const leverage = Math.min(10, signal.leverage);
    const positionUsd = marginUsd * leverage;
    const newTrade: PaperTrade = {
      id: `paper_${Date.now()}`,
      signalId: signal.id,
      symbol: signal.symbol,
      direction: signal.direction === "SHORT" ? "SHORT" : "LONG",
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss,
      tp1: signal.take_profit_1,
      tp2: signal.take_profit_2,
      leverage,
      marginUsd,
      positionUsd,
      slPct: signal.sl_pct,
      tp1Pct: signal.tp1_pct,
      tp2Pct: signal.tp2_pct,
      status: "OPEN",
      pnlUsd: 0,
      pnlPct: 0,
      createdAt: new Date().toISOString(),
    };

    setTrades((prev) => [newTrade, ...prev]);
    setBalance((prev) => prev - marginUsd);
  };

  const closeTrade = (tradeId: string, outcome: "CLOSED_TP1" | "CLOSED_TP2" | "CLOSED_SL" | "CLOSED_MANUAL") => {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== tradeId) return t;

        let profitUsd = 0;
        let pnlPct = 0;

        if (outcome === "CLOSED_TP1") {
          pnlPct = t.tp1Pct;
          profitUsd = t.positionUsd * (t.tp1Pct / 100) * 0.5; // 50% closed
        } else if (outcome === "CLOSED_TP2") {
          pnlPct = t.tp2Pct;
          profitUsd = t.positionUsd * (t.tp2Pct / 100);
        } else if (outcome === "CLOSED_SL") {
          pnlPct = -t.slPct;
          profitUsd = -t.positionUsd * (t.slPct / 100);
        } else {
          // Manual close at breakeven / small gain
          pnlPct = 0.5;
          profitUsd = t.positionUsd * 0.005;
        }

        const returnTotal = t.marginUsd + profitUsd;
        setBalance((b) => b + returnTotal);

        return {
          ...t,
          status: outcome,
          pnlUsd: profitUsd,
          pnlPct,
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

  const totalTrades = trades.length;
  const closedTrades = trades.filter((t) => t.status !== "OPEN");
  const winTrades = closedTrades.filter((t) => t.pnlUsd > 0);
  const winRate = closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0;
  const netPnl = balance - INITIAL_BALANCE;

  return {
    balance,
    trades,
    openTrade,
    closeTrade,
    resetAccount,
    totalTrades,
    winRate,
    netPnl,
  };
}
