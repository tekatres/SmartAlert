export interface BtcGuardData {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  strength: number; // 0-10
  price: number;
  ema50: number;
  rsi1h: number;
  rsi15m: number;
  priceChangePct: number;
  updatedAt: string;
}

function calcEMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d >= 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<number[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  const raw = await res.json();
  return raw.map((k: any) => parseFloat(k[4])); // closes
}

/**
 * Fetches Bitcoin's master health (15m + 1h) and returns the Beta Guard state.
 * Mirrors the signal engine: LONG / SHORT / NEUTRAL + strength 0-10.
 */
export async function fetchBtcGuard(): Promise<BtcGuardData> {
  const fallback = (): BtcGuardData => ({
    direction: "NEUTRAL",
    strength: 5,
    price: 0,
    ema50: 0,
    rsi1h: 50,
    rsi15m: 50,
    priceChangePct: 0,
    updatedAt: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
  });

  try {
    const [closes15m, closes1h] = await Promise.all([
      fetchKlines("BTCUSDT", "15m", 100),
      fetchKlines("BTCUSDT", "1h", 200),
    ]);

    const price = closes1h[closes1h.length - 1];
    const ema50 = calcEMA(closes1h, 50);
    const rsi1h = calcRSI(closes1h, 14);
    const rsi15m = calcRSI(closes15m, 14);
    const prevClose = closes1h[closes1h.length - 2] ?? price;
    const priceChangePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    let direction: BtcGuardData["direction"] = "NEUTRAL";
    let strength = 5;

    if (price > ema50 && rsi1h > 50 && rsi15m > 46) {
      direction = "LONG";
      strength = Math.min(10, Math.round(5 + (rsi1h - 50) / 5));
    } else if (price < ema50 && rsi1h < 50 && rsi15m < 54) {
      direction = "SHORT";
      strength = Math.min(10, Math.round(5 + (50 - rsi1h) / 5));
    }

    return {
      direction,
      strength,
      price,
      ema50,
      rsi1h,
      rsi15m,
      priceChangePct,
      updatedAt: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    };
  } catch (err) {
    console.warn("Could not fetch BTC guard:", err);
    return fallback();
  }
}