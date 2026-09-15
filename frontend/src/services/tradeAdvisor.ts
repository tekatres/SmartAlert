import { PaperTrade } from "@/hooks/usePaperTrading";
import { WhaleFlowData } from "./whaleTracker";

export type AdvisorVerdict =
  | "HOLD_STRONG"       // Tendencia fuerte a favor con ballenas acumulando
  | "HOLD_NORMAL"       // Todo en orden, mantener plan
  | "MOVE_BREAKEVEN"    // Proteger capital moviendo SL a entrada
  | "TAKE_PROFIT_1"     // Alcanzado TP1, asegurar 50% de ganancias
  | "TAKE_PROFIT_2"     // Alcanzado TP2, cerrar el resto
  | "TRAILING_STOP"     // Usar trailing stop dinámico para exprimir el rally
  | "WHALE_PRESSURE_WARNING" // Ballenas vendiendo agresivamente en contra del trade
  | "EARLY_EXIT_ALERT"  // Invalidación estructural o tiempo agotado
  | "STOP_LOSS_NEAR";   // Peligro inminente de Stop Loss

export interface AdvisorAnalysis {
  verdict: AdvisorVerdict;
  verdictTitle: string;
  verdictColor: "emerald" | "amber" | "rose" | "sky" | "purple";
  emoji: string;
  pnlUsd: number;
  roePct: number;
  progressPct: number; // -100 (at SL) to +100 (at TP2), 0 at entry
  distanceToTp1Pct: number;
  distanceToSlPct: number;
  trailingStopPrice: number;
  profitIfBreakevenUsd: number;
  profitIfTp1Usd: number;
  profitIfTp2Usd: number;
  lossIfSlUsd: number;
  reasonText: string;
  suggestedAction: string;
  whaleStatusText: string;
  whaleInfluenceBadge: string;
  canMoveBreakeven: boolean;
  canTakePartial: boolean;
  canCloseMarket: boolean;
  canApplyTrailing: boolean;
  timeElapsedMinutes: number;
}

/**
 * Calculates ultra-precise position management status, trailing stop and whale pressure
 */
