import { useState, useEffect, useRef } from "react";

/** Fetches live mark prices for a list of symbols from Binance Futures REST API every `intervalMs` ms. */
export function useLivePrices(symbols: string[], intervalMs = 3000) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrices = async () => {
    if (symbols.length === 0) return;
    try {
      // Binance Futures mark price endpoint — public, no key needed
      const url = "https://fapi.binance.com/fapi/v1/premiumIndex";
      const res = await fetch(url);
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
      // Silently ignore fetch errors — prices will stay at last known value
    }
  };

  useEffect(() => {
    if (symbols.length === 0) return;
    fetchPrices();
    timerRef.current = setInterval(fetchPrices, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(","), intervalMs]);

  return prices;
}
