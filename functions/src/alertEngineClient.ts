// HTTP client for the FastAPI alert engine.
import { AlertGenerationResponse } from "./types";

export interface GenerateAlertsInput {
  coins?: string[];
  sensitivity: "low" | "medium" | "high";
  use_ai: boolean;
  signal_thresholds?: {
    min_confluence: number;
    min_risk_reward: number;
    min_adx: number;
  };
}

export async function callAlertEngine(
  baseUrl: string,
  apiKey: string,
  payload: GenerateAlertsInput
): Promise<AlertGenerationResponse> {
  const url = `${baseUrl.replace(/\/$/, "")}/alerts/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Alert engine responded ${res.status}: ${text.slice(0, 500)}`
    );
  }

  return (await res.json()) as AlertGenerationResponse;
}