export function analyzeActiveTrade(
  trade: PaperTrade,
  currentPrice: number,
  whaleFlow?: WhaleFlowData | null
): AdvisorAnalysis {
  const isLong = trade.direction === "LONG";
  const entryPrice = trade.entryPrice;
  const slPrice = trade.stopLoss;
  const tp1Price = trade.tp1;
  const tp2Price = trade.tp2;

  // Real-time PnL
  const priceDiff = isLong ? currentPrice - entryPrice : entryPrice - currentPrice;
  const pnlUsd = entryPrice > 0 ? (priceDiff / entryPrice) * trade.positionUsd : 0;
  const roePct = trade.marginUsd > 0 ? (pnlUsd / trade.marginUsd) * 100 : 0;

  // Distances to objectives (in absolute %)
  const distanceToTp1Pct = currentPrice > 0 ? (Math.abs(tp1Price - currentPrice) / currentPrice) * 100 : 0;
  const distanceToSlPct = currentPrice > 0 ? (Math.abs(currentPrice - slPrice) / currentPrice) * 100 : 0;

  // Exact scenario monetary payoffs
  const profitIfBreakevenUsd = 0;
  const profitIfTp1Usd = trade.positionUsd * (trade.tp1Pct / 100) * 0.5;
  const profitIfTp2Usd = trade.positionUsd * (trade.tp2Pct / 100);
  const lossIfSlUsd = -trade.positionUsd * (trade.slPct / 100);

  // Trailing Stop Calculation:
  // If trade is in profit, lock 60% of the favorable excursion
  let trailingStopPrice = slPrice;
  if (isLong && currentPrice > entryPrice) {
    const favorableDist = currentPrice - entryPrice;
    trailingStopPrice = Math.max(slPrice, entryPrice + favorableDist * 0.60);
  } else if (!isLong && currentPrice < entryPrice) {
    const favorableDist = entryPrice - currentPrice;
    trailingStopPrice = Math.min(slPrice, entryPrice - favorableDist * 0.60);
  }

  // Calculate normalized progress:
  // -100% = price hit SL
  //    0% = price at Entry
  //  +50% = price at TP1
  // +100% = price at TP2
  let progressPct = 0;
  if (isLong) {
    if (currentPrice >= entryPrice) {
      if (tp2Price > entryPrice) {
        progressPct = Math.min(100, ((currentPrice - entryPrice) / (tp2Price - entryPrice)) * 100);
      }
    } else {
      if (entryPrice > slPrice) {
        progressPct = Math.max(-100, -((entryPrice - currentPrice) / (entryPrice - slPrice)) * 100);
      }
    }
  } else {
    // Short
    if (currentPrice <= entryPrice) {
      if (entryPrice > tp2Price) {
        progressPct = Math.min(100, ((entryPrice - currentPrice) / (entryPrice - tp2Price)) * 100);
      }
    } else {
      if (slPrice > entryPrice) {
        progressPct = Math.max(-100, -((currentPrice - entryPrice) / (slPrice - entryPrice)) * 100);
      }
    }
  }

  // Elapsed time
  const createdDate = new Date(trade.createdAt);
  const timeElapsedMinutes = Math.max(0, Math.floor((Date.now() - createdDate.getTime()) / 60000));

  // Evaluate Whale Pressure on Open Position
  let whaleStatusText = "Flujo de ballenas equilibrado";
  let whaleInfluenceBadge = "Neutral";
  let isWhaleAgainstTrade = false;
  let isWhaleWithTrade = false;

  if (whaleFlow) {
    if (isLong && whaleFlow.isBearishWhale) {
      isWhaleAgainstTrade = true;
      whaleStatusText = `⚠️ Alerta de ballenas: Ventas pesadas a mercado detectadas (Taker Ratio: ${whaleFlow.takerBuySellRatio}x). Riesgo de absorción contraria.`;
      whaleInfluenceBadge = "🚨 Presión Vendedora";
    } else if (!isLong && whaleFlow.isBullishWhale) {
      isWhaleAgainstTrade = true;
      whaleStatusText = `⚠️ Alerta de ballenas: Compras agresivas a mercado detectadas (Taker Ratio: ${whaleFlow.takerBuySellRatio}x). Posible short-squeeze institucional.`;
      whaleInfluenceBadge = "🚨 Presión Compradora";
    } else if (isLong && whaleFlow.isBullishWhale) {
      isWhaleWithTrade = true;
      whaleStatusText = `🐳 Ballenas a favor: Acumulación agresiva institucional (${whaleFlow.takerBuySellRatio}x compras). Impulso respaldado.`;
      whaleInfluenceBadge = "🐳 Ballenas a Favor";
    } else if (!isLong && whaleFlow.isBearishWhale) {
      isWhaleWithTrade = true;
      whaleStatusText = `🐳 Ballenas a favor: Descarga institucional masiva (${whaleFlow.takerBuySellRatio}x ventas). Caída respaldada por smart money.`;
      whaleInfluenceBadge = "🐳 Ballenas a Favor";
    }
  }

  // Determine broker verdict
  let verdict: AdvisorVerdict = "HOLD_NORMAL";
  let verdictTitle = "MANTENER POSICIÓN";
  let verdictColor: AdvisorAnalysis["verdictColor"] = "emerald";
  let emoji = "🟢";
  let reasonText = "El precio evoluciona favorablemente dentro del rango esperado.";
  let suggestedAction = "Mantén la operación abierta con disciplina y deja correr el trade hacia los objetivos.";
  let canMoveBreakeven = false;
  let canTakePartial = false;
  let canCloseMarket = true;
  let canApplyTrailing = false;

  // 1. Check if TP2 is reached or exceeded
  const reachedTp2 = isLong ? currentPrice >= tp2Price : currentPrice <= tp2Price;
  // 2. Check if TP1 is reached or exceeded
  const reachedTp1 = isLong ? currentPrice >= tp1Price : currentPrice <= tp1Price;
  // 3. Check if progressed more than 50% toward TP1
  const halfWayTp1 = progressPct >= 25;
  // 4. Check if SL is very close (< 0.4% from SL)
  const isSlImminent = distanceToSlPct < 0.4 && progressPct < -50;
  // 5. Stagnant trade warning (> 180 min without reaching even half way to TP1)
  const isStagnant = timeElapsedMinutes > 180 && progressPct < 15 && progressPct > -40;

  if (reachedTp2) {
    verdict = "TAKE_PROFIT_2";
    verdictTitle = "OBJETIVO TP2 ALCANZADO (+100%)";
    verdictColor = "purple";
    emoji = "🏆";
    reasonText = `El precio ha alcanzado la meta máxima prevista (${tp2Price.toFixed(4)}). Rendimiento excelente.`;
    suggestedAction = `Cierra el 100% de la posición restante para embolsarte +$${profitIfTp2Usd.toFixed(2)} USD.`;
    canTakePartial = true;
  } else if (reachedTp1) {
    verdict = "TAKE_PROFIT_1";
    verdictTitle = "TP1 ALCANZADO — TOMA 50% & RIESGO CERO";
    verdictColor = "emerald";
    emoji = "🎯";
    reasonText = `El precio tocó TP1 (${tp1Price.toFixed(4)}). Regla de broker profesional: asegura el 50% (+$${profitIfTp1Usd.toFixed(2)} USD) y sube tu SL a Breakeven.`;
    suggestedAction = "Toma el 50% de beneficio ahora mismo y mueve el Stop Loss a la Entrada. Tu riesgo será CERO absoluto.";
    canTakePartial = true;
    canMoveBreakeven = true;
    canApplyTrailing = true;
  } else if (isWhaleAgainstTrade && progressPct > 0) {
    verdict = "WHALE_PRESSURE_WARNING";
    verdictTitle = "ALERTA: BALLENAS ENTRANDO EN SENTIDO CONTRARIO";
    verdictColor = "amber";
    emoji = "⚠️";
    reasonText = whaleStatusText;
    suggestedAction = "Como el trade está en verde, asegura inmediatamente el Stop Loss en Breakeven o toma beneficios parciales antes de que el flujo institucional absorba el avance.";
    canMoveBreakeven = true;
    canTakePartial = true;
  } else if (halfWayTp1) {
    verdict = "MOVE_BREAKEVEN";
    verdictTitle = "PROTECCIÓN DE CAPITAL (MOVER A BREAKEVEN)";
    verdictColor = "amber";
    emoji = "🛡️";
    reasonText = `Has recorrido más del 50% de la distancia hacia TP1 (+${roePct.toFixed(1)}% ROE). Los operadores cuantitativos nunca permiten que una operación ganadora termine en pérdida.`;
    suggestedAction = "Ajusta tu Stop Loss al precio de Entrada. A partir de aquí no puedes perder dinero en esta operación.";
    canMoveBreakeven = true;
    canApplyTrailing = true;
  } else if (isWhaleWithTrade && progressPct > 10) {
    verdict = "HOLD_STRONG";
    verdictTitle = "IMPULSO INSTITUCIONAL A FAVOR (WHALES WITH YOU)";
    verdictColor = "emerald";
    emoji = "🚀";
    reasonText = `${whaleStatusText} La fuerza de compra institucional respalda la dirección.`;
    suggestedAction = "Deja correr la operación con calma. La presión de grandes bloques empuja hacia el objetivo.";
    canApplyTrailing = progressPct > 20;
  } else if (progressPct > 10 && roePct > 5) {
    verdict = "HOLD_STRONG";
    verdictTitle = "MOMENTUM A FAVOR — DEJAR CORRER";
    verdictColor = "emerald";
    emoji = "🚀";
    reasonText = `Fuerte tracción en la dirección del trade (+${roePct.toFixed(1)}% ROE). La estructura se mantiene sólida.`;
    suggestedAction = "No cierres por impaciencia. Deja que el mercado haga su trabajo hacia la meta de TP1.";
    canApplyTrailing = progressPct > 25;
  } else if (isSlImminent) {
    verdict = "STOP_LOSS_NEAR";
    verdictTitle = "PELIGRO: STOP LOSS CERCANO";
    verdictColor = "rose";
    emoji = "🛑";
    reasonText = `El precio está a solo ${distanceToSlPct.toFixed(2)}% de tu Stop Loss (${slPrice.toFixed(4)}). Pérdida máxima acotada: -$${Math.abs(lossIfSlUsd).toFixed(2)} USD.`;
    suggestedAction = "No muevas el SL más abajo jamás. Si toca el nivel, asume la pérdida pre-calculada sin promediar a la baja.";
  } else if (isStagnant) {
    verdict = "EARLY_EXIT_ALERT";
    verdictTitle = "OPERACIÓN ESTANCADA (>3 HORAS)";
    verdictColor = "amber";
    emoji = "⏳";
    reasonText = `La posición lleva ${Math.floor(timeElapsedMinutes / 60)}h sin generar impulso decisivo. El costo de oportunidad y las comisiones de financiamiento aumentan.`;
    suggestedAction = "Los brokers cuantitativos cierran a mercado en empate/mínima pérdida si el activo pierde volatilidad para reasignar capital a oportunidades más dinámicas.";
  } else if (progressPct < -30) {
    verdict = "HOLD_NORMAL";
    verdictTitle = "RETROCESO EN CURSO — MANTENER PLAN";
    verdictColor = "rose";
    emoji = "🔄";
    reasonText = `Pullback normal contra la entrada. Mientras no quiebre el SL en ${slPrice.toFixed(4)}, la hipótesis técnica sigue vigente.`;
    suggestedAction = "Mantén la disciplina. Evita el pánico de cerrar prematuramente si la estructura mayor sigue intacta.";
  }

  return {
    verdict,
    verdictTitle,
    verdictColor,
    emoji,
    pnlUsd,
    roePct,
    progressPct,
    distanceToTp1Pct,
    distanceToSlPct,
    trailingStopPrice: parseFloat(trailingStopPrice.toFixed(4)),
    profitIfBreakevenUsd,
    profitIfTp1Usd,
    profitIfTp2Usd,
    lossIfSlUsd,
    reasonText,
    suggestedAction,
    whaleStatusText,
    whaleInfluenceBadge,
    canMoveBreakeven,
    canTakePartial,
    canCloseMarket,
    canApplyTrailing,
    timeElapsedMinutes,
  };
}
