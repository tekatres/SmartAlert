import { collection, doc, setDoc, deleteDoc, getDocs, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

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

/** RSI Divergence — looks back 20 candles for price vs RSI divergence */
function detectRSIDivergence(closes: number[], period = 14): "BULLISH" | "BEARISH" | "NONE" {
  if (closes.length < 30) return "NONE";
  const rsiSeries = calcRSISeries(closes, period);
  const lookback = 20;
  const n = closes.length;

  // Find swing low/high in last `lookback` bars (excluding last 2)
  const priceLast = closes[n - 1];
  const rsiLast = rsiSeries[rsiSeries.length - 1];

  const priceWindow = closes.slice(n - lookback, n - 2);
  const rsiWindow = rsiSeries.slice(rsiSeries.length - lookback, rsiSeries.length - 2);

  const prevPriceLow = Math.min(...priceWindow);
  const prevPriceHigh = Math.max(...priceWindow);
  const prevRSILow = Math.min(...rsiWindow);
  const prevRSIHigh = Math.max(...rsiWindow);

  // Bullish: price lower low, RSI higher low
  if (priceLast < prevPriceLow && rsiLast > prevRSILow && rsiLast < 50) {
    return "BULLISH";
  }
  // Bearish: price higher high, RSI lower high
  if (priceLast > prevPriceHigh && rsiLast < prevRSIHigh && rsiLast > 50) {
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

async function fetchKlines(symbol: string, interval: string, limit = 120) {
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

export async function scanLiveMarket(minConfluenceThreshold = 5): Promise<{ scannedCount: number; signalsFound: number }> {
  let generatedCount = 0;
  const newSignals: { id: string; data: any }[] = [];
  const newAlerts: { id: string; data: any }[] = [];

  for (const item of SYMBOLS) {
    try {
      const [k15m, k1h, k4h, fundingRate] = await Promise.all([
        fetchKlines(item.binance, "15m", 120),
        fetchKlines(item.binance, "1h", 120),
        fetchKlines(item.binance, "4h", 80),
        fetchFundingRate(item.binance),
      ]);

      // ── Extract series ──────────────────────────────────────────────────────
      const opens1h   = k1h.map((k: { open: number }) => k.open);
      const closes1h  = k1h.map((k: { close: number }) => k.close);
      const closes4h  = k4h.map((k: { close: number }) => k.close);
      const closes15m = k15m.map((k: { close: number }) => k.close);
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

      // PILAR 2: Tendencia Multitemporal EMA Ribbon (weight 2)
      const emaLong  = currentPrice > ema9 && ema9 > ema21 && ema21 > ema50;
      const emaShort = currentPrice < ema9 && ema9 < ema21 && ema21 < ema50;
      if (emaLong) {
        votes.push({ name: "2. Abanico EMA (9/21/50)", vote: "LONG", weight: 2, value: ema9, explanation: `Alineación alcista: Precio>${ema9.toFixed(2)} EMA9>${ema21.toFixed(2)} EMA21.` });
        longScore += 2;
      } else if (emaShort) {
        votes.push({ name: "2. Abanico EMA (9/21/50)", vote: "SHORT", weight: 2, value: ema9, explanation: `Alineación bajista: Precio<${ema9.toFixed(2)} EMA9<${ema21.toFixed(2)} EMA21.` });
        shortScore += 2;
      } else {
        votes.push({ name: "2. Abanico EMA", vote: "NEUTRAL", weight: 0.5, value: ema9, explanation: `EMAs comprimidas o cruzándose. Tendencia no definida.` });
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
      if (rsi1h < 52 && macdBull) {
        votes.push({ name: "5. Momentum MACD+RSI", vote: "LONG", weight: 2, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)}) compradora. MACD positivo.` });
        longScore += 2;
      } else if (rsi1h > 48 && macdBear) {
        votes.push({ name: "5. Momentum MACD+RSI", vote: "SHORT", weight: 2, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)}) vendedora. MACD negativo.` });
        shortScore += 2;
      } else {
        votes.push({ name: "5. Momentum MACD+RSI", vote: "NEUTRAL", weight: 0.5, value: rsi1h, explanation: `Momentum neutro (RSI 1h=${rsi1h.toFixed(1)}).` });
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

      // PILAR 8: Bollinger Bands (weight 1.5)
      if (bb.breakoutUp) {
        votes.push({ name: "8. Bollinger Breakout ↑", vote: "LONG", weight: 1.5, value: bb.bandwidth, explanation: `Precio por encima de la banda superior de Bollinger.` });
        longScore += 1.5;
      } else if (bb.breakoutDown) {
        votes.push({ name: "8. Bollinger Breakout ↓", vote: "SHORT", weight: 1.5, value: bb.bandwidth, explanation: `Precio por debajo de la banda inferior de Bollinger.` });
        shortScore += 1.5;
      } else {
        votes.push({ name: "8. Bollinger Bands", vote: "NEUTRAL", weight: 0, value: bb.bandwidth, explanation: `Precio dentro de las Bandas de Bollinger.` });
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

      // ── Score calculation ────────────────────────────────────────────────────
      const direction: "LONG" | "SHORT" = longScore >= shortScore ? "LONG" : "SHORT";
      const winningScore = direction === "LONG" ? longScore : shortScore;
      const totalPossible = 16.5;
      const confluenceScore = Math.min(12, Math.max(4, Math.round((winningScore / totalPossible) * 12)));

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
      const tp1Pct   = parseFloat((slPct * 1.6).toFixed(2));
      const tp2Pct   = parseFloat((slPct * 2.8).toFixed(2));
      const rr       = parseFloat((tp1Pct / slPct).toFixed(2));

      const isLong  = direction === "LONG";
      const entry   = currentPrice;
      const sl      = isLong ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
      const tp1     = isLong ? entry * (1 + tp1Pct / 100) : entry * (1 - tp1Pct / 100);
      const tp2     = isLong ? entry * (1 + tp2Pct / 100) : entry * (1 - tp2Pct / 100);
      const changePct = parseFloat((((currentPrice - k1h[0].open) / k1h[0].open) * 100).toFixed(2));

      const nowTs = Date.now();
      const signalId = `live_${item.symbol.toLowerCase()}_${nowTs}`;
      const alertId = `alert_live_${item.symbol.toLowerCase()}_${nowTs}`;

      // Create alert document for every scanned pair (Market Alerts)
      const alertDoc = {
        type: changePct >= 0 ? "price_surge" : "price_dump",
        severity: confluenceScore >= 8 ? "high" : "medium",
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
        summary: `Motor de 9 Pilares para ${item.name}. ADX ${adx.adx.toFixed(1)}, Confluencia ${confluenceScore}/12.`,
        explanation: `Análisis avanzado: ADX=${adx.adx.toFixed(1)}, Divergencia RSI=${rsiDiv}, Patrón velas=${candlePat}, BB Squeeze=${bb.isSqueeze}. VWAP $${vwap.toFixed(2)}.`,
        recommended_action: `${direction} en $${entry.toFixed(2)} · SL $${sl.toFixed(2)} (-${slPct}%) · TP1 $${tp1.toFixed(2)} (+${tp1Pct}%) · Kraken ${item.kraken}`,
        min_tier: "free",
        created_at: Timestamp.now(),
      };
      newAlerts.push({ id: alertId, data: alertDoc });

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

      // ── MULTI-TIMEFRAME ALIGNMENT GUARD ─────────────────────────────────────
      // Rule: If 15m and 4h are BOTH opposing the trade direction (e.g. trade SHORT, but 15m & 4h are LONG),
      // DO NOT allow ALTA CONFLUENCIA (cap score at 8 max and flag conflict).
      const opposes15mAnd4h = (direction === "SHORT" && dir15m === "LONG" && dir4h === "LONG") ||
                              (direction === "LONG" && dir15m === "SHORT" && dir4h === "SHORT");

      let effectiveConfluence = confluenceScore;
      if (opposes15mAnd4h && effectiveConfluence >= 9) {
        effectiveConfluence = 8; // Demote from High to Medium Confluence due to timeframe contradiction
      }

      let signalTypeLabel = "";
      if (effectiveConfluence >= 9 && !opposes15mAnd4h) {
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

      // Create trading signal document if confluence >= minConfluenceThreshold
      if (effectiveConfluence >= minConfluenceThreshold) {
        const signalDoc = {
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
          adx: adx.adx,
          rsi_divergence: rsiDiv,
          candle_pattern: candlePat,
          bb_squeeze: bb.isSqueeze,
          timeframe_conflict: opposes15mAnd4h,
          bias_15m,
          bias_1h,
          bias_4h,
          funding_rate: fundingRate,
          kraken_symbol: item.kraken,
          signal_type: signalTypeLabel,
          min_tier: "free",
          created_at: Timestamp.now(),
        };
        newSignals.push({ id: signalId, data: signalDoc });
      }

      generatedCount++;
    } catch (err) {
      console.error(`Error scanning ${item.symbol}:`, err);
    }
  }

  // ONLY clear old documents if we have successfully built new ones!
  if (newAlerts.length > 0 || newSignals.length > 0) {
    try {
      const signalsSnap = await getDocs(collection(db, "trading_signals"));
      for (const d of signalsSnap.docs) await deleteDoc(doc(db, "trading_signals", d.id));
      const alertsSnap = await getDocs(collection(db, "alerts"));
      for (const d of alertsSnap.docs) await deleteDoc(doc(db, "alerts", d.id));
    } catch (err) {
      console.warn("Could not clear previous docs:", err);
    }

    // Write new signals and alerts
    for (const item of newSignals) {
      await setDoc(doc(db, "trading_signals", item.id), item.data);
    }
    for (const item of newAlerts) {
      await setDoc(doc(db, "alerts", item.id), item.data);
    }
  }

  return { scannedCount: SYMBOLS.length, signalsFound: newSignals.length };
}
