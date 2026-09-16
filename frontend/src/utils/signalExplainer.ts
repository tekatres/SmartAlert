import { TradingSignalDoc } from "@/types";

export interface SignalExplanation {
  mainThesis: string;
  keyDrivers: string[];
  actionPlan: string;
  warningNotice?: string | null;
  marketContext: string;
}

export function generateClearSignalExplanation(signal: TradingSignalDoc): SignalExplanation {
  const isLong = signal.direction === "LONG";
  const symbol = signal.symbol;
  const score = signal.confluence_score ?? 0;
  const total = signal.confluence_total ?? 12;
  const phase = signal.market_phase || (score >= 8 ? "PULLBACK" : "TREND_IMPULSE");
  const votes = signal.votes || [];

  // Categorize votes
  const supportingVotes = votes.filter((v) => v.vote === signal.direction);
  const opposingVotes = votes.filter((v) => v.vote !== "NEUTRAL" && v.vote !== signal.direction);

  // Identify special market factors
  const hasWhaleAccumulation = signal.whale_flow?.bias === "WHALE_ACCUMULATION";
  const hasWhaleDistribution = signal.whale_flow?.bias === "WHALE_DISTRIBUTION";
  const hasBullSweep = signal.liquidity_sweep?.trap === "BEAR_SWEEP"; // Bear trap -> bullish
  const hasBearSweep = signal.liquidity_sweep?.trap === "BULL_SWEEP"; // Bull trap -> bearish
  const hasDivergence = signal.rsi_divergence === "BULLISH" || signal.rsi_divergence === "BEARISH";
  const btcAligned = signal.btc_guard?.status === "ALIGNED";
  const btcBlocked = signal.btc_guard?.status === "BLOCKED";
  const hasCandlePattern = Boolean(signal.candle_pattern && signal.candle_pattern !== "NONE");

  // 1. Synthesize Main Thesis (Why enter this trade?)
  let mainThesis = "";

  if (hasBullSweep && isLong) {
    mainThesis = `Trampa bajista institucional superada: se barrieron los stops bajo soporte y las ballenas absorbieron la liquidez con fuerte volumen, abriendo paso a un rebote alcista hacia resistencias superiores.`;
  } else if (hasBearSweep && !isLong) {
    mainThesis = `Trampa alcista institucional detectada: el precio perforó falsamente la resistencia para capturar liquidez de compradores tardíos (FOMO) antes de un rechazo bajista contundente.`;
  } else if (hasDivergence) {
    mainThesis = `Agotamiento de la presión contraria por divergencia en el RSI: mientras el precio marcaba extremos, la fuerza vendedora/compradora se agotó, señalando un giro inminente a favor de la tendencia.`;
  } else if (isLong) {
    if (phase === "PULLBACK") {
      mainThesis = `Estructura alcista sólida en retroceso técnico controlado: el precio descansa sobre medias móviles institucionales (EMA21 / VWAP), ofreciendo una ventana de entrada con ratio riesgo/beneficio muy favorable.`;
    } else if (score >= 9) {
      mainThesis = `Fuerte impulso de continuación alcista: el abanico de medias móviles institucionales está perfectamente alineado y el flujo comprador domina los libros de órdenes.`;
    } else {
      mainThesis = `Tendencia alcista moderada con soporte en medias dinámicas. Confluencia favorable pero recomendando esperar entrada en zona óptima de retroceso.`;
    }
  } else {
    if (phase === "PULLBACK") {
      mainThesis = `Estructura bajista en descanso correctivo: el precio ha rebotado temporalmente hacia resistencias dinámicas (EMA21 / VWAP), momento ideal para posicionarse a favor de la tendencia principal.`;
    } else if (score >= 9) {
      mainThesis = `Presión vendedora institucional dominante: precio cotizando bajo EMA200 con aceleración de volumen bajista y ruptura de soportes clave.`;
    } else {
      mainThesis = `Tendencia bajista activa con resistencia superior fuerte. Se recomienda operar solo en zonas de rechazo con Stop Loss estricto.`;
    }
  }

  // 2. Extract Top 3-4 Key Drivers (Concrete reasons)
  const keyDrivers: string[] = [];

  // EMA & Trend structure
  const emaVote = supportingVotes.find((v) => v.name.toLowerCase().includes("ema") || v.name.toLowerCase().includes("estructura"));
  if (emaVote) {
    keyDrivers.push(
      isLong
        ? `Estructura Técnica: Precio consolidando sobre soporte institucional y medias móviles alcistas.`
        : `Estructura Técnica: Precio bajo medias móviles clave (EMA9/21/50) con estructura de máximos decrecientes.`
    );
  } else {
    keyDrivers.push(
      isLong
        ? `Soporte Institucional: El precio defiende la zona de VWAP y EMA200.`
        : `Resistencia Institucional: El precio no logra superar la zona de resistencia dinámica.`
    );
  }

  // Whale / Smart Money
  if (hasWhaleAccumulation) {
    keyDrivers.push(`Radar de Ballenas: Acumulación compradora neta activa en libros de órdenes institucionales.`);
  } else if (hasWhaleDistribution) {
    keyDrivers.push(`Radar de Ballenas: Distribución vendedora institucional con salida de capital.`);
  } else if (signal.whale_flow) {
    keyDrivers.push(`Flujo Institucional: Ratio de compradores ${signal.whale_flow.taker_ratio}x equilibrado.`);
  }

  // Divergence or Momentum
  if (signal.rsi_divergence && signal.rsi_divergence !== "NONE") {
    keyDrivers.push(
      `Divergencia RSI: Confirmación de pérdida de fuerza ${isLong ? "vendedora" : "compradora"} (${signal.rsi_divergence}).`
    );
  } else if (hasCandlePattern) {
    keyDrivers.push(`Gatillo de Velas: Patrón de confirmación ${signal.candle_pattern} en temporalidad intradía.`);
  } else {
    const rsiVote = supportingVotes.find((v) => v.name.toLowerCase().includes("rsi") || v.name.toLowerCase().includes("momentum"));
    if (rsiVote) {
      keyDrivers.push(`Momentum Confirmado: Indicadores de oscilación y fuerza alineados a favor de ${signal.direction}.`);
    }
  }

  // BTC Guard context
  if (symbol !== "BTC" && btcAligned) {
    keyDrivers.push(`Liderazgo de Mercado (BTC Guard): Bitcoin respalda el movimiento impulsando la dirección del mercado.`);
  }

  // Ensure we have at least 3 clean drivers
  if (keyDrivers.length < 3) {
    keyDrivers.push(`Confluencia de Pilares: ${score} de los ${total} indicadores del algoritmo validan esta operación simultáneamente.`);
  }

  // 3. Action Plan (Clear instructions for the trader)
  let actionPlan = "";
  if (phase === "OVEREXTENDED") {
    actionPlan = `⚠️ Precaución: El precio está sobreextendido. NO compres a mercado ahora mismo. Coloca una orden límite en la zona de retroceso entre $${signal.entry_zone_min?.toLocaleString("en-US", { maximumFractionDigits: 4 }) || signal.entry_price} y $${signal.entry_zone_max?.toLocaleString("en-US", { maximumFractionDigits: 4 }) || signal.entry_price} para proteger tu ratio riesgo/beneficio.`;
  } else {
    actionPlan = `Ejecución recomendada: Entrar en el rango de pullback ($${signal.entry_zone_min?.toLocaleString("en-US", { maximumFractionDigits: 4 }) || signal.entry_price} – $${signal.entry_zone_max?.toLocaleString("en-US", { maximumFractionDigits: 4 }) || signal.entry_price}). Programar salida parcial del 50% en TP1 ($${signal.take_profit_1.toLocaleString("en-US", { maximumFractionDigits: 4 })}). Al tocar TP1, mover Stop Loss al precio de entrada para dejar correr el resto con RIESGO CERO.`;
  }

  // 4. Warning notice if any
  let warningNotice: string | null = null;
  if (btcBlocked) {
    warningNotice = `BTC Beta Guard alerta: Bitcoin muestra tendencia contraria (${signal.btc_guard?.btc_direction}). Se recomienda menor tamaño de posición o esperar a que Bitcoin estabilice.`;
  } else if (signal.anti_fomo_warning) {
    warningNotice = signal.anti_fomo_warning;
  } else if (opposingVotes.length >= 4) {
    warningNotice = `Señales mixtas: Hay ${opposingVotes.length} indicadores en contra de la operación. Mantén apalancamiento conservador (máximo ${signal.leverage}x).`;
  }

  // 5. Market Context summary
  const marketContext = `${symbol} ${signal.direction} · Confluencia ${score}/${total} (${Math.round((score / total) * 100)}%) · R:R 1:${signal.risk_reward.toFixed(2)}`;

  return {
    mainThesis,
    keyDrivers: keyDrivers.slice(0, 3),
    actionPlan,
    warningNotice,
    marketContext,
  };
}
