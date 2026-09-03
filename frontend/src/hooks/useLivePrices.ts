import { useState, useEffect, useRef } from "react";

/**
 * Subscribes to Binance Futures WebSockets (wss://fstream.binance.com/ws)
 * for sub-second instantaneous PnL & Mark Price streaming with REST fallback.
 */
export function useLivePrices(symbols: string[], intervalMs = 1500) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  // 1) REST Fetching for instant backup
  const fetchPricesREST = async () => {
    if (symbols.length === 0) return;
    try {
      const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/price");
      if (!res.ok) return;
      const data: Array<{ symbol: string; price: string }> = await res.json();
      const symbolSet = new Set(symbols.map((s) => `${s}USDT`));
      const updated: Record<string, number> = {};
      for (const item of data) {
        if (symbolSet.has(item.symbol)) {
          const sym = item.symbol.replace("USDT", "");
          updated[sym] = parseFloat(item.price);
        }
      }
      setPrices((prev) => ({ ...prev, ...updated }));
    } catch {
      // Ignore REST fallback errors
    }
  };

  useEffect(() => {
    if (symbols.length === 0) return;

    // Initial snapshot
    fetchPricesREST();

    // 2) Active WebSocket connection
    const streams = symbols
      .map((s) => `${s.toLowerCase()}usdt@ticker`)
      .join("/");
    const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg && msg.data && msg.data.s && (msg.data.c || msg.data.p)) {
          const rawSymbol: string = msg.data.s; // e.g. "BTCUSDT"
          const lastPrice = parseFloat(msg.data.c || msg.data.p); // Last close price
          if (rawSymbol.endsWith("USDT") && !isNaN(lastPrice)) {
            const sym = rawSymbol.replace("USDT", "");
            setPrices((prev) => ({ ...prev, [sym]: lastPrice }));
          }
        }
      } catch {
        // Ignore message parse errors
      }
    };

    // 3) Polling interval as robust backup in case WebSocket drops or pauses
    const intervalTimer = setInterval(() => {
      fetchPricesREST();
    }, intervalMs);

    return () => {
      clearInterval(intervalTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(","), intervalMs]);

  return prices;
}
