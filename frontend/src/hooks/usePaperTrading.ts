import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/services/firebase";
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

interface AccountState {
  balance: number;
  trades: PaperTrade[];
}

function loadLocal(): AccountState {
  try {
    const savedB = localStorage.getItem(STORAGE_KEY_BALANCE);
    const savedT = localStorage.getItem(STORAGE_KEY_TRADES);
    const balance = savedB ? parseFloat(savedB) : INITIAL_BALANCE;
    const trades = savedT ? (JSON.parse(savedT) as PaperTrade[]) : [];
    return { balance: isNaN(balance) ? INITIAL_BALANCE : balance, trades };
  } catch {
    return { balance: INITIAL_BALANCE, trades: [] };
  }
}

function persistLocal(state: AccountState) {
  localStorage.setItem(STORAGE_KEY_BALANCE, state.balance.toString());
  localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(state.trades));
}

function accountSignature(state: AccountState) {
  return JSON.stringify(state);
}

export function usePaperTrading() {
  const [account, setAccount] = useState<AccountState>(loadLocal);
  const [ready, setReady] = useState(false);

  const sourceRef = useRef<"local" | "cloud">("local");
  const uidRef = useRef<string | null>(null);
  const lastPersistedRef = useRef<string>("");
  const unsubCloudRef = useRef<(() => void) | null>(null);

  // ---- auth + cloud sync subscription ----
  useEffect(() => {
    let cancelled = false;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (cancelled) return;
      uidRef.current = u?.uid ?? null;

      if (unsubCloudRef.current) {
        unsubCloudRef.current();
        unsubCloudRef.current = null;
      }

      if (!u) {
        setReady(false);
        sourceRef.current = "local";
        setAccount(loadLocal());
        setReady(true);
        return;
      }

      setReady(false);
      const ref = doc(db, "users", u.uid, "paper", "account");
      unsubCloudRef.current = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data();
            const cloudAccount = {
              balance: typeof data.balance === "number" ? data.balance : INITIAL_BALANCE,
              trades: Array.isArray(data.trades) ? (data.trades as PaperTrade[]) : [],
            };
            setAccount(cloudAccount);
            persistLocal(cloudAccount); // Mirror cloud account to local storage for offline continuity
          } else {
            // First time on this account: seed the cloud doc with local data.
            const local = loadLocal();
            setAccount(local);
            lastPersistedRef.current = accountSignature(local);
            setDoc(ref, { ...local, updated_at: serverTimestamp() }).catch((err) =>
              console.warn("[usePaperTrading] seed write failed:", err.code)
            );
          }
          sourceRef.current = "cloud";
          setReady(true);
        },
        (err) => {
          console.warn("[usePaperTrading] snapshot error:", err.code);
          sourceRef.current = "local";
          setAccount(loadLocal());
          setReady(true);
        }
      );
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (unsubCloudRef.current) unsubCloudRef.current();
    };
  }, []);

  // ---- persist changes to the active source (cloud if signed in, else localStorage) ----
  useEffect(() => {
    if (!ready) return;
    const sig = accountSignature(account);
    if (sig === lastPersistedRef.current) return;
    lastPersistedRef.current = sig;

    // Always mirror to localStorage synchronously
    persistLocal(account);

    if (sourceRef.current === "cloud" && uidRef.current) {
      setDoc(
        doc(db, "users", uidRef.current, "paper", "account"),
        { balance: account.balance, trades: account.trades, updated_at: serverTimestamp() }
      ).catch((err) => {
        console.warn("[usePaperTrading] write failed:", err.code);
        lastPersistedRef.current = "";
      });
    }
  }, [account, ready]);

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

    setAccount((prev) => ({
      balance: prev.balance - marginUsd,
      trades: [newTrade, ...prev.trades],
    }));
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
    setAccount((prev) => {
      const trade = prev.trades.find((t) => t.id === tradeId);
      if (!trade) return prev;

      let profitUsd = 0;
      let roePct = 0;

      if (outcome === "CLOSED_MARKET" && livePnlUsd !== undefined) {
        // Close at real live price PnL
        profitUsd = livePnlUsd;
        roePct = (livePnlUsd / trade.marginUsd) * 100;
      } else if (outcome === "CLOSED_TP1") {
        roePct = trade.tp1Pct * trade.leverage * 0.5;
        profitUsd = trade.positionUsd * (trade.tp1Pct / 100) * 0.5;
      } else if (outcome === "CLOSED_TP2") {
        roePct = trade.tp2Pct * trade.leverage;
        profitUsd = trade.positionUsd * (trade.tp2Pct / 100);
      } else if (outcome === "CLOSED_SL") {
        roePct = -trade.slPct * trade.leverage;
        profitUsd = -trade.positionUsd * (trade.slPct / 100);
      } else {
        roePct = 1.0 * trade.leverage;
        profitUsd = trade.positionUsd * 0.01;
      }

      const closed: PaperTrade = {
        ...trade,
        status: outcome === "CLOSED_MARKET" ? "CLOSED_MANUAL" : outcome,
        pnlUsd: profitUsd,
        roePct,
        closedAt: new Date().toISOString(),
      };

      return {
        balance: prev.balance + trade.marginUsd + profitUsd,
        trades: prev.trades.map((t) => (t.id === tradeId ? closed : t)),
      };
    });
  };

  const resetAccount = () => {
    localStorage.removeItem(STORAGE_KEY_BALANCE);
    localStorage.removeItem(STORAGE_KEY_TRADES);
    setAccount({ balance: INITIAL_BALANCE, trades: [] });
  };

  const { balance, trades } = account;
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
