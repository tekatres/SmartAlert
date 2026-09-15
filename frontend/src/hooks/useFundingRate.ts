import { useState, useEffect } from "react";

export interface FundingInfo {
  rate: number;       // e.g. 0.0001 = 0.01%
  rateStr: string;    // e.g. "+0.0100%"
  countdown: string;  // e.g. "03:42:15"
  nextTime: Date;
}

function getNextFunding(): Date {
  const now = new Date();
  const utcH = now.getUTCHours();
  let nextH: number;
  if (utcH < 8) nextH = 8;
  else if (utcH < 16) nextH = 16;
  else nextH = 24; // 00:00 next day

  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    nextH % 24,
    0, 0, 0
  ));
  if (nextH === 24) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function useFundingRate(symbol: string): FundingInfo {
  const [rate, setRate] = useState<number>(0.0001);
  const [countdown, setCountdown] = useState<string>("--:--:--");
  const [nextTime, setNextTime] = useState<Date>(getNextFunding);

  // Fetch real funding rate from Binance
  useEffect(() => {
    let cancelled = false;
    const fetchRate = async () => {
      try {
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol.toUpperCase()}USDT`;
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data && data.lastFundingRate !== undefined) {
          setRate(parseFloat(data.lastFundingRate));
        }
      } catch {
        // ignore, use default
      }
    };

    fetchRate();
    const interval = setInterval(fetchRate, 60_000); // refresh every minute
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  // Countdown ticker
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      let next = nextTime;
      if (now >= next) {
        next = getNextFunding();
        setNextTime(next);
      }
      setCountdown(formatCountdown(next.getTime() - now.getTime()));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextTime]);

  const pct = rate * 100;
  const rateStr = `${pct >= 0 ? "+" : ""}${pct.toFixed(4)}%`;

  return { rate, rateStr, countdown, nextTime };
}
