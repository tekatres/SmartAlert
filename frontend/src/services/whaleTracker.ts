/**
 * Service for tracking Large Institutional Whales & Smart Money Flow
 * Uses Binance Futures public metrics:
 * 1. Taker Long/Short Ratio (market orders aggressive buy vs sell)
 * 2. Top Trader Long/Short Account Ratio (top 20% capital accounts)
 * 3. Open Interest (institutional capital inflow/outflow)
 */

export interface WhaleFlowData {
  takerBuySellRatio: number;      // e.g. 1.25 = 25% more aggressive market buying
  topTraderLongRatio: number;     // e.g. 0.54 = 54% of top accounts are LONG
  topTraderLongShortRatio: number;// e.g. 1.18 = Long/Short ratio of top traders
  openInterestCoins: number;      // Contracts/coins held in open positions
  whaleBias: "WHALE_ACCUMULATION" | "WHALE_DISTRIBUTION" | "NEUTRAL";
  whaleConfidence: number;        // 0 to 100
  narrative: string;
  badgeText: string;
  isBullishWhale: boolean;
  isBearishWhale: boolean;
}

export async function fetchWhaleFlow(binanceSymbol: string): Promise<WhaleFlowData> {
  try {
    const [takerRes, topTraderRes, oiRes] = await Promise.all([
      fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${binanceSymbol}&period=1h&limit=3`),
      fetch(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${binanceSymbol}&period=1h&limit=3`),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSymbol}`),
    ]);

    let takerRatio = 1.0;
    if (takerRes.ok) {
      const takerData = await takerRes.json();
      if (Array.isArray(takerData) && takerData.length > 0) {
        takerRatio = parseFloat(takerData[takerData.length - 1].buySellRatio || "1.0");
      }
    }

    let topTraderLongRatio = 0.5;
    let topTraderLongShortRatio = 1.0;
    if (topTraderRes.ok) {
      const topData = await topTraderRes.json();
      if (Array.isArray(topData) && topData.length > 0) {
        const latest = topData[topData.length - 1];
        topTraderLongRatio = parseFloat(latest.longAccount || "0.5");
        topTraderLongShortRatio = parseFloat(latest.longShortRatio || "1.0");
      }
    }

    let openInterest = 0;
    if (oiRes.ok) {
      const oiData = await oiRes.json();
      if (oiData && oiData.openInterest) {
        openInterest = parseFloat(oiData.openInterest);
      }
    }

    // Evaluate Whale Bias
    const isAggressiveBuy = takerRatio >= 1.15;
    const isAggressiveSell = takerRatio <= 0.88;
    const isTopLong = topTraderLongShortRatio >= 1.12;
    const isTopShort = topTraderLongShortRatio <= 0.88;

    let whaleBias: WhaleFlowData["whaleBias"] = "NEUTRAL";
    let badgeText = "Ballenas Neutrales";
    let narrative = "Volumen de compra y venta equilibrado entre grandes participantes.";
    let whaleConfidence = 50;

    if (isAggressiveBuy && isTopLong) {
      whaleBias = "WHALE_ACCUMULATION";
      badgeText = `🐳 BALLENAS: ACUMULACIÓN AGRESIVA (${takerRatio.toFixed(2)}x)`;
      narrative = `Las grandes cuentas y las órdenes de mercado institucionales están comprando agresivamente (${(topTraderLongRatio * 100).toFixed(0)}% en largo, Taker Ratio: ${takerRatio.toFixed(2)}x).`;
      whaleConfidence = Math.min(95, Math.round(50 + (takerRatio - 1) * 60));
    } else if (isAggressiveBuy) {
      whaleBias = "WHALE_ACCUMULATION";
      badgeText = `🐳 BALLENAS: PRESIÓN COMPRADORA (${takerRatio.toFixed(2)}x)`;
      narrative = `Compras agresivas a mercado detectadas en bloques institucionales (${takerRatio.toFixed(2)}x volumen comprador).`;
      whaleConfidence = 75;
    } else if (isAggressiveSell && isTopShort) {
      whaleBias = "WHALE_DISTRIBUTION";
      badgeText = `🚨 BALLENAS: DISTRIBUCIÓN AGRESIVA (${takerRatio.toFixed(2)}x)`;
      narrative = `Ventas institucionales pesadas a mercado detectadas y las mayores cuentas están reduciendo o en corto (Taker Ratio: ${takerRatio.toFixed(2)}x).`;
      whaleConfidence = Math.min(95, Math.round(50 + (1 - takerRatio) * 70));
    } else if (isAggressiveSell) {
      whaleBias = "WHALE_DISTRIBUTION";
      badgeText = `🚨 BALLENAS: PRESIÓN VENDEDORA (${takerRatio.toFixed(2)}x)`;
      narrative = `Ventas a mercado agresivas superando a las órdenes de compra (${takerRatio.toFixed(2)}x ratio).`;
      whaleConfidence = 72;
    }

    return {
      takerBuySellRatio: parseFloat(takerRatio.toFixed(2)),
      topTraderLongRatio: parseFloat(topTraderLongRatio.toFixed(3)),
      topTraderLongShortRatio: parseFloat(topTraderLongShortRatio.toFixed(2)),
      openInterestCoins: Math.round(openInterest),
      whaleBias,
      whaleConfidence,
      narrative,
      badgeText,
      isBullishWhale: whaleBias === "WHALE_ACCUMULATION",
      isBearishWhale: whaleBias === "WHALE_DISTRIBUTION",
    };
  } catch (err) {
    console.warn(`[whaleTracker] Error fetching whale data for ${binanceSymbol}:`, err);
    return {
      takerBuySellRatio: 1.0,
      topTraderLongRatio: 0.5,
      topTraderLongShortRatio: 1.0,
      openInterestCoins: 0,
      whaleBias: "NEUTRAL",
      whaleConfidence: 50,
      narrative: "Flujo institucional estándar.",
      badgeText: "Ballenas Neutrales",
      isBullishWhale: false,
      isBearishWhale: false,
    };
  }
}
