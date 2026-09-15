// Market protection filters: Liquidity Sweep detection, Macro Blackout
// calendar and Choppiness/Weekend regime guard. All frontend-only.

export interface LiquiditySweepResult {
  trap: "BEAR_SWEEP" | "BULL_SWEEP" | null; // BEAR_SWEEP = swept lows & reclaimed -> whales LONG
  level: number;
  wickPct: number; // how deep/high the sweep pierced the level (price %)
  absorption: boolean; // volume spike confirming absorption
  narrative: string;
}

export interface RegimeGuardResult {
  choppy: boolean;
  ci: number; // Choppiness Index (0-100)
  isWeekend: boolean;
  volumeRatio: number;
  requiredConfluence: number; // effective minimum confluence to publish
  explanation: string;
}

export interface MacroEvent {
  title: string;
  country: string;
  date: number; // unix seconds
  impact: string;
}

export interface MacroBlackoutResult {
  blocked: boolean;
  activeEvents: MacroEvent[];
  nextEvent: MacroEvent | null;
  explanation: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// #2 LIQUIDITY SWEEP / STOP-HUNT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects a liquidity sweep on the last candles of 15m data:
 * - Price breaks a recent swing low/high (triggering stops) but the candle
 *   closes back inside, leaving a long wick with volume absorption.
 * - That confirms a stop-hunt trap; the real (whale) direction is the
 *   opposite of the sweep.
 */
export function detectLiquiditySweep(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): LiquiditySweepResult {
  const n = closes.length;
  const none: LiquiditySweepResult = {
    trap: null,
    level: 0,
    wickPct: 0,
    absorption: false,
    narrative: "Sin barrida de liquidez en las últimas velas.",
  };
  if (n < 8) return none;

  const lookback = Math.min(3, n - 2);
  const swingHigh = Math.max(...highs.slice(0, n - lookback));
  const swingLow = Math.min(...lows.slice(0, n - lookback));
  const avgVol = volumes.slice(0, n - 1).reduce((a, b) => a + b, 0) / (n - 1);

  // Scan the last `lookback` candles (sweep + reclaim within ~15-45 min)
  for (let i = n - lookback; i < n; i++) {
    const absorption = avgVol > 0 && volumes[i] >= 1.2 * avgVol;

    // Swept the recent low but closed back above it -> stop-hunt below
    if (lows[i] < swingLow && closes[i] > swingLow) {
      const wickPct = swingLow > 0 ? ((swingLow - lows[i]) / swingLow) * 100 : 0;
      return {
        trap: "BEAR_SWEEP",
        level: swingLow,
        wickPct,
        absorption,
        narrative: absorption
          ? `Trampa bajista: el precio barrió el mínimo de ${swingLow.toFixed(4)} (-${wickPct.toFixed(2)}%) y recuperó con volumen. Stop-hunt → los cazadores de liquidez COMPRAN.`
          : `Posible barrida del mínimo ${swingLow.toFixed(4)} con recuperación, pero sin volumen de absorción claro.`,
      };
    }

    // Swept the recent high but closed back below it -> stop-hunt above
    if (highs[i] > swingHigh && closes[i] < swingHigh) {
      const wickPct = swingHigh > 0 ? ((highs[i] - swingHigh) / swingHigh) * 100 : 0;
      return {
        trap: "BULL_SWEEP",
        level: swingHigh,
        wickPct,
        absorption,
        narrative: absorption
          ? `Trampa alcista: el precio barrió el máximo de ${swingHigh.toFixed(4)} (+${wickPct.toFixed(2)}%) y se rechazó con volumen. Stop-hunt → los cazadores de liquidez VENDEN.`
          : `Posible barrida del máximo ${swingHigh.toFixed(4)} con rechazo, pero sin volumen de absorción claro.`,
      };
    }
  }

  return none;
}

// ─────────────────────────────────────────────────────────────────────────────
// #4 CHOPPINESS INDEX + WEEKEND VOLATILITY GUARD
// ─────────────────────────────────────────────────────────────────────────────

export function computeChoppiness(
  closes: number[],
  highs: number[],
  lows: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trueRanges.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  const windowTR = trueRanges.slice(-period);
  const sumTR = windowTR.reduce((a, b) => a + b, 0);
  const hi = Math.max(...highs.slice(-(period + 1)));
  const lo = Math.min(...lows.slice(-(period + 1)));
  const range = hi - lo;
  if (sumTR <= 0 || range <= 0 || period <= 1) return null;
  return Math.round((100 * Math.log10(sumTR / range)) / Math.log10(period) * 10) / 10;
}

export function isWeekend(now: Date = new Date()): boolean {
  const day = now.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Regime guard: in choppy markets (Choppiness > 61.8) or on weekend / low
 * volume windows, momentum signals are unreliable -> raise the minimum
 * confluence required to publish a signal (trap-day protection).
 */
export function computeRegimeGuard(
  closes1h: number[],
  highs1h: number[],
  lows1h: number[],
  volumeRatio: number,
  baseThreshold: number,
  now: Date = new Date(),
): RegimeGuardResult {
  const ci = computeChoppiness(closes1h, highs1h, lows1h, 14);
  const choppy = ci !== null && ci > 61.8;
  const weekend = isWeekend(now);
  const lowVol = volumeRatio < 0.45;

  let requiredConfluence = baseThreshold;
  let reason: string;
  if (choppy) {
    requiredConfluence = Math.max(10, baseThreshold);
    reason = `Choppiness Index ${ci} > 61.8 → mercado lateral/trampa. Confluencia mínima elevada a 10/12.`;
  } else if (weekend && lowVol) {
    requiredConfluence = Math.max(9, baseThreshold);
    reason = `Fin de semana con volumen ${(volumeRatio * 100).toFixed(0)}% del promedio → día trampa. Confluencia mínima elevada a 9/12.`;
  } else if (weekend) {
    requiredConfluence = Math.max(9, baseThreshold);
    reason = "Fin de semana → menor liquidez institucional. Confluencia mínima elevada a 9/12.";
  } else if (lowVol) {
    requiredConfluence = Math.max(9, baseThreshold);
    reason = `Volumen ${(volumeRatio * 100).toFixed(0)}% del promedio → momentum poco fiable. Confluencia mínima elevada a 9/12.`;
  } else {
    reason = `Mercado en régimen normal (Choppiness ${ci ?? "n/a"}, vol ${(volumeRatio * 100).toFixed(0)}% del promedio). Umbral base ${baseThreshold}/12.`;
  }

  return {
    choppy,
    ci: ci ?? 50,
    isWeekend: weekend,
    volumeRatio,
    requiredConfluence,
    explanation: reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// #3 MACRO ECONOMIC CALENDAR BLACKOUT
// ─────────────────────────────────────────────────────────────────────────────

const MACRO_FEED_URLS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_today.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];
const BLACKOUT_MINUTES = 30;

// Only these countries move crypto at the institutional level
const HIGH_IMPACT_COUNTRIES = new Set(["USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD"]);

function normalizeMacroEvent(e: any): MacroEvent | null {
  const title = String(e?.title || "");
  const country = String(e?.country || "");
  const date = Number(e?.date);
  if (!title || !country || !(date > 0)) return null;
  return {
    title,
    country,
    date: date * 1000, // feed gives unix seconds -> ms
    impact: String(e?.impact || "Low"),
  };
}

async function fetchMacroEvents(): Promise<MacroEvent[]> {
  let lastError: unknown = null;
  for (const url of MACRO_FEED_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Macro feed ${url} responded ${res.status}`);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error("Unexpected macro feed shape");
      const events = raw
        .map(normalizeMacroEvent)
        .filter((e): e is MacroEvent => e !== null)
        .filter((e) => e.impact === "High" && HIGH_IMPACT_COUNTRIES.has(e.country));
      if (events.length > 0) return events;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("All macro calendar feeds failed");
}

/**
 * Returns the current blackout state: blocked=true when now is within
 * ±30 min of a high-impact macro event. Falls back to blocked=false if the
 * calendar cannot be fetched (graceful degradation).
 */
export async function getMacroBlackout(
  now: Date = new Date(),
  fetchEvents: () => Promise<MacroEvent[]> = fetchMacroEvents,
): Promise<MacroBlackoutResult> {
  const result: MacroBlackoutResult = {
    blocked: false,
    activeEvents: [],
    nextEvent: null,
    explanation: "Sin eventos macro de alto impacto en la ventana actual.",
  };
  try {
    const events = await fetchEvents();
    const windowStart = now.getTime() - BLACKOUT_MINUTES * 60_000;
    const windowEnd = now.getTime() + BLACKOUT_MINUTES * 60_000;

    result.activeEvents = events
      .filter((e) => e.date >= windowStart && e.date <= windowEnd)
      .sort((a, b) => a.date - b.date);

    const future = events
      .filter((e) => e.date > now.getTime())
      .sort((a, b) => a.date - b.date);
    result.nextEvent = future[0] ?? null;

    if (result.activeEvents.length > 0) {
      result.blocked = true;
      const list = result.activeEvents
        .map((e) => `${e.title} (${e.country})`)
        .join(", ");
      result.explanation = `🔴 REFUGIO / NO OPERAR: evento macro de alto impacto en curso — ${list}. ±${BLACKOUT_MINUTES} min.`;
    }
  } catch (err) {
    console.warn("Could not fetch macro calendar, blackout disabled:", err);
  }
  return result;
}

/** Quick synchronous weekend guard check (no API needed). */
export function getWeekendStatus(now: Date = new Date()): { isWeekend: boolean; label: string } {
  const weekend = isWeekend(now);
  return {
    isWeekend: weekend,
    label: weekend ? "Fin de semana — liquidez reducida" : "Día laborable",
  };
}