export type AlertType =
  | "price_surge"
  | "price_dump"
  | "volume_spike"
  | "breakout";

export type AlertSeverity = "low" | "medium" | "high";
export type SignalDirection = "LONG" | "SHORT" | "WAIT";

export type UserTier = "free" | "premium" | "pro";

export interface ScoreFactor {
  key: string;
  label: string;
  value: number;
  points: number;
  max_points: number;
  explanation: string;
}

export interface ScoreBreakdown {
  total: number;
  confidence: number;
  tier: UserTier;
  factors: ScoreFactor[];
  narrative: string;
  model_version: string;
}

export interface AlertOutcome {
  checked_at: { seconds: number; nanoseconds: number } | string | null;
  price_after_1h?: number | null;
  profitable_1h?: boolean | null;
  score_was_correct?: boolean | null;
}

export interface AlertDoc {
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
  score_breakdown?: ScoreBreakdown | null;
  title: string;
  summary: string;
  explanation: string;
  recommended_action?: string | null;
  visible_to_free?: boolean;
  min_tier?: UserTier;
  premium_only_reason?: string | null;
  created_at: { seconds: number; nanoseconds: number } | string;
  expires_at?: { seconds: number; nanoseconds: number } | string | null;
  delivered_count?: number;
  outcome?: AlertOutcome | null;
  feedback?: {
    total: number;
    useful: number;
    not_useful: number;
    acted_on: number;
    ignored: number;
    false_positive: number;
    last_at?: { seconds: number; nanoseconds: number } | string | null;
  };
}

export interface UserPreferences {
  sensitivity: "low" | "medium" | "high";
  enabled_types: AlertType[];
  min_score: number;
  muted_coins: string[];
  plan: UserTier;
}

export interface FcmDevice {
  token: string;
  platform: "web" | "android" | "ios";
  device_id?: string | null;
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
  checked_at?: { seconds: number; nanoseconds: number } | string | null;
}

export interface SignalSetupStat {
  signal_type: string;
  wins: number;
  losses: number;
  total: number;
  updated_at?: { seconds: number; nanoseconds: number } | string | null;
}

export interface TradingSignalDoc {
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
  min_tier: UserTier;
  created_at: { seconds: number; nanoseconds: number } | string;
  expires_at?: { seconds: number; nanoseconds: number } | string | null;
  outcome?: SignalOutcome | null;
}

export interface ConversionStats {
  user_id: string;
  tier: UserTier;
  period_days: number;
  total_alerts_seen: number;
  premium_alerts_locked: number;
  missed_alerts: number;
  estimated_missed_pct: number;
  winrate_premium_avg: number;
  winrate_free_avg: number;
  ab_variant: string;
  cta_impressions: number;
  cta_clicks: number;
  cta_conversions: number;
}
