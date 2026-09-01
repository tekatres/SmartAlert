import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, Timestamp } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Manually parse frontend/.env
const envPath = path.resolve(__dirname, "../frontend/.env");
const envText = fs.readFileSync(envPath, "utf-8");
const envVars = {};
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    envVars[key] = val;
  }
}

const firebaseConfig = {
  apiKey: envVars.VITE_FIREBASE_API_KEY,
  authDomain: envVars.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: envVars.VITE_FIREBASE_PROJECT_ID,
  storageBucket: envVars.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: envVars.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: envVars.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SYMBOLS = [
  { coin_id: "bitcoin", symbol: "BTC", name: "Bitcoin", binance: "BTCUSDT" },
  { coin_id: "ethereum", symbol: "ETH", name: "Ethereum", binance: "ETHUSDT" },
  { coin_id: "solana", symbol: "SOL", name: "Solana", binance: "SOLUSDT" },
  { coin_id: "binancecoin", symbol: "BNB", name: "BNB", binance: "BNBUSDT" },
  { coin_id: "ripple", symbol: "XRP", name: "XRP", binance: "XRPUSDT" },
  { coin_id: "cardano", symbol: "ADA", name: "Cardano", binance: "ADAUSDT" },
  { coin_id: "dogecoin", symbol: "DOGE", name: "Dogecoin", binance: "DOGEUSDT" },
  { coin_id: "avalanche-2", symbol: "AVAX", name: "Avalanche", binance: "AVAXUSDT" },
  { coin_id: "chainlink", symbol: "LINK", name: "Chainlink", binance: "LINKUSDT" },
];

function calcEMA(values, period) {
  if (values.length < period) return values[values.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  return calcEMA(trs, period);
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  return ema12 - ema26;
}

async function fetchKlines(symbol, interval, limit = 100) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch klines: ${res.statusText}`);
  const raw = await res.json();
  return raw.map((k) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchFundingRate(symbol) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const raw = await res.json();
    return raw.length > 0 ? parseFloat(raw[0].fundingRate) : 0;
  } catch {
    return 0;
  }
}

async function main() {
  console.log("🚀 Conectando a Firebase y eliminando datos de prueba...");

  // Delete old docs in trading_signals
  const signalsSnap = await getDocs(collection(db, "trading_signals"));
  for (const d of signalsSnap.docs) {
    await deleteDoc(doc(db, "trading_signals", d.id));
  }

  // Delete old docs in alerts
  const alertsSnap = await getDocs(collection(db, "alerts"));
  for (const d of alertsSnap.docs) {
    await deleteDoc(doc(db, "alerts", d.id));
  }

  console.log("📡 Obteniendo precios e indicadores EN TIEMPO REAL de Binance Futures para el día de hoy...");
  const generatedSignals = [];

  for (const item of SYMBOLS) {
    try {
      const [k15m, k1h, k4h, fundingRate] = await Promise.all([
        fetchKlines(item.binance, "15m", 100),
        fetchKlines(item.binance, "1h", 100),
        fetchKlines(item.binance, "4h", 100),
        fetchFundingRate(item.binance),
      ]);

      const closes15m = k15m.map((k) => k.close);
      const closes1h = k1h.map((k) => k.close);
      const closes4h = k4h.map((k) => k.close);
      const volumes1h = k1h.map((k) => k.volume);
      const currentPrice = closes1h[closes1h.length - 1];

      // Volume ratio vs 20-period average
      const avgVol20 = volumes1h.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentVol = volumes1h[volumes1h.length - 1];
      const volumeRatio = avgVol20 > 0 ? parseFloat((currentVol / avgVol20).toFixed(2)) : 1.0;

      const rsi15m = calcRSI(closes15m, 14);
      const rsi1h = calcRSI(closes1h, 14);
      const rsi4h = calcRSI(closes4h, 14);

      const ema9 = calcEMA(closes1h, 9);
      const ema21 = calcEMA(closes1h, 21);
      const ema50 = calcEMA(closes1h, 50);
      const macd1h = calcMACD(closes1h);

      const highs1h = k1h.map((k) => k.high);
      const lows1h = k1h.map((k) => k.low);
      const atr1h = calcATR(highs1h, lows1h, closes1h, 14);
      const atrPct = (atr1h / currentPrice) * 100;

      const votes = [];
      let longScore = 0;
      let shortScore = 0;

      // 1. Multi-Timeframe RSI
      if (rsi1h < 40 && rsi15m < 38) {
        votes.push({ name: "RSI Multi-Timeframe", vote: "LONG", weight: 2, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)}) y 15m (${rsi15m.toFixed(1)}) sobrevendidos. Presión vendedora agotada.` });
        longScore += 2;
      } else if (rsi1h > 60 && rsi15m > 62) {
        votes.push({ name: "RSI Multi-Timeframe", vote: "SHORT", weight: 2, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)}) y 15m (${rsi15m.toFixed(1)}) sobrecomprados. Presión compradora agotada.` });
        shortScore += 2;
      } else {
        votes.push({ name: "RSI Multi-Timeframe", vote: "NEUTRAL", weight: 1, value: rsi1h, explanation: `RSI 1h en zona neutral (${rsi1h.toFixed(1)}).` });
      }

      // 2. EMA Ribbon Expansion (Alineación + Abanico)
      const emaRibbonLong = currentPrice > ema9 && ema9 > ema21 && ema21 > ema50;
      const emaRibbonShort = currentPrice < ema9 && ema9 < ema21 && ema21 < ema50;

      if (emaRibbonLong) {
        votes.push({ name: "Abanico EMAs (9/21/50)", vote: "LONG", weight: 2, value: ema9, explanation: "Abanico alcista perfecto: Precio > EMA9 > EMA21 > EMA50." });
        longScore += 2;
      } else if (emaRibbonShort) {
        votes.push({ name: "Abanico EMAs (9/21/50)", vote: "SHORT", weight: 2, value: ema9, explanation: "Abanico bajista perfecto: Precio < EMA9 < EMA21 < EMA50." });
        shortScore += 2;
      } else {
        votes.push({ name: "Abanico EMAs (9/21/50)", vote: "NEUTRAL", weight: 1, value: ema9, explanation: "EMAs comprimidas o en transición." });
      }

      // 3. Volume Breakout Confirmation (1.4x Gate)
      if (volumeRatio >= 1.4) {
        const volDir = closes1h[closes1h.length - 1] >= closes1h[closes1h.length - 2] ? "LONG" : "SHORT";
        votes.push({ name: "Volumen Institucional", vote: volDir, weight: 2, value: volumeRatio, explanation: `Volumen ${volumeRatio}x por encima de la media de 20 periodos. Participación de capital institucional.` });
        if (volDir === "LONG") longScore += 2;
        else shortScore += 2;
      } else {
        votes.push({ name: "Volumen Institucional", vote: "NEUTRAL", weight: 1, value: volumeRatio, explanation: `Volumen normal (${volumeRatio}x). Sin ruptura de volumen.` });
      }

      // 4. MACD Momentum
      if (macd1h > 0) {
        votes.push({ name: "Histograma MACD", vote: "LONG", weight: 1, value: macd1h, explanation: "MACD positivo y alineado al alza en 1h." });
        longScore += 1;
      } else {
        votes.push({ name: "Histograma MACD", vote: "SHORT", weight: 1, value: macd1h, explanation: "MACD negativo y alineado a la baja en 1h." });
        shortScore += 1;
      }

      // 5. Funding Rate Sentiment
      if (fundingRate < -0.005) {
        votes.push({ name: "Funding Rate Futuros", vote: "LONG", weight: 1.5, value: fundingRate, explanation: `Funding negativo (${(fundingRate * 100).toFixed(4)}%), shorts atrapados.` });
        longScore += 1.5;
      } else if (fundingRate > 0.005) {
        votes.push({ name: "Funding Rate Futuros", vote: "SHORT", weight: 1.5, value: fundingRate, explanation: `Funding positivo (${(fundingRate * 100).toFixed(4)}%), longs apalancados.` });
        shortScore += 1.5;
      } else {
        votes.push({ name: "Funding Rate Futuros", vote: "NEUTRAL", weight: 1, value: fundingRate, explanation: `Funding Rate neutro (${(fundingRate * 100).toFixed(4)}%).` });
      }

      // 6. Tendencia Macro 4h
      const ema50_4h = calcEMA(closes4h, 50);
      const bias4h = currentPrice > ema50_4h ? "LONG" : "SHORT";
      votes.push({ name: "Tendencia Macro 4h", vote: bias4h, weight: 2, value: ema50_4h, explanation: `Estructura macro en 4h orientada a ${bias4h}.` });
      if (bias4h === "LONG") longScore += 2;
      else shortScore += 2;

      const direction = longScore >= shortScore ? "LONG" : "SHORT";
      const winningScore = direction === "LONG" ? longScore : shortScore;
      const confluenceScore = Math.min(12, Math.max(5, Math.round((winningScore / 10.5) * 12)));

      // Dynamic leverage capped by ATR volatility (Recommendation #3)
      const leverage = Math.min(10, Math.max(3, Math.floor(6 / (atrPct || 1))));
      const slPct = parseFloat((Math.max(1.2, atrPct * 1.5)).toFixed(2));
      const tp1Pct = parseFloat((slPct * 1.6).toFixed(2));
      const tp2Pct = parseFloat((slPct * 2.8).toFixed(2));

      const isLong = direction === "LONG";
      const stopLoss = isLong ? currentPrice * (1 - slPct / 100) : currentPrice * (1 + slPct / 100);
      const tp1 = isLong ? currentPrice * (1 + tp1Pct / 100) : currentPrice * (1 - tp1Pct / 100);
      const tp2 = isLong ? currentPrice * (1 + tp2Pct / 100) : currentPrice * (1 - tp2Pct / 100);
      const riskReward = parseFloat((tp1Pct / slPct).toFixed(2));

      let score15mRaw = 5;
      if (rsi15m < 42) score15mRaw += 3;
      else if (rsi15m < 50) score15mRaw += 1.5;
      else if (rsi15m > 58) score15mRaw -= 3;
      else score15mRaw -= 1.5;

      const dir15m = score15mRaw >= 5 ? "LONG" : "SHORT";
      const rating15m = dir15m === "LONG" ? Math.min(10, Math.max(3, Math.round(score15mRaw))) : Math.min(10, Math.max(3, Math.round(10 - score15mRaw)));

      let score1hRaw = 5;
      if (currentPrice > ema9 && ema9 > ema21) score1hRaw += 2.5;
      else if (currentPrice < ema9 && ema9 < ema21) score1hRaw -= 2.5;
      if (macd1h > 0) score1hRaw += 1.5; else score1hRaw -= 1.5;

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

      const signalDoc = {
        coin_id: item.coin_id,
        symbol: item.symbol,
        name: item.name,
        direction,
        confluence_score: effectiveConfluence,
        confluence_total: 12,
        confidence: parseFloat((effectiveConfluence / 12).toFixed(2)),
        entry_price: parseFloat(currentPrice.toFixed(4)),
        leverage,
        stop_loss: parseFloat(stopLoss.toFixed(4)),
        take_profit_1: parseFloat(tp1.toFixed(4)),
        take_profit_2: parseFloat(tp2.toFixed(4)),
        risk_reward: riskReward,
        atr: parseFloat(atr1h.toFixed(4)),
        sl_pct: slPct,
        tp1_pct: tp1Pct,
        tp2_pct: tp2Pct,
        votes,
        timeframe_conflict: opposes15mAnd4h,
        bias_15m,
        bias_1h,
        bias_4h,
        funding_rate: fundingRate,
        open_interest: 0,
        signal_type: signalTypeLabel,
        min_tier: "free",
        created_at: Timestamp.now(),
      };

      const docId = `real_${item.symbol.toLowerCase()}_${Date.now()}`;
      await setDoc(doc(db, "trading_signals", docId), signalDoc);

      const changePct = parseFloat((((currentPrice - k1h[0].open) / k1h[0].open) * 100).toFixed(2));
      const alertDoc = {
        type: changePct >= 0 ? "price_surge" : "price_dump",
        severity: confluenceScore >= 8 ? "high" : "medium",
        coin_id: item.coin_id,
        symbol: item.symbol,
        name: item.name,
        price_usd: parseFloat(currentPrice.toFixed(4)),
        previous_price_usd: parseFloat(k1h[0].open.toFixed(4)),
        change_pct: changePct,
        volume_24h_usd: k1h.reduce((a, b) => a + b.volume * b.close, 0),
        volume_ratio: volumeRatio,
        score: Math.min(98, confluenceScore * 8 + 15),
        title: `${direction === "LONG" ? "🟢" : "🔴"} ${item.symbol} $${currentPrice.toFixed(2)} (${changePct >= 0 ? "+" : ""}${changePct}%)`,
        summary: `Señal en tiempo real para ${item.name}. Confluencia técnica de ${confluenceScore}/12.`,
        explanation: `Análisis de Binance Futures hoy: Precio a $${currentPrice.toFixed(2)}, RSI 15m (${rsi15m.toFixed(1)}), RSI 1h (${rsi1h.toFixed(1)}). Confluencia ${confluenceScore}/12.`,
        recommended_action: `Entrada ${direction} a $${currentPrice.toFixed(2)} con SL a $${stopLoss.toFixed(2)} (-${slPct}%).`,
        min_tier: "free",
        created_at: Timestamp.now(),
      };
      await setDoc(doc(db, "alerts", `alert_${item.symbol.toLowerCase()}_${Date.now()}`), alertDoc);

      generatedSignals.push(signalDoc);
      console.log(`  ✓ ${item.symbol}: ${direction} a $${currentPrice} (Confluencia: ${confluenceScore}/12)`);
    } catch (err) {
      console.error(`  ✕ Error en ${item.symbol}:`, err.message);
    }
  }

  console.log(`\n🎉 COMPLETADO: Se actualizaron ${generatedSignals.length} señales 100% REALES de Binance Futures para el día de hoy.`);
}

main().catch(console.error);
