// Strongly-typed shape for alerts coming from the FastAPI engine.
// Mirrors backend/app/models/schemas.py
export type AlertType =
  | "price_surge"
  | "price_dump"
  | "volume_spike"
  | "breakout";

export type AlertSeverity = "low" | "medium" | "high";
export type SignalDirection = "LONG" | "SHORT" | "WAIT";

export interface AlertPayload {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  coin_id: string;
  symbol: string;
  name: string;
  price_usd: number;
  previous_price_usd: number;
  change_pct: number;
  volume_24h_usd: number;
  volume_ratio: number;
  score: number;
  title: string;
  summary: string;
  explanation: string;
  recommended_action?: string | null;
  min_tier: "free" | "premium";
  created_at: string; // ISO
  expires_at?: string | null;
}

export interface SignalVote {
  name: string;
  vote: "LONG" | "SHORT" | "NEUTRAL";
  weight: number;
  value: number;
  explanation: string;
}

export interface SignalOutcome {
  result: "WIN" | "LOSS" | "PENDING";
  hit_level: "TP1" | "TP2" | "SL" | "NONE";
  profitable_1h?: boolean | null;
  profitable_4h?: boolean | null;
  price_1h?: number | null;
  price_4h?: number | null;
  max_favorable_excursion_pct?: number | null;
  max_adverse_excursion_pct?: number | null;
  checked_at?: string | null;
}

export interface SignalEvaluationResponse {
  signal_id: string;
  outcome: SignalOutcome;
}

export interface TradingSignalPayload {
  id: string;
  coin_id: string;
  symbol: string;
  name: string;
  direction: SignalDirection;
  confluence_score: number;
  confluence_total: number;
  confidence: number;
  entry_price: number;
  leverage: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  risk_reward: number;
  atr: number;
  sl_pct: number;
  tp1_pct: number;
  tp2_pct: number;
  votes: SignalVote[];
  bias_15m: string;
  bias_1h: string;
  bias_4h: string;
  funding_rate: number;
  open_interest: number;
  signal_type: string;
  min_tier: "free" | "premium";
  created_at: string; // ISO
  expires_at?: string | null;
  outcome?: SignalOutcome | null;
}

export interface AlertGenerationResponse {
  generated_at: string;
  count: number;
  alerts: AlertPayload[];
  trading_signals: TradingSignalPayload[];
  provider: string;
  ai_provider: string;
}
