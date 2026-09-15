import { useState, useEffect, useRef } from "react";

export interface Ticker24h {
  lastPrice: number;
  priceChangePercent: number; // e.g. -1.23
  highPrice: number;
  lowPrice: number;
  volume: number;      // base volume
  quoteVolume: number; // quote (USDT) volume
  openInterest?: number;
}

/**
 * Streams Binance Futures 24h ticker for one or multiple symbols via WebSocket.
 * Falls back to REST every 30 seconds.
 */
export function useTickerData(symbols: string[]): Record<string, Ticker24h> {
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const fetchREST = async () => {
    if (symbols.length === 0) return;
    try {
      const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr");
      if (!res.ok) return;
      const data: Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        volume: string;
        quoteVolume: string;
      }> = await res.json();
      const symbolSet = new Set(symbols.map((s) => `${s.toUpperCase()}USDT`));
      const updated: Record<string, Ticker24h> = {};
      for (const item of data) {
        if (symbolSet.has(item.symbol)) {
          const sym = item.symbol.replace("USDT", "");
          updated[sym] = {
            lastPrice: parseFloat(item.lastPrice),
            priceChangePercent: parseFloat(item.priceChangePercent),
            highPrice: parseFloat(item.highPrice),
            lowPrice: parseFloat(item.lowPrice),
            volume: parseFloat(item.volume),
            quoteVolume: parseFloat(item.quoteVolume),
          };
        }
      }
      setTickers((prev) => ({ ...prev, ...updated }));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (symbols.length === 0) return;

    fetchREST();

    // Build WebSocket multi-stream URL
    const streams = symbols
      .map((s) => `${s.toLowerCase()}usdt@ticker`)
      .join("/");
    const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const d = msg?.data;
        if (d && d.s && d.e === "24hrTicker") {
          const sym = (d.s as string).replace("USDT", "");
          setTickers((prev) => ({
            ...prev,
            [sym]: {
              lastPrice: parseFloat(d.c),
              priceChangePercent: parseFloat(d.P),
              highPrice: parseFloat(d.h),
              lowPrice: parseFloat(d.l),
              volume: parseFloat(d.v),
              quoteVolume: parseFloat(d.q),
            },
          }));
        }
      } catch {
        // ignore
      }
    };

    // REST backup every 30s
    const timer = setInterval(fetchREST, 30_000);

    return () => {
      clearInterval(timer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  return tickers;
}
