import { doc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import { fetchWhaleFlow } from "./whaleTracker";
import { TradingSignalDoc } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import {
  computeRegimeGuard,
  detectLiquiditySweep,
  getMacroBlackout,
  LiquiditySweepResult,
  RegimeGuardResult,
} from "./marketFilters";

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOLS — 13 pairs available on Kraken Futures (PF_ linear perpetuals)
// Price data sourced from Binance Futures fapi (best liquidity & public API)
// ─────────────────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { coin_id: "bitcoin",            symbol: "BTC",  name: "Bitcoin",       binance: "BTCUSDT",  kraken: "PF_XBTUSD"  },
  { coin_id: "ethereum",           symbol: "ETH",  name: "Ethereum",      binance: "ETHUSDT",  kraken: "PF_ETHUSD"  },
  { coin_id: "solana",             symbol: "SOL",  name: "Solana",        binance: "SOLUSDT",  kraken: "PF_SOLUSD"  },
  { coin_id: "ripple",             symbol: "XRP",  name: "XRP",           binance: "XRPUSDT",  kraken: "PF_XRPUSD"  },
  { coin_id: "cardano",            symbol: "ADA",  name: "Cardano",       binance: "ADAUSDT",  kraken: "PF_ADAUSD"  },
  { coin_id: "dogecoin",           symbol: "DOGE", name: "Dogecoin",      binance: "DOGEUSDT", kraken: "PF_DOGEUSD" },
  { coin_id: "avalanche-2",        symbol: "AVAX", name: "Avalanche",     binance: "AVAXUSDT", kraken: "PF_AVAXUSD" },
  { coin_id: "chainlink",          symbol: "LINK", name: "Chainlink",     binance: "LINKUSDT", kraken: "PF_LINKUSD" },
  { coin_id: "near",               symbol: "NEAR", name: "NEAR Protocol", binance: "NEARUSDT", kraken: "PF_NEARUSD" },
  { coin_id: "optimism",           symbol: "OP",   name: "Optimism",      binance: "OPUSDT",   kraken: "PF_OPUSD"   },
  { coin_id: "arbitrum",           symbol: "ARB",  name: "Arbitrum",      binance: "ARBUSDT",  kraken: "PF_ARBUSD"  },
  { coin_id: "aptos",              symbol: "APT",  name: "Aptos",         binance: "APTUSDT",  kraken: "PF_APTUSDT" },
  { coin_id: "injective-protocol", symbol: "INJ",  name: "Injective",     binance: "INJUSDT",  kraken: "PF_INJUSD"  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function calcEMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calcEMASeries(values: number[], period: number): number[] {
  if (values.length < period) return values.map(() => values[0] || 0);
  const k = 2 / (period + 1);
  const result: number[] = new Array(period - 1).fill(NaN);
  result.push(values.slice(0, period).reduce((a, b) => a + b, 0) / period);
  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
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

/** Returns RSI series for divergence detection */
function calcRSISeries(closes: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(50);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d >= 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calcEMA(trs, period);
}

function calcMACD(closes: number[]): { macdLine: number; signalLine: number; hist: number; prevHist: number } {
  const ema12Series = calcEMASeries(closes, 12);
  const ema26Series = calcEMASeries(closes, 26);
  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const m = ema12Series[i], s = ema26Series[i];
    macdSeries.push(isNaN(m) || isNaN(s) ? 0 : m - s);
  }
  const signalSeries = calcEMASeries(macdSeries.filter(v => !isNaN(v)), 9);
  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];
  const prevMacd = macdSeries[macdSeries.length - 2] || 0;
  const prevSignal = signalSeries[signalSeries.length - 2] || 0;
  return {
    macdLine,
    signalLine,
    hist: macdLine - signalLine,
    prevHist: prevMacd - prevSignal,
  };
}

function calcVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  let totalPV = 0, totalV = 0;
  const n = Math.min(closes.length, 24);
  for (let i = closes.length - n; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    totalPV += tp * volumes[i];
    totalV += volumes[i];
  }
  return totalV > 0 ? totalPV / totalV : closes[closes.length - 1];
}

