import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/services/firebase";
import { TradingSignalDoc } from "@/types";

export type MarginMode = "ISOLATED" | "CROSS";
export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT";
export type TradeStatus = "OPEN" | "CLOSED_TP1" | "CLOSED_TP2" | "CLOSED_SL" | "CLOSED_MANUAL";
export type PendingOrderStatus = "PENDING" | "FILLED" | "CANCELLED";

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
  status: TradeStatus;
  pnlUsd: number;
  roePct: number;
  createdAt: string;
  closedAt?: string;
  fee: number; // paid in USDT
}

export interface PendingOrder {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  orderType: "LIMIT" | "STOP_MARKET" | "STOP_LIMIT";
  marginMode: MarginMode;
  triggerPrice: number;  // price at which order executes
  limitPrice?: number;   // for STOP_LIMIT: limit price after trigger
  marginUsd: number;
  leverage: number;
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  signalId?: string;
  status: PendingOrderStatus;
  createdAt: string;
  filledAt?: string;
}

const STORAGE_KEY_BALANCE = "smartalert_binance_paper_balance";
const STORAGE_KEY_TRADES = "smartalert_binance_paper_trades";
const STORAGE_KEY_PENDING = "smartalert_binance_paper_pending";
const INITIAL_BALANCE = 10000;

const TAKER_FEE = 0.0004; // 0.04%
const MAKER_FEE = 0.0002; // 0.02%

interface AccountState {
  balance: number;
  trades: PaperTrade[];
  pendingOrders: PendingOrder[];
}

function loadLocal(): AccountState {
  try {
    const savedB = localStorage.getItem(STORAGE_KEY_BALANCE);
    const savedT = localStorage.getItem(STORAGE_KEY_TRADES);
    const savedP = localStorage.getItem(STORAGE_KEY_PENDING);
    const balance = savedB ? parseFloat(savedB) : INITIAL_BALANCE;
    const trades = savedT ? (JSON.parse(savedT) as PaperTrade[]) : [];
    const pendingOrders = savedP ? (JSON.parse(savedP) as PendingOrder[]) : [];
    return { balance: isNaN(balance) ? INITIAL_BALANCE : balance, trades, pendingOrders };
  } catch {
    return { balance: INITIAL_BALANCE, trades: [], pendingOrders: [] };
  }
}

function persistLocal(state: AccountState) {
  localStorage.setItem(STORAGE_KEY_BALANCE, state.balance.toString());
  localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(state.trades));
  localStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(state.pendingOrders));
}

function accountSignature(state: AccountState) {
  return JSON.stringify(state);
}

function computeLiqPrice(
  direction: "LONG" | "SHORT",
  entryPrice: number,
  leverage: number,
  mmr = 0.005
): number {
  return direction === "LONG"
    ? entryPrice * (1 - 1 / leverage + mmr)
    : entryPrice * (1 + 1 / leverage - mmr);
}

export interface AccountStats {
  winRate: number;
  netPnl: number;
  maxDrawdown: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
  totalFees: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
}

export function usePaperTrading() {
  const [account, setAccount] = useState<AccountState>(loadLocal);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "local">("local");

  const sourceRef = useRef<"local" | "cloud">("local");
  const uidRef = useRef<string | null>(null);
  const lastPersistedRef = useRef<string>("");
  const unsubCloudRef = useRef<(() => void) | null>(null);

  // Immediately push current account state to Firestore
  const forceSyncToCloud = async (stateOverride?: AccountState) => {
    const uid = uidRef.current;
    if (!uid) return false;
    const state = stateOverride ?? account;
    setSyncStatus("syncing");
    try {
      await setDoc(
        doc(db, "users", uid, "paper", "account"),
        {
          balance: state.balance,
          trades: state.trades,
          pendingOrders: state.pendingOrders,
          updated_at: serverTimestamp(),
        }
      );
      persistLocal(state);
      lastPersistedRef.current = accountSignature(state);
      setSyncStatus("synced");
      return true;
    } catch (err: unknown) {
      console.warn("[usePaperTrading] force sync failed:", err);
      setSyncStatus("local");
      return false;
    }
  };

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
            const cloudAccount: AccountState = {
              balance: typeof data.balance === "number" ? data.balance : INITIAL_BALANCE,
              trades: Array.isArray(data.trades) ? (data.trades as PaperTrade[]) : [],
              pendingOrders: Array.isArray(data.pendingOrders)
                ? (data.pendingOrders as PendingOrder[])
                : [],
            };
            setAccount(cloudAccount);
            persistLocal(cloudAccount);
            setSyncStatus("synced");
          } else {
            const local = loadLocal();
            setAccount(local);
            lastPersistedRef.current = accountSignature(local);
            setSyncStatus("syncing");
            setDoc(ref, { ...local, updated_at: serverTimestamp() })
              .then(() => setSyncStatus("synced"))
              .catch((err) => {
                console.warn("[usePaperTrading] seed write failed:", err.code);
                setSyncStatus("local");
              });
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

  // ---- persist changes ----
  useEffect(() => {
    if (!ready) return;
    const sig = accountSignature(account);
    if (sig === lastPersistedRef.current) return;
    lastPersistedRef.current = sig;

    persistLocal(account);

    if (sourceRef.current === "cloud" && uidRef.current) {
      setDoc(
        doc(db, "users", uidRef.current, "paper", "account"),
        {
          balance: account.balance,
          trades: account.trades,
          pendingOrders: account.pendingOrders,
          updated_at: serverTimestamp(),
        }
      ).catch((err) => {
        console.warn("[usePaperTrading] write failed:", err.code);
        lastPersistedRef.current = "";
      });
    }
  }, [account, ready]);

  // ---- Auto-fill pending limit orders when price reaches trigger ----
  // Call this from the simulator with live prices
  const checkAndFillPendingOrders = (livePrices: Record<string, number>) => {
    setAccount((prev) => {
      const toFill: PendingOrder[] = [];
      const updatedPending: PendingOrder[] = prev.pendingOrders.map((o) => {
        if (o.status !== "PENDING") return o;
        const lp = livePrices[o.symbol];
        if (lp === undefined) return o;

        // Check trigger condition
        const triggered =
          o.direction === "LONG"
            ? lp <= o.triggerPrice
            : lp >= o.triggerPrice;

        if (triggered) {
          toFill.push(o);
          return { ...o, status: "FILLED" as const, filledAt: new Date().toISOString() };
        }
        return o;
      });

      if (toFill.length === 0) return prev;

      let { balance } = prev;
      const newTrades: PaperTrade[] = [];

      for (const o of toFill) {
        const lp = livePrices[o.symbol] ?? o.triggerPrice;
        const entryPrice = o.orderType === "LIMIT" ? o.triggerPrice : lp;
        const positionUsd = o.marginUsd * o.leverage;
        const quantityCoins = entryPrice > 0 ? positionUsd / entryPrice : 0;
        const liqPrice = computeLiqPrice(o.direction, entryPrice, o.leverage);
        const fee = positionUsd * MAKER_FEE;

        const isLong = o.direction === "LONG";
        const slPrice = isLong
          ? entryPrice * (1 - o.slPct / 100)
          : entryPrice * (1 + o.slPct / 100);
        const tp1Price = isLong
          ? entryPrice * (1 + o.tp1Pct / 100)
          : entryPrice * (1 - o.tp1Pct / 100);
        const tp2Price = isLong
          ? entryPrice * (1 + o.tp2Pct / 100)
          : entryPrice * (1 - o.tp2Pct / 100);

        newTrades.push({
          id: `binance_trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          signalId: o.signalId,
          symbol: o.symbol,
          direction: o.direction,
          orderType: o.orderType,
          marginMode: o.marginMode,
          entryPrice,
          stopLoss: slPrice,
          tp1: tp1Price,
          tp2: tp2Price,
          leverage: o.leverage,
          marginUsd: o.marginUsd,
          positionUsd,
          quantityCoins,
          liqPrice: Math.max(0, parseFloat(liqPrice.toFixed(4))),
          slPct: o.slPct,
          tp1Pct: o.tp1Pct,
          tp2Pct: o.tp2Pct,
          status: "OPEN",
          pnlUsd: 0,
          roePct: 0,
          fee,
          createdAt: new Date().toISOString(),
        });
        // Deduct margin (already deducted when placing pending order, so noop)
        // Fee is deducted separately
        balance -= fee;
      }

      return {
        balance,
        trades: [...newTrades, ...prev.trades],
        pendingOrders: updatedPending,
      };
    });
  };

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
    const {
      symbol, direction, orderType, marginMode, entryPrice,
      marginUsd, leverage, slPct, tp1Pct, tp2Pct, signalId,
    } = params;

    // For limit/stop orders, create a pending order instead
    if (orderType === "LIMIT" || orderType === "STOP_MARKET" || orderType === "STOP_LIMIT") {
      const pendingOrder: PendingOrder = {
        id: `pending_${Date.now()}`,
        symbol,
        direction,
        orderType,
        marginMode,
        triggerPrice: entryPrice,
        marginUsd,
        leverage,
        slPct,
        tp1Pct,
        tp2Pct,
        signalId,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };

      setAccount((prev) => {
        const next: AccountState = {
          balance: prev.balance - marginUsd, // reserve margin
          trades: prev.trades,
          pendingOrders: [pendingOrder, ...prev.pendingOrders],
        };
        const uid = uidRef.current;
        if (uid) {
          setSyncStatus("syncing");
          setDoc(doc(db, "users", uid, "paper", "account"), {
            ...next,
            updated_at: serverTimestamp(),
          })
            .then(() => { persistLocal(next); setSyncStatus("synced"); })
            .catch(() => { persistLocal(next); setSyncStatus("local"); });
        } else {
          persistLocal(next);
        }
        return next;
      });
      return;
    }

    // MARKET order — immediate fill
    const positionUsd = marginUsd * leverage;
    const quantityCoins = entryPrice > 0 ? positionUsd / entryPrice : 0;
    const liqPrice = computeLiqPrice(direction, entryPrice, leverage);
    const fee = positionUsd * TAKER_FEE;

    const isLong = direction === "LONG";
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
      fee,
      createdAt: new Date().toISOString(),
    };

    setAccount((prev) => {
      const next: AccountState = {
        balance: prev.balance - marginUsd - fee,
        trades: [newTrade, ...prev.trades],
        pendingOrders: prev.pendingOrders,
      };
      const uid = uidRef.current;
      if (uid) {
        setSyncStatus("syncing");
        setDoc(doc(db, "users", uid, "paper", "account"), {
          ...next,
          updated_at: serverTimestamp(),
        })
          .then(() => { persistLocal(next); setSyncStatus("synced"); })
          .catch(() => { persistLocal(next); setSyncStatus("local"); });
      } else {
        persistLocal(next);
      }
      return next;
    });
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

  const closeTrade = (
    tradeId: string,
    outcome: "CLOSED_TP1" | "CLOSED_TP2" | "CLOSED_SL" | "CLOSED_MANUAL" | "CLOSED_MARKET",
    livePnlUsd?: number
  ) => {
    setAccount((prev) => {
      const trade = prev.trades.find((t) => t.id === tradeId);
      if (!trade) return prev;

      let profitUsd = 0;
      let roePct = 0;

      if (outcome === "CLOSED_MARKET" && livePnlUsd !== undefined) {
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

      const closeFee = trade.positionUsd * TAKER_FEE;
      const netPnl = profitUsd - closeFee;

      const closed: PaperTrade = {
        ...trade,
        status: outcome === "CLOSED_MARKET" ? "CLOSED_MANUAL" : outcome,
        pnlUsd: netPnl,
        roePct,
        fee: (trade.fee ?? 0) + closeFee,
        closedAt: new Date().toISOString(),
      };

      return {
        ...prev,
        balance: prev.balance + trade.marginUsd + netPnl,
        trades: prev.trades.map((t) => (t.id === tradeId ? closed : t)),
      };
    });
  };

<<<<<<< HEAD
  /** Close a percentage of a position (25%, 50%, 75%) */
  const closePartial = (tradeId: string, pct: number, livePrice: number) => {
    setAccount((prev) => {
      const trade = prev.trades.find((t) => t.id === tradeId);
      if (!trade || trade.status !== "OPEN") return prev;

      const fraction = pct / 100;
      const partialPositionUsd = trade.positionUsd * fraction;
      const partialMarginUsd = trade.marginUsd * fraction;
      const priceDiff =
        trade.direction === "LONG"
          ? livePrice - trade.entryPrice
          : trade.entryPrice - livePrice;
      const rawPnl = (priceDiff / trade.entryPrice) * partialPositionUsd;
      const fee = partialPositionUsd * TAKER_FEE;
      const netPnl = rawPnl - fee;
      const roePct = (netPnl / partialMarginUsd) * 100;

      // If closing 100%, fully close the trade
      if (pct >= 100) {
        const closed: PaperTrade = {
          ...trade,
          status: "CLOSED_MANUAL",
          pnlUsd: netPnl,
          roePct,
          closedAt: new Date().toISOString(),
        };
        return {
          ...prev,
          balance: prev.balance + partialMarginUsd + netPnl,
          trades: prev.trades.map((t) => (t.id === tradeId ? closed : t)),
        };
      }

      // Partial close: reduce position size
      const remaining = 1 - fraction;
      const updated: PaperTrade = {
        ...trade,
        marginUsd: trade.marginUsd * remaining,
        positionUsd: trade.positionUsd * remaining,
        quantityCoins: trade.quantityCoins * remaining,
      };

      return {
        ...prev,
        balance: prev.balance + partialMarginUsd + netPnl,
        trades: prev.trades.map((t) => (t.id === tradeId ? updated : t)),
      };
    });
  };

  const updateTradeStopLoss = (tradeId: string, newStopLoss: number) => {
    setAccount((prev) => {
      const trade = prev.trades.find((t) => t.id === tradeId);
      if (!trade) return prev;
      const updated: PaperTrade = {
        ...trade,
        stopLoss: newStopLoss,
      };
      return {
        ...prev,
        trades: prev.trades.map((t) => (t.id === tradeId ? updated : t)),
      };
    });
  };

  const cancelPendingOrder = (orderId: string) => {
    setAccount((prev) => {
      const order = prev.pendingOrders.find((o) => o.id === orderId);
      if (!order || order.status !== "PENDING") return prev;

      return {
        ...prev,
        balance: prev.balance + order.marginUsd, // refund reserved margin
        pendingOrders: prev.pendingOrders.map((o) =>
          o.id === orderId ? { ...o, status: "CANCELLED" as const } : o
        ),
      };
    });
  };
  const resetAccount = () => {
    localStorage.removeItem(STORAGE_KEY_BALANCE);
    localStorage.removeItem(STORAGE_KEY_TRADES);
    localStorage.removeItem(STORAGE_KEY_PENDING);
    setAccount({ balance: INITIAL_BALANCE, trades: [], pendingOrders: [] });
  };

  // ---- Derived stats ----
  const { balance, trades, pendingOrders } = account;
  const closedTrades = trades.filter((t) => t.status !== "OPEN");
  const winTrades = closedTrades.filter((t) => t.pnlUsd > 0);
  const lossTrades = closedTrades.filter((t) => t.pnlUsd <= 0);
  const winRate = closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0;
  const netPnl = balance - INITIAL_BALANCE;

  const totalWinPnl = winTrades.reduce((a, t) => a + t.pnlUsd, 0);
  const totalLossPnl = Math.abs(lossTrades.reduce((a, t) => a + t.pnlUsd, 0));
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0;
  const bestTrade = closedTrades.reduce((best, t) => Math.max(best, t.pnlUsd), 0);
  const worstTrade = closedTrades.reduce((worst, t) => Math.min(worst, t.pnlUsd), 0);
  const totalFees = trades.reduce((a, t) => a + (t.fee ?? 0), 0);
  const avgWin = winTrades.length > 0 ? totalWinPnl / winTrades.length : 0;
  const avgLoss = lossTrades.length > 0 ? -totalLossPnl / lossTrades.length : 0;

  // Max drawdown — simple peak-to-trough on balance
  let maxDrawdown = 0;
  let peak = INITIAL_BALANCE;
  let runningBalance = INITIAL_BALANCE;
  for (const t of [...trades].reverse()) {
    if (t.status !== "OPEN") {
      runningBalance += t.pnlUsd + t.marginUsd;
      peak = Math.max(peak, runningBalance);
      const dd = (peak - runningBalance) / peak * 100;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }
  }

  const stats: AccountStats = {
    winRate,
    netPnl,
    maxDrawdown,
    profitFactor,
    bestTrade,
    worstTrade,
    totalFees,
    avgWin,
    avgLoss,
    totalTrades: closedTrades.length,
    totalWins: winTrades.length,
    totalLosses: lossTrades.length,
  };

  return {
    balance,
    trades,
    pendingOrders,
    openTrade,
    openTradeParams,
    closeTrade,
    closePartial,
    updateTradeStopLoss,
    cancelPendingOrder,
    checkAndFillPendingOrders,
    resetAccount,
    forceSyncToCloud,
    syncStatus,
    winRate,
    netPnl,
    stats,
  };
}
