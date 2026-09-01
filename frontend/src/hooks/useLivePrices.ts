import { useState, useEffect, useRef } from "react";

/**
 * Subscribes to Binance Futures WebSockets (wss://fstream.binance.com/ws)
 * for sub-second instantaneous PnL & Mark Price streaming with REST fallback.
 */
export function useLivePrices(symbols: string[], _intervalMs = 1000) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  // 1) Initial REST fetch for instant display before WebSocket opens
  const fetchPricesREST = async () => {
    if (symbols.length === 0) return;
    try {
      const res = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex");
      if (!res.ok) return;
      const data: Array<{ symbol: string; markPrice: string }> = await res.json();
      const symbolSet = new Set(symbols.map((s) => `${s}USDT`));
      const updated: Record<string, number> = {};
      for (const item of data) {
        if (symbolSet.has(item.symbol)) {
          const sym = item.symbol.replace("USDT", "");
          updated[sym] = parseFloat(item.markPrice);
        }
      }
      setPrices((prev) => ({ ...prev, ...updated }));
    } catch {
      // Ignore REST fallback errors
    }
  };

  useEffect(() => {
    if (symbols.length === 0) return;

    // Fetch initial snapshot immediately
    fetchPricesREST();

    // 2) Connect to Binance Futures Combined Stream WebSocket
    // Stream format: <symbol>usdt@ticker for real-time sub-second price ticks
    const streams = symbols
      .map((s) => `${s.toLowerCase()}usdt@ticker`)
      .join("/");
    const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg && msg.data && msg.data.s && msg.data.c) {
          const rawSymbol: string = msg.data.s; // e.g. "BTCUSDT"
          const lastPrice = parseFloat(msg.data.c); // Last price float
          if (rawSymbol.endsWith("USDT")) {
            const sym = rawSymbol.replace("USDT", "");
            setPrices((prev) => {
              if (prev[sym] === lastPrice) return prev;
              return { ...prev, [sym]: lastPrice };
            });
          }
        }
      } catch {
        // Ignore message parse errors
      }
    };

    ws.onerror = () => {
      // Fallback to REST polling if WebSocket has issues
      fetchPricesREST();
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  return prices;
}
