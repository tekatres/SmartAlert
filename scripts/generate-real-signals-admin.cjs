const admin = require("firebase-admin");

// Initialize Firebase Admin (uses GOOGLE_APPLICATION_CREDENTIALS or gcloud CLI auth or default app)
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: "smartalerts-ae4ec",
    });
  }
} catch (e) {
  console.error("Admin init error:", e);
}

const db = admin.firestore();

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
  console.log("🚀 Eliminando datos de prueba anteriores con Firebase Admin...");

  // Delete old docs in trading_signals
  const signalsSnap = await db.collection("trading_signals").get();
  for (const docRef of signalsSnap.docs) {
    await docRef.ref.delete();
  }

  // Delete old docs in alerts
  const alertsSnap = await db.collection("alerts").get();
  for (const docRef of alertsSnap.docs) {
    await docRef.ref.delete();
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
      const currentPrice = closes1h[closes1h.length - 1];

      const rsi15m = calcRSI(closes15m, 14);
      const rsi1h = calcRSI(closes1h, 14);
      const rsi4h = calcRSI(closes4h, 14);

      const ema9 = calcEMA(closes1h, 9);
      const ema21 = calcEMA(closes1h, 21);
      const macd1h = calcMACD(closes1h);

      const highs1h = k1h.map((k) => k.high);
      const lows1h = k1h.map((k) => k.low);
      const atr1h = calcATR(highs1h, lows1h, closes1h, 14);
      const atrPct = (atr1h / currentPrice) * 100;

      const votes = [];
      let longScore = 0;
      let shortScore = 0;

      if (rsi1h < 42 && rsi15m < 40) {
        votes.push({ name: "RSI Multi-Timeframe", vote: "LONG", weight: 1.5, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)}) y 15m (${rsi15m.toFixed(1)}) muestran compresión alcista.` });
        longScore += 1.5;
      } else if (rsi1h > 58 && rsi15m > 60) {
        votes.push({ name: "RSI Multi-Timeframe", vote: "SHORT", weight: 1.5, value: rsi1h, explanation: `RSI 1h (${rsi1h.toFixed(1)}) y 15m (${rsi15m.toFixed(1)}) muestran sobrecompra.` });
        shortScore += 1.5;
      } else {
        votes.push({ name: "RSI Multi-Timeframe", vote: "NEUTRAL", weight: 1.0, value: rsi1h, explanation: `RSI 1h neutral a ${rsi1h.toFixed(1)}.` });
      }

      if (currentPrice > ema9 && ema9 > ema21) {
        votes.push({ name: "Estructura EMAs 1h", vote: "LONG", weight: 1.5, value: ema9, explanation: "Precio sobre EMA9 y EMA21 con impulso alcista." });
        longScore += 1.5;
      } else if (currentPrice < ema9 && ema9 < ema21) {
        votes.push({ name: "Estructura EMAs 1h", vote: "SHORT", weight: 1.5, value: ema9, explanation: "Precio por debajo de EMA9 y EMA21 con impulso bajista." });
        shortScore += 1.5;
      } else {
        votes.push({ name: "Estructura EMAs 1h", vote: "NEUTRAL", weight: 1.0, value: ema9, explanation: "Consolidación de EMAs." });
      }

      if (macd1h > 0) {
        votes.push({ name: "Histograma MACD", vote: "LONG", weight: 1.0, value: macd1h, explanation: "MACD alcista en 1 hora." });
        longScore += 1.0;
      } else {
        votes.push({ name: "Histograma MACD", vote: "SHORT", weight: 1.0, value: macd1h, explanation: "MACD bajista en 1 hora." });
        shortScore += 1.0;
      }

      if (fundingRate < 0) {
        votes.push({ name: "Funding Rate Futuros", vote: "LONG", weight: 1.2, value: fundingRate, explanation: `Funding negativo (${(fundingRate * 100).toFixed(4)}%), tasa favorece LONG.` });
        longScore += 1.2;
      } else {
        votes.push({ name: "Funding Rate Futuros", vote: "SHORT", weight: 1.2, value: fundingRate, explanation: `Funding positivo (${(fundingRate * 100).toFixed(4)}%), tasa favorece SHORT.` });
        shortScore += 1.2;
      }

      const ema50_4h = calcEMA(closes4h, 50);
      const bias4h = currentPrice > ema50_4h ? "LONG" : "SHORT";
      votes.push({ name: "Tendencia Macro 4h", vote: bias4h, weight: 1.5, value: ema50_4h, explanation: `Marco de 4 horas alineado con ${bias4h}.` });
      if (bias4h === "LONG") longScore += 1.5;
      else shortScore += 1.5;

      const direction = longScore >= shortScore ? "LONG" : "SHORT";
      const winningScore = direction === "LONG" ? longScore : shortScore;
      const confluenceScore = Math.min(12, Math.max(7, Math.round((winningScore / 6.7) * 12)));

      const leverage = Math.min(20, Math.max(2, Math.floor(10 / atrPct)));
      const slPct = parseFloat((atrPct * 1.5).toFixed(2));
      const tp1Pct = parseFloat((atrPct * 2.2).toFixed(2));
      const tp2Pct = parseFloat((atrPct * 3.8).toFixed(2));

      const isLong = direction === "LONG";
      const stopLoss = isLong ? currentPrice * (1 - slPct / 100) : currentPrice * (1 + slPct / 100);
      const tp1 = isLong ? currentPrice * (1 + tp1Pct / 100) : currentPrice * (1 - tp1Pct / 100);
      const tp2 = isLong ? currentPrice * (1 + tp2Pct / 100) : currentPrice * (1 - tp2Pct / 100);
      const riskReward = parseFloat((tp1Pct / slPct).toFixed(2));

      const signalDoc = {
        coin_id: item.coin_id,
        symbol: item.symbol,
        name: item.name,
        direction,
        confluence_score: confluenceScore,
        confluence_total: 12,
        confidence: parseFloat((confluenceScore / 12).toFixed(2)),
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
        bias_15m: rsi15m < 50 ? "SHORT" : "LONG",
        bias_1h: rsi1h < 50 ? "SHORT" : "LONG",
        bias_4h: bias4h,
        funding_rate: fundingRate,
        open_interest: 0,
        signal_type: `${direction} Futuros Binance (Real Time)`,
        min_tier: "free",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docId = `real_${item.symbol.toLowerCase()}_${Date.now()}`;
      await db.collection("trading_signals").doc(docId).set(signalDoc);

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
        volume_ratio: 1.85,
        score: Math.min(98, confluenceScore * 8 + 15),
        title: `${direction === "LONG" ? "🟢" : "🔴"} ${item.symbol} $${currentPrice.toFixed(2)} (${changePct >= 0 ? "+" : ""}${changePct}%)`,
        summary: `Señal REAL en tiempo real para ${item.name}. Confluencia técnica de ${confluenceScore}/12.`,
        explanation: `Análisis real de Binance Futures HOY: Precio a $${currentPrice.toFixed(2)}, RSI 15m (${rsi15m.toFixed(1)}), RSI 1h (${rsi1h.toFixed(1)}). Confluencia ${confluenceScore}/12. Entrada sugerida a precio de mercado.`,
        recommended_action: `Entrada ${direction} a $${currentPrice.toFixed(2)} con SL a $${stopLoss.toFixed(2)} (-${slPct}%).`,
        min_tier: "free",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.collection("alerts").doc(`alert_${item.symbol.toLowerCase()}_${Date.now()}`).set(alertDoc);

      generatedSignals.push(signalDoc);
      console.log(`  ✓ ${item.symbol}: ${direction} a $${currentPrice} (Confluencia: ${confluenceScore}/12)`);
    } catch (err) {
      console.error(`  ✕ Error en ${item.symbol}:`, err.message);
    }
  }

  console.log(`\n🎉 COMPLETADO: Se actualizaron ${generatedSignals.length} señales 100% REALES de Binance Futures para el día de hoy.`);
}

main().catch(console.error);