/** ADX — Average Directional Index (trend strength filter) */
function calcADX(highs: number[], lows: number[], closes: number[], period = 14): { adx: number; plusDI: number; minusDI: number } {
  if (closes.length < period * 2 + 1) return { adx: 0, plusDI: 0, minusDI: 0 };

  const plusDMs: number[] = [], minusDMs: number[] = [], trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }

  // Wilder smoothing (equivalent to EMA with period-based factor)
  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  const dxValues: number[] = [];

  for (let i = period; i < trs.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trs[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDMs[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDMs[i];
    const pDI = smoothTR > 0 ? (smoothPlus / smoothTR) * 100 : 0;
    const mDI = smoothTR > 0 ? (smoothMinus / smoothTR) * 100 : 0;
    const dxDenom = pDI + mDI;
    dxValues.push(dxDenom > 0 ? (Math.abs(pDI - mDI) / dxDenom) * 100 : 0);
  }

  const adx = calcEMA(dxValues, period);
  const lastTR = smoothTR > 0 ? smoothTR : 1;
  return {
    adx: parseFloat(adx.toFixed(2)),
    plusDI: parseFloat(((smoothPlus / lastTR) * 100).toFixed(2)),
    minusDI: parseFloat(((smoothMinus / lastTR) * 100).toFixed(2)),
  };
}

/** RSI Divergence — compares current price/RSI against a reference swing 8-28 bars ago */
function detectRSIDivergence(closes: number[], period = 14): "BULLISH" | "BEARISH" | "NONE" {
  if (closes.length < 35) return "NONE";
  const rsiSeries = calcRSISeries(closes, period);
  const n = closes.length;
  const rn = rsiSeries.length;

  const currentPrice = closes[n - 1];
  const currentRSI = rsiSeries[rn - 1];

  // Reference window: 8 to 28 bars ago — avoids recency bias, not too distant
  const refPrices = closes.slice(n - 28, n - 8);
  const refRSIs   = rsiSeries.slice(rn - 28, rn - 8);
  if (refPrices.length < 5) return "NONE";

  // Bullish divergence: current price near/at ref swing low but RSI is higher
  const refPriceLow = Math.min(...refPrices);
  const refLowIdx   = refPrices.indexOf(refPriceLow);
  const refRSIAtLow = refRSIs[refLowIdx] ?? 50;
  if (currentPrice <= refPriceLow * 1.03 && currentRSI > refRSIAtLow + 4 && currentRSI < 58) {
    return "BULLISH";
  }

  // Bearish divergence: current price near/at ref swing high but RSI is lower
  const refPriceHigh = Math.max(...refPrices);
  const refHighIdx   = refPrices.indexOf(refPriceHigh);
  const refRSIAtHigh = refRSIs[refHighIdx] ?? 50;
  if (currentPrice >= refPriceHigh * 0.97 && currentRSI < refRSIAtHigh - 4 && currentRSI > 42) {
    return "BEARISH";
  }

  return "NONE";
}

/** Bollinger Bands — returns band width and position of price */
function calcBollingerBands(
  closes: number[],
  period = 20,
  stdMult = 2
): { upper: number; middle: number; lower: number; bandwidth: number; isSqueeze: boolean; breakoutUp: boolean; breakoutDown: boolean } {
  if (closes.length < period) {
    const p = closes[closes.length - 1] || 0;
    return { upper: p, middle: p, lower: p, bandwidth: 0, isSqueeze: false, breakoutUp: false, breakoutDown: false };
  }
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + stdMult * std;
  const lower = mean - stdMult * std;
  const bandwidth = mean > 0 ? ((upper - lower) / mean) * 100 : 0;
  const currentPrice = closes[closes.length - 1];

  // Historical bandwidth for squeeze detection (prev 50 bars)
  const histSlice = closes.slice(-70, -20);
  let avgHistBW = bandwidth;
  if (histSlice.length >= period) {
    const hm = histSlice.slice(-period).reduce((a, b) => a + b, 0) / period;
    const hv = histSlice.slice(-period).reduce((a, b) => a + (b - hm) ** 2, 0) / period;
    const hStd = Math.sqrt(hv);
    avgHistBW = hm > 0 ? ((hm + stdMult * hStd - (hm - stdMult * hStd)) / hm) * 100 : bandwidth;
  }

  return {
    upper,
    middle: mean,
    lower,
    bandwidth,
    isSqueeze: bandwidth < avgHistBW * 0.7, // Current BW < 70% of historical avg
    breakoutUp: currentPrice > upper,
    breakoutDown: currentPrice < lower,
  };
}

/** Candlestick pattern detection on last 3 candles */
function detectCandlePattern(
  opens: number[], highs: number[], lows: number[], closes: number[]
): "HAMMER" | "SHOOTING_STAR" | "BULL_ENGULFING" | "BEAR_ENGULFING" | "NONE" {
  const n = closes.length;
  if (n < 3) return "NONE";

  const [o1, c1] = [opens[n - 2], closes[n - 2]]; // Previous candle
  const [o0, h0, l0, c0] = [opens[n - 1], highs[n - 1], lows[n - 1], closes[n - 1]]; // Last candle

  const body0 = Math.abs(c0 - o0);
  const body1 = Math.abs(c1 - o1);

  // Hammer: small body at top, long lower shadow (> 2x body), bearish candle before it
  const lowerShadow0 = Math.min(c0, o0) - l0;
  const upperShadow0 = h0 - Math.max(c0, o0);
  if (c1 < o1 && lowerShadow0 > 2 * body0 && upperShadow0 < body0 && c0 > o0) {
    return "HAMMER";
  }

  // Shooting Star: small body at bottom, long upper shadow (> 2x body), bullish candle before
  if (c1 > o1 && upperShadow0 > 2 * body0 && lowerShadow0 < body0 && c0 < o0) {
    return "SHOOTING_STAR";
  }

  // Bullish Engulfing: bearish prev candle, bullish current that fully engulfs prev
  if (c1 < o1 && c0 > o0 && c0 > o1 && o0 < c1 && body0 > body1) {
    return "BULL_ENGULFING";
  }

  // Bearish Engulfing: bullish prev, bearish current that fully engulfs prev
  if (c1 > o1 && c0 < o0 && c0 < o1 && o0 > c1 && body0 > body1) {
    return "BEAR_ENGULFING";
  }

  return "NONE";
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

async function fetchKlines(symbol: string, interval: string, limit = 200) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  const raw = await res.json();
  return raw.map((k: any) => ({
    time: k[0] as number,
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchFundingRate(symbol: string): Promise<number> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const raw = await res.json();
    return raw.length > 0 ? parseFloat(raw[0].fundingRate) : 0;
  } catch { return 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCANNER
// ─────────────────────────────────────────────────────────────────────────────

export async function scanLiveMarket(minConfluenceThreshold = 5): Promise<{ scannedCount: number; signalsFound: number; signals: TradingSignalDoc[] }> {
  let generatedCount = 0;
  const newSignals: TradingSignalDoc[] = [];
  const newAlerts: { id: string; data: any }[] = [];

  // ── PRE-FLIGHT: BTC BETA GUARD (EVALUATE BITCOIN MASTER HEALTH FIRST) ──
  let btcDirection: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let btcStrength = 5;
  const [macroBlackout, btcGuardState] = await Promise.all([
    getMacroBlackout(),
    (async (): Promise<{ direction: "LONG" | "SHORT" | "NEUTRAL"; strength: number }> => {
      try {
        const [btck15m, btck1h] = await Promise.all([
          fetchKlines("BTCUSDT", "15m", 50),
          fetchKlines("BTCUSDT", "1h", 100),
        ]);
        const btcCloses1h = btck1h.map((k: { close: number }) => k.close);
        const btcPrice = btcCloses1h[btcCloses1h.length - 1];
        const btcEma50 = calcEMA(btcCloses1h, 50);
        const btcRsi1h = calcRSI(btcCloses1h, 14);
        const btcRsi15m = calcRSI(btck15m.map((k: { close: number }) => k.close), 14);

        if (btcPrice > btcEma50 && btcRsi1h > 50 && btcRsi15m > 46) {
          return { direction: "LONG", strength: Math.min(10, Math.round(5 + (btcRsi1h - 50) / 5)) };
        }
        if (btcPrice < btcEma50 && btcRsi1h < 50 && btcRsi15m < 54) {
          return { direction: "SHORT", strength: Math.min(10, Math.round(5 + (50 - btcRsi1h) / 5)) };
        }
      } catch (err) {
        console.warn("Could not pre-evaluate BTC guard:", err);
      }
      return { direction: "NEUTRAL", strength: 5 };
    })(),
  ]);
  btcDirection = btcGuardState.direction;
  btcStrength = btcGuardState.strength;

  // ── PRE-FLIGHT: MACRO BLACKOUT (REFUGIO / NO OPERAR) ──
  // During high-impact macro events the engine enters shelter mode and emits
  // NO signals/alerts: institutional algos drain the books and wick both ways.
  if (macroBlackout.blocked) {
    console.warn(`[liveScanner] ${macroBlackout.explanation}`);
    return { scannedCount: 0, signalsFound: 0, signals: [] };
  }

  for (const item of SYMBOLS) {
    try {
      const [k15m, k1h, k4h, fundingRate, whaleFlow] = await Promise.all([
        fetchKlines(item.binance, "15m", 100),
        fetchKlines(item.binance, "1h", 200),
        fetchKlines(item.binance, "4h", 100),
        fetchFundingRate(item.binance),
        fetchWhaleFlow(item.binance),
      ]);

      // ── Extract series ──────────────────────────────────────────────────────
      const opens1h   = k1h.map((k: { open: number }) => k.open);
      const closes1h  = k1h.map((k: { close: number }) => k.close);
      const closes4h  = k4h.map((k: { close: number }) => k.close);
      const closes15m = k15m.map((k: { close: number }) => k.close);
      const highs15m  = k15m.map((k: { high: number }) => k.high);
      const lows15m   = k15m.map((k: { low: number }) => k.low);
      const volumes15m = k15m.map((k: { volume: number }) => k.volume);
      const highs1h   = k1h.map((k: { high: number }) => k.high);
      const lows1h    = k1h.map((k: { low: number }) => k.low);
      const volumes1h = k1h.map((k: { volume: number }) => k.volume);

      const currentPrice  = closes1h[closes1h.length - 1];
      const avgVol20      = volumes1h.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const currentVol    = volumes1h[volumes1h.length - 1];
      const volumeRatio   = avgVol20 > 0 ? parseFloat((currentVol / avgVol20).toFixed(2)) : 1.0;

      // ── Compute all indicators ──────────────────────────────────────────────
      const rsi1h    = calcRSI(closes1h, 14);
      const rsi15m   = calcRSI(closes15m, 14);
      const rsi4h    = calcRSI(closes4h, 14);
      const macd     = calcMACD(closes1h);
      const ema9     = calcEMA(closes1h, 9);
      const ema21    = calcEMA(closes1h, 21);
      const ema50    = calcEMA(closes1h, 50);
      const ema200   = calcEMA(closes1h, 200); // Institutional Trend Filter
      const ema50_4h = calcEMA(closes4h, 50);
      const vwap     = calcVWAP(highs1h, lows1h, closes1h, volumes1h);
      const atr1h    = calcATR(highs1h, lows1h, closes1h, 14);
      const atrPct   = (atr1h / currentPrice) * 100;
      const adx      = calcADX(highs1h, lows1h, closes1h, 14);
      const bb       = calcBollingerBands(closes1h, 20, 2);
      const rsiDiv   = detectRSIDivergence(closes1h, 14);
      const candlePat = detectCandlePattern(opens1h, highs1h, lows1h, closes1h);

      // ── 9 PILLARS EVALUATION MATRIX ────────────────────────────────────────
      const votes: Array<{ name: string; vote: "LONG" | "SHORT" | "NEUTRAL"; weight: number; value: number; explanation: string }> = [];
      let longScore = 0, shortScore = 0;

      // PILAR 1: Estructura de Mercado HH/HL vs LL/LH (weight 2)
      const last10H = highs1h.slice(-10), last10L = lows1h.slice(-10);
      const isHH = last10H[last10H.length - 1] >= Math.max(...last10H.slice(0, 5));
      const isHL = last10L[last10L.length - 1] >= Math.min(...last10L.slice(0, 5));
      const isLL = last10L[last10L.length - 1] <= Math.min(...last10L.slice(0, 5));
      const isLH = last10H[last10H.length - 1] <= Math.max(...last10H.slice(0, 5));
      if (isHH && isHL) {
        votes.push({ name: "1. Estructura HH/HL", vote: "LONG", weight: 2, value: currentPrice, explanation: `Estructura alcista confirmada: Máximos (${last10H[last10H.length - 1].toFixed(2)}) y Mínimos (${last10L[last10L.length - 1].toFixed(2)}) más altos.` });
        longScore += 2;
      } else if (isLL && isLH) {
        votes.push({ name: "1. Estructura LL/LH", vote: "SHORT", weight: 2, value: currentPrice, explanation: `Estructura bajista confirmada: Mínimos y Máximos decrecientes en el mercado.` });
        shortScore += 2;
      } else {
        votes.push({ name: "1. Estructura de Mercado", vote: "NEUTRAL", weight: 0, value: currentPrice, explanation: `Estructura mixta o indefinida en el rango reciente.` });
      }

      // PILAR 2: Tendencia Multitemporal EMA Ribbon + Filtro Institucional EMA200 (weight 2.5)
      const emaLong  = currentPrice > ema9 && ema9 > ema21 && ema21 > ema50;
      const emaShort = currentPrice < ema9 && ema9 < ema21 && ema21 < ema50;
      const aboveEma200 = currentPrice > ema200;
      if (emaLong && aboveEma200) {
        votes.push({ name: "2. Abanico EMA + EMA200", vote: "LONG", weight: 2.5, value: ema9, explanation: `Alineación alcista institucional: Precio > EMA9 > EMA21 > EMA50 y sobre EMA200 ($${ema200.toFixed(2)}).` });
        longScore += 2.5;
      } else if (emaLong) {
        votes.push({ name: "2. Abanico EMA", vote: "LONG", weight: 1.5, value: ema9, explanation: `Abanico alcista a corto plazo, testeando zona EMA200 ($${ema200.toFixed(2)}).` });
        longScore += 1.5;
      } else if (emaShort && !aboveEma200) {
        votes.push({ name: "2. Abanico EMA + EMA200", vote: "SHORT", weight: 2.5, value: ema9, explanation: `Alineación bajista institucional: Precio < EMA9 < EMA21 < EMA50 y bajo EMA200 ($${ema200.toFixed(2)}).` });
        shortScore += 2.5;
      } else if (emaShort) {
        votes.push({ name: "2. Abanico EMA", vote: "SHORT", weight: 1.5, value: ema9, explanation: `Abanico bajista a corto plazo, testeando zona EMA200 ($${ema200.toFixed(2)}).` });
        shortScore += 1.5;
      } else {
        votes.push({ name: "2. Abanico EMA", vote: "NEUTRAL", weight: 0.5, value: ema9, explanation: `EMAs comprimidas o cruzándose respecto a EMA200 ($${ema200.toFixed(2)}).` });
      }

      // PILAR 3: Volumen Relativo Institucional (weight 2)
      if (volumeRatio >= 1.25) {
        const volDir = closes1h[closes1h.length - 1] >= closes1h[closes1h.length - 2] ? "LONG" : "SHORT";
        votes.push({ name: "3. Volumen Institucional", vote: volDir, weight: 2, value: volumeRatio, explanation: `Pico de volumen ${volumeRatio}x sobre la media de 20 velas.` });
        if (volDir === "LONG") longScore += 2; else shortScore += 2;
      } else {
        votes.push({ name: "3. Volumen Relativo", vote: "NEUTRAL", weight: 0.5, value: volumeRatio, explanation: `Volumen normal (${volumeRatio}x vs media).` });
      }

      // PILAR 4: VWAP + Soporte/Resistencia Dinámica (weight 1.5)
      const vwapDistPct = parseFloat((((currentPrice - vwap) / vwap) * 100).toFixed(2));
      if (currentPrice > vwap * 1.002) {
        votes.push({ name: "4. VWAP & S/R Dinámico", vote: "LONG", weight: 1.5, value: vwap, explanation: `Precio ($${currentPrice.toFixed(2)}) por encima del VWAP ($${vwap.toFixed(2)}, +${vwapDistPct}%).` });
        longScore += 1.5;
      } else if (currentPrice < vwap * 0.998) {
        votes.push({ name: "4. VWAP & S/R Dinámico", vote: "SHORT", weight: 1.5, value: vwap, explanation: `Precio ($${currentPrice.toFixed(2)}) por debajo del VWAP ($${vwap.toFixed(2)}, ${vwapDistPct}%).` });
        shortScore += 1.5;
      } else {
        votes.push({ name: "4. VWAP", vote: "NEUTRAL", weight: 0.5, value: vwap, explanation: `Precio pegado al VWAP ($${vwap.toFixed(2)}).` });
      }

      // PILAR 5: Momentum MACD + RSI Multi-TF (weight 2)
      const macdBull = macd.hist > 0;
      const macdBear = macd.hist < 0;
      if (rsi1h > 50 && macdBull) {
        votes.push({ name: "5. Momentum MACD+RSI", vote: "LONG", weight: 2, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)} > 50) alcista y MACD positivo en expansión.` });
        longScore += 2;
      } else if (rsi1h < 50 && macdBear) {
        votes.push({ name: "5. Momentum MACD+RSI", vote: "SHORT", weight: 2, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)} < 50) bajista y MACD negativo en contracción.` });
        shortScore += 2;
      } else {
        votes.push({ name: "5. Momentum MACD+RSI", vote: "NEUTRAL", weight: 0.5, value: rsi1h, explanation: `Momentum divergente o neutro (RSI 1h=${rsi1h.toFixed(1)}, MACD Hist=${macd.hist.toFixed(4)}).` });
      }

      // PILAR 6: ADX — Fuerza de Tendencia (weight 1.5)
      if (adx.adx >= 20) {
        const adxDir = adx.plusDI > adx.minusDI ? "LONG" : "SHORT";
        votes.push({ name: "6. ADX Tendencia", vote: adxDir, weight: 1.5, value: adx.adx, explanation: `ADX ${adx.adx.toFixed(1)} ≥ 20. +DI ${adx.plusDI.toFixed(1)} vs -DI ${adx.minusDI.toFixed(1)}.` });
        if (adxDir === "LONG") longScore += 1.5; else shortScore += 1.5;
      } else {
        votes.push({ name: "6. ADX Tendencia Moderada", vote: "NEUTRAL", weight: 1, value: adx.adx, explanation: `ADX ${adx.adx.toFixed(1)}. Rango o tendencia en construcción.` });
      }

      // PILAR 7: Divergencia RSI (weight 3 cuando detectada)
      if (rsiDiv === "BULLISH") {
        votes.push({ name: "7. ⚡ Divergencia RSI Alcista", vote: "LONG", weight: 3, value: rsi1h, explanation: `Divergencia alcista detectada: precio en nuevo mínimo pero RSI en mínimo más alto.` });
        longScore += 3;
      } else if (rsiDiv === "BEARISH") {
        votes.push({ name: "7. ⚡ Divergencia RSI Bajista", vote: "SHORT", weight: 3, value: rsi1h, explanation: `Divergencia bajista detectada: precio en nuevo máximo pero RSI en máximo más bajo.` });
        shortScore += 3;
      } else {
        votes.push({ name: "7. Divergencia RSI", vote: "NEUTRAL", weight: 0, value: rsi1h, explanation: `Sin divergencia RSI activa.` });
      }

      // PILAR 8: Bollinger Bands B% Position (activo siempre, no solo en breakout)
      // B% = 0 → precio en banda inferior (sobreventa) | B% = 1 → banda superior (sobrecompra)
      const bPercent = (bb.upper > bb.lower) ? (currentPrice - bb.lower) / (bb.upper - bb.lower) : 0.5;
      if (bb.breakoutUp || bPercent >= 0.80) {
        votes.push({ name: "8. Bollinger Sobrecompra", vote: "SHORT", weight: 1.5, value: bPercent, explanation: `B%=${(bPercent * 100).toFixed(0)}% — precio en zona sobrecomprada (banda superior).` });
        shortScore += 1.5;
      } else if (bb.breakoutDown || bPercent <= 0.20) {
        votes.push({ name: "8. Bollinger Sobreventa", vote: "LONG", weight: 1.5, value: bPercent, explanation: `B%=${(bPercent * 100).toFixed(0)}% — precio en zona sobrevendida (banda inferior).` });
        longScore += 1.5;
      } else if (bPercent >= 0.65) {
        votes.push({ name: "8. Bollinger Presión Alta", vote: "SHORT", weight: 0.75, value: bPercent, explanation: `B%=${(bPercent * 100).toFixed(0)}% — precio en tercio superior, presión vendedora latente.` });
        shortScore += 0.75;
      } else if (bPercent <= 0.35) {
        votes.push({ name: "8. Bollinger Presión Baja", vote: "LONG", weight: 0.75, value: bPercent, explanation: `B%=${(bPercent * 100).toFixed(0)}% — precio en tercio inferior, posible soporte.` });
        longScore += 0.75;
      } else {
        votes.push({ name: "8. Bollinger Bands", vote: "NEUTRAL", weight: 0, value: bPercent, explanation: `B%=${(bPercent * 100).toFixed(0)}% — precio en zona central neutra.` });
      }

      // PILAR 9: Patrón de Velas + Funding Rate (weight 1.5)
      let candleVote: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
      let candleExplanation = `Sin patrón de velas extremo.`;
      if (candlePat === "HAMMER" || candlePat === "BULL_ENGULFING") {
        candleVote = "LONG";
        candleExplanation = `Patrón ${candlePat === "HAMMER" ? "Martillo" : "Envolvente Alcista"} detectado.`;
        longScore += 1.5;
      } else if (candlePat === "SHOOTING_STAR" || candlePat === "BEAR_ENGULFING") {
        candleVote = "SHORT";
        candleExplanation = `Patrón ${candlePat === "SHOOTING_STAR" ? "Estrella Fugaz" : "Envolvente Bajista"} detectado.`;
        shortScore += 1.5;
      }
      votes.push({ name: `9. Velas+Funding`, vote: candleVote, weight: 1.5, value: fundingRate, explanation: `${candleExplanation} Funding (${(fundingRate * 100).toFixed(4)}%).` });

      // PILAR 10: Flujo de Ballenas Institucionales & Smart Money (weight 2.5)
      if (whaleFlow.isBullishWhale) {
        votes.push({
          name: "10. 🐳 Flujo de Ballenas",
          vote: "LONG",
          weight: 2.5,
          value: whaleFlow.takerBuySellRatio,
          explanation: whaleFlow.narrative,
        });
        longScore += 2.5;
      } else if (whaleFlow.isBearishWhale) {
        votes.push({
          name: "10. 🐳 Flujo de Ballenas",
          vote: "SHORT",
          weight: 2.5,
          value: whaleFlow.takerBuySellRatio,
          explanation: whaleFlow.narrative,
        });
        shortScore += 2.5;
      } else {
        votes.push({
          name: "10. Flujo de Ballenas",
          vote: "NEUTRAL",
          weight: 0.5,
          value: whaleFlow.takerBuySellRatio,
          explanation: `Flujo equilibrado (Taker Ratio: ${whaleFlow.takerBuySellRatio}x).`,
        });
      }

      // PILAR 11: 🗺️ Barrida de Liquidez / Stop-Hunt (weight 2)
      const liquiditySweep: LiquiditySweepResult = detectLiquiditySweep(
        highs15m,
        lows15m,
        closes15m,
        volumes15m,
      );
      const sweepTrap: LiquiditySweepResult["trap"] = liquiditySweep.trap;
      if (sweepTrap === "BEAR_SWEEP") {
        votes.push({
          name: "11. 🗺️ Barrida de Liquidez",
          vote: "LONG",
          weight: 2,
          value: liquiditySweep.level,
          explanation: liquiditySweep.narrative,
        });
        longScore += 2;
      } else if (sweepTrap === "BULL_SWEEP") {
        votes.push({
          name: "11. 🗺️ Barrida de Liquidez",
          vote: "SHORT",
          weight: 2,
          value: liquiditySweep.level,
          explanation: liquiditySweep.narrative,
        });
        shortScore += 2;
      } else {
        votes.push({
          name: "11. Barrida de Liquidez",
          vote: "NEUTRAL",
          weight: 0,
          value: 0,
          explanation: liquiditySweep.narrative,
        });
      }

      // ── Score calculation ────────────────────────────────────────────────────
      // FIX #1: Remove LONG tie bias — SHORT wins on equal score
      const direction: "LONG" | "SHORT" = longScore > shortScore ? "LONG" : "SHORT";
      const winningScore = direction === "LONG" ? longScore : shortScore;
      const scoreDiff = Math.abs(longScore - shortScore);

      // FIX #4: Dynamic normalization — only count weights actually cast (non-neutral)
      const totalWeightCast = votes
        .filter(v => v.vote !== "NEUTRAL")
        .reduce((sum, v) => sum + v.weight, 0);
      const confluenceScore = totalWeightCast > 0
        ? Math.min(12, Math.max(4, Math.round((winningScore / totalWeightCast) * 12)))
        : 4;

      // Dynamic leverage based on ATR volatility and ADX market regime (Recommendation #3)
      // Ranging market (ADX < 25): Conservative 3x-5x to avoid liquidation on chop
      // Trending market (ADX >= 25): Controlled 5x-10x
      let leverage = 5;
      if (adx.adx < 25) {
        leverage = Math.min(5, Math.max(3, Math.floor(5 / (atrPct || 1))));
      } else {
        leverage = Math.min(10, Math.max(5, Math.floor(8 / (atrPct || 1))));
      }
      const slPct    = parseFloat((Math.max(1.2, atrPct * 1.5)).toFixed(2));
      const tp1Pct   = parseFloat((slPct * 2.0).toFixed(2)); // Institutional standard: minimum 1:2.0 R:R on TP1
      const tp2Pct   = parseFloat((slPct * 3.2).toFixed(2)); // Extended target: 1:3.2 R:R on TP2
      const rr       = parseFloat(((0.5 * tp1Pct + 0.5 * tp2Pct) / slPct).toFixed(2)); // Blended R:R (50% TP1 + 50% TP2)

      const isLong  = direction === "LONG";
      const entry   = currentPrice;
      const sl      = isLong ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
      const tp1     = isLong ? entry * (1 + tp1Pct / 100) : entry * (1 - tp1Pct / 100);
      const tp2     = isLong ? entry * (1 + tp2Pct / 100) : entry * (1 - tp2Pct / 100);
      const changePct = parseFloat((((currentPrice - k1h[0].open) / k1h[0].open) * 100).toFixed(2));

      // ── Anti-FOMO & Price Extension Guard ──────────────────────────────────
      const extEma21 = atr1h > 0 ? (currentPrice - ema21) / atr1h : 0;
      const extVwap  = atr1h > 0 ? (currentPrice - vwap) / atr1h : 0;
      const isOverextendedBullish = (extEma21 > 2.0 && extVwap > 1.5) || rsi1h > 72;
      const isOverextendedBearish = (extEma21 < -2.0 && extVwap < -1.5) || rsi1h < 28;
      const isPullbackZone = extEma21 >= -0.7 && extEma21 <= 1.0;

      let marketPhase: "PULLBACK" | "OVEREXTENDED" | "TREND_IMPULSE" | "RANGING" = "RANGING";
      if (isOverextendedBullish || isOverextendedBearish) {
        marketPhase = "OVEREXTENDED";
      } else if (isPullbackZone) {
        marketPhase = "PULLBACK";
      } else if (Math.abs(extEma21) > 1.0) {
        marketPhase = "TREND_IMPULSE";
      }

      // Pullback optimal entry range
      const entryZoneMin = parseFloat((Math.min(ema21, vwap) - 0.25 * atr1h).toFixed(4));
      const entryZoneMax = parseFloat((Math.max(ema21, vwap) + 0.35 * atr1h).toFixed(4));

      // Estimated liquidation price (Binance Futures maintenance margin 0.5%)
      const mmRate = 0.005;
      const liquidationPriceEst = parseFloat(
        (isLong
          ? entry * (1.0 - (1.0 / Math.max(1, leverage)) + mmRate)
          : entry * (1.0 + (1.0 / Math.max(1, leverage)) - mmRate)
        ).toFixed(4)
      );

      let antiFomoWarning: string | null = null;
      if (isLong && isOverextendedBullish) {
        antiFomoWarning = `Precio sobreextendido (+${extEma21.toFixed(1)} ATR sobre EMA21 / RSI ${rsi1h.toFixed(0)}). Riesgo alto de comprar en el techo. Esperar retroceso hacia zona $${entryZoneMin} - $${entryZoneMax}.`;
      } else if (!isLong && isOverextendedBearish) {
        antiFomoWarning = `Precio sobreextendido a la baja (${extEma21.toFixed(1)} ATR bajo EMA21 / RSI ${rsi1h.toFixed(0)}). Riesgo de vender en el suelo. Esperar rebote técnico.`;
      }

      const nowTs = Date.now();
      const signalId = `live_${item.symbol.toLowerCase()}`;
      const alertId = `alert_live_${item.symbol.toLowerCase()}`;

      // FIX #5: Only generate an alert if confluence is meaningful (>= 7) AND the market is moving
      // Prevents 13 identical low-quality alerts on every scan
      const isMixedSignal = scoreDiff < 1.5; // longScore ≈ shortScore — market undecided
      if (confluenceScore >= 7 && !isMixedSignal) {
        const humanSummary = direction === "LONG"
          ? `Oportunidad alcista en ${item.name}: Soporte cuantitativo validado con ${confluenceScore}/12 pilares alineados a favor.`
          : `Oportunidad bajista en ${item.name}: Rechazo técnico y presión vendedora con ${confluenceScore}/12 pilares confirmando dirección.`;

        const humanExplanation = [
          direction === "LONG" ? "Estructura alcista con medias móviles y VWAP actuando como soporte dinámico." : "Estructura bajista bajo medias institucionales.",
          rsiDiv !== "NONE" ? `Divergencia técnica en RSI (${rsiDiv}) confirmando giro inminente.` : null,
          candlePat !== "NONE" ? `Patrón de velas de confirmación intradía (${candlePat}).` : null,
          `Volumen institucional de ${volumeRatio}x respecto a la media de 20 periodos.`,
          `Precio referencial cerca de VWAP ($${vwap.toFixed(2)}).`
        ].filter(Boolean).join(" ");

        const alertDoc = {
          type: changePct >= 0 ? "price_surge" : "price_dump",
          severity: confluenceScore >= 9 ? "high" : "medium",
          coin_id: item.coin_id,
          symbol: item.symbol,
          name: item.name,
          price_usd: parseFloat(entry.toFixed(4)),
          previous_price_usd: parseFloat(k1h[0].open.toFixed(4)),
          change_pct: changePct,
          volume_24h_usd: k1h.reduce((a: number, b: { volume: number; close: number }) => a + b.volume * b.close, 0),
          volume_ratio: volumeRatio,
          score: Math.min(98, confluenceScore * 8 + 10),
          title: `${direction === "LONG" ? "🟢" : "🔴"} ${item.symbol} $${entry.toFixed(2)} — Confluencia ${confluenceScore}/12 (${changePct >= 0 ? "+" : ""}${changePct}%)`,
          summary: humanSummary,
          explanation: humanExplanation,
          recommended_action: `${direction} en $${entry.toFixed(2)} · SL $${sl.toFixed(2)} (-${slPct}%) · TP1 $${tp1.toFixed(2)} (+${tp1Pct}%)`,
          min_tier: "free",
          created_at: Timestamp.now(),
        };
        newAlerts.push({ id: alertId, data: alertDoc });
      }

      // ── TIMEFRAME CONFIDENCE CALCULATIONS (X/10 rating) ────────────────────
      let score15mRaw = 5;
      if (rsi15m < 42) score15mRaw += 3;
      else if (rsi15m < 50) score15mRaw += 1.5;
      else if (rsi15m > 58) score15mRaw -= 3;
      else score15mRaw -= 1.5;
      if (candlePat === "HAMMER" || candlePat === "BULL_ENGULFING") score15mRaw += 2;
      if (candlePat === "SHOOTING_STAR" || candlePat === "BEAR_ENGULFING") score15mRaw -= 2;

      const dir15m = score15mRaw >= 5 ? "LONG" : "SHORT";
      const rating15m = dir15m === "LONG" ? Math.min(10, Math.max(3, Math.round(score15mRaw))) : Math.min(10, Math.max(3, Math.round(10 - score15mRaw)));

      let score1hRaw = 5;
      if (emaLong) score1hRaw += 2.5; else if (emaShort) score1hRaw -= 2.5;
      if (currentPrice > vwap * 1.002) score1hRaw += 1.5; else if (currentPrice < vwap * 0.998) score1hRaw -= 1.5;
      if (macd.hist > 0) score1hRaw += 1.5; else score1hRaw -= 1.5;
      if (rsiDiv === "BULLISH") score1hRaw += 2.5; else if (rsiDiv === "BEARISH") score1hRaw -= 2.5;

      const dir1h = score1hRaw >= 5 ? "LONG" : "SHORT";
      const rating1h = dir1h === "LONG" ? Math.min(10, Math.max(3, Math.round(score1hRaw))) : Math.min(10, Math.max(3, Math.round(10 - score1hRaw)));

      let score4hRaw = 5;
      if (currentPrice > ema50_4h) score4hRaw += 3.5; else score4hRaw -= 3.5;
      if (rsi4h > 50) score4hRaw += 1.5; else score4hRaw -= 1.5;

      const dir4h = score4hRaw >= 5 ? "LONG" : "SHORT";
      const rating4h = dir4h === "LONG" ? Math.min(10, Math.max(3, Math.round(score4hRaw))) : Math.min(10, Math.max(3, Math.round(10 - score4hRaw)));

      const bias_15m = `${dir15m} ${rating15m}/10`;
      const bias_1h = `${dir1h} ${rating1h}/10`;
      const bias_4h = `${dir4h} ${rating4h}/10`;

      // ── STRICT INSTITUTIONAL TREND FILTERS (PREVENTS COUNTER-TREND LOSSES) ──
      // Rule 1: NEVER enter a LONG if price is below EMA200 (bearish regime) or 4h is SHORT
      const isCounterTrendLong = direction === "LONG" && (!aboveEma200 || dir4h === "SHORT");
      // Rule 2: NEVER enter a SHORT if price is above EMA200 (bullish regime) or 4h is LONG
      const isCounterTrendShort = direction === "SHORT" && (aboveEma200 || dir4h === "LONG");

      // Rule 3: 🛡️ BTC BETA GUARD (The Market Leader Shield)
      // If BTC is in a clear SHORT trend, BLOCK or heavily penalize any altcoin LONG
      const isBtcOpposingLong = item.symbol !== "BTC" && direction === "LONG" && btcDirection === "SHORT";
      // If BTC is in a clear LONG trend, BLOCK or heavily penalize any altcoin SHORT
      const isBtcOpposingShort = item.symbol !== "BTC" && direction === "SHORT" && btcDirection === "LONG";

      const opposes15mAnd4h = (direction === "SHORT" && dir15m === "LONG" && dir4h === "LONG") ||
                              (direction === "LONG" && dir15m === "SHORT" && dir4h === "SHORT");

      // 🧮 REGIME GUARD: Choppiness Index + Weekend/low-volume trap days.
      // Raises the minimum confluence required to publish a signal.
      const regimeGuard: RegimeGuardResult = computeRegimeGuard(
        closes1h,
        highs1h,
        lows1h,
        volumeRatio,
        minConfluenceThreshold,
      );

      let effectiveConfluence = confluenceScore;
      if (isBtcOpposingLong || isBtcOpposingShort) {
        effectiveConfluence = Math.min(4, effectiveConfluence - 4); // Demote below entry threshold
      } else if (isCounterTrendLong || isCounterTrendShort) {
        effectiveConfluence = Math.min(5, effectiveConfluence - 3); // Heavily penalize counter-trend trades
      } else if (opposes15mAnd4h && effectiveConfluence >= 9) {
        effectiveConfluence = 8; // Demote from High to Medium Confluence due to timeframe contradiction
      }

      // BTC Guard metadata
      const btcGuardStatus: "ALIGNED" | "BLOCKED" | "NEUTRAL" =
        (isBtcOpposingLong || isBtcOpposingShort)
          ? "BLOCKED"
          : (btcDirection === direction)
          ? "ALIGNED"
          : "NEUTRAL";

      const btcGuardExplanation =
        btcGuardStatus === "BLOCKED"
          ? `⚠️ BTC Beta Guard: Operación bloqueada porque Bitcoin está en tendencia ${btcDirection} (${btcStrength}/10). Alta probabilidad de arrastre del mercado.`
          : btcGuardStatus === "ALIGNED"
          ? `🛡️ BTC Beta Guard: Alineado con el líder. Bitcoin está ${btcDirection} (${btcStrength}/10) impulsando el mercado.`
          : `🛡️ BTC Beta Guard: Bitcoin en rango neutral (${btcStrength}/10).`;

      let signalTypeLabel = "";
      if (isBtcOpposingLong) {
        signalTypeLabel = `LONG Bloqueado por BTC Guard (BTC en Tendencia Bajista)`;
      } else if (isBtcOpposingShort) {
        signalTypeLabel = `SHORT Bloqueado por BTC Guard (BTC en Tendencia Alcista)`;
      } else if (isCounterTrendLong) {
        signalTypeLabel = `LONG Descartado (Tendencia General Bajista / Bajo EMA200)`;
      } else if (isCounterTrendShort) {
        signalTypeLabel = `SHORT Descartado (Tendencia General Alcista / Sobre EMA200)`;
      } else if (sweepTrap === "BEAR_SWEEP" && direction === "LONG") {
        signalTypeLabel = `LONG Post-Barrida de Liquidez (Stop-Hunt Absorbido)`;
      } else if (sweepTrap === "BULL_SWEEP" && direction === "SHORT") {
        signalTypeLabel = `SHORT Post-Barrida de Liquidez (Stop-Hunt Absorbido)`;
      } else if (effectiveConfluence >= 9 && !opposes15mAnd4h) {
        signalTypeLabel = `${direction} Alta Confluencia (9-12/12 — Señal Fuerte)`;
      } else if (effectiveConfluence >= 7) {
        signalTypeLabel = opposes15mAnd4h
          ? `${direction} Confluencia Media (7-8/12 — Conflicto 15m/4h)`
          : `${direction} Confluencia Media (7-8/12 — Esperar Confirmación)`;
      } else if (effectiveConfluence >= 5) {
        signalTypeLabel = `${direction} Señal Débil (5-6/12 — Precaución / No Entrar)`;
      } else {
        signalTypeLabel = `${direction} Descartar (<5/12 — Sin Confluencia)`;
      }

      // Generate trading signal document for this asset
      const signalDoc: TradingSignalDoc = {
        id: signalId,
        coin_id: item.coin_id,
        symbol: item.symbol,
        name: item.name,
        direction,
        confluence_score: effectiveConfluence,
        confluence_total: 12,
        confidence: parseFloat((effectiveConfluence / 12).toFixed(2)),
        entry_price: parseFloat(entry.toFixed(4)),
        leverage,
        stop_loss: parseFloat(sl.toFixed(4)),
        take_profit_1: parseFloat(tp1.toFixed(4)),
        take_profit_2: parseFloat(tp2.toFixed(4)),
        risk_reward: rr,
        atr: parseFloat(atr1h.toFixed(4)),
        sl_pct: slPct,
        tp1_pct: tp1Pct,
        tp2_pct: tp2Pct,
        votes,
        bias_15m,
        bias_1h,
        bias_4h,
        funding_rate: fundingRate,
        open_interest: 0,
        kraken_symbol: item.kraken,
        signal_type: signalTypeLabel,
        whale_flow: {
          taker_ratio: whaleFlow.takerBuySellRatio,
          top_trader_ratio: whaleFlow.topTraderLongRatio,
          bias: whaleFlow.whaleBias,
          badge_text: whaleFlow.badgeText,
          narrative: whaleFlow.narrative,
        },
        btc_guard: {
          status: btcGuardStatus,
          btc_direction: btcDirection,
          btc_strength: btcStrength,
          explanation: btcGuardExplanation,
        },
        liquidity_sweep: sweepTrap
          ? {
              trap: sweepTrap,
              level: liquiditySweep.level,
              wick_pct: parseFloat(liquiditySweep.wickPct.toFixed(2)),
              absorption: liquiditySweep.absorption,
              narrative: liquiditySweep.narrative,
            }
          : null,
        regime_guard: {
          choppy: regimeGuard.choppy,
          ci: regimeGuard.ci,
          is_weekend: regimeGuard.isWeekend,
          volume_ratio: regimeGuard.volumeRatio,
          required_confluence: regimeGuard.requiredConfluence,
          explanation: regimeGuard.explanation,
        },
        entry_zone_min: entryZoneMin,
        entry_zone_max: entryZoneMax,
        liquidation_price_est: liquidationPriceEst,
        market_phase: marketPhase,
        anti_fomo_warning: antiFomoWarning,
        adx: adx.adx,
        rsi_divergence: rsiDiv,
        candle_pattern: candlePat,
        bb_squeeze: bb.isSqueeze,
        timeframe_conflict: opposes15mAnd4h,
        min_tier: "free",
        created_at: { seconds: Math.floor(nowTs / 1000), nanoseconds: 0 },
      };
      newSignals.push(signalDoc);

      generatedCount++;
    } catch (err) {
      console.error(`Error scanning ${item.symbol}:`, err);
    }
  }

  // 1. Immediately push new signals to local reactive Zustand store & localStorage
  // This provides an INSTANT (0ms) UI refresh with fresh timestamps across all cards,
  // immune to Firestore quota limits or latency.
  if (newSignals.length > 0) {
    useAppStore.getState().setLiveSignals(newSignals);
  }

  // 2. Background sync to Firestore without blocking the UI and gracefully catching quota limits
  if (newAlerts.length > 0 || newSignals.length > 0) {
    (async () => {
      try {
        for (const item of newSignals) {
          await setDoc(doc(db, "trading_signals", item.id), item, { merge: true });
        }
        for (const item of newAlerts) {
          await setDoc(doc(db, "alerts", item.id), item.data, { merge: true });
        }
      } catch (err) {
        console.warn("[liveScanner] Firestore quota or network limit during sync (client updated reactively):", err);
      }
    })();
  }

  return { scannedCount: SYMBOLS.length, signalsFound: newSignals.length, signals: newSignals };
}
