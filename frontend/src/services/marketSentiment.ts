export interface MarketSentimentData {
  fearAndGreedValue: number;
  fearAndGreedClassification: string;
  sentimentBias: "EXTREME_FEAR" | "FEAR" | "NEUTRAL" | "GREED" | "EXTREME_GREED";
  shortWarning: boolean;
  longWarning: boolean;
  macroEventAlert: string | null;
  updatedAt: string;
}

export async function fetchMarketSentiment(): Promise<MarketSentimentData> {
  try {
    const res = await fetch("https://api.alternative.me/fapi/?limit=1");
    if (!res.ok) throw new Error("Failed to fetch sentiment");
    const json = await res.json();
    const item = json.data?.[0];
    const val = parseInt(item?.value || "50", 10);
    const classification = item?.value_classification || "Neutral";

    let sentimentBias: MarketSentimentData["sentimentBias"] = "NEUTRAL";
    if (val <= 25) sentimentBias = "EXTREME_FEAR";
    else if (val <= 45) sentimentBias = "FEAR";
    else if (val >= 75) sentimentBias = "EXTREME_GREED";
    else if (val >= 55) sentimentBias = "GREED";

    return {
      fearAndGreedValue: val,
      fearAndGreedClassification: classification,
      sentimentBias,
      // In Extreme Fear, aggressive SHORTs carry higher squeeze risk
      shortWarning: sentimentBias === "EXTREME_FEAR",
      // In Extreme Greed, aggressive LONGs carry higher dump risk
      longWarning: sentimentBias === "EXTREME_GREED",
      macroEventAlert: val <= 20 || val >= 80 ? "⚠️ Alta volatilidad de sentimiento en el mercado general" : null,
      updatedAt: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    };
  } catch (err) {
    console.warn("Could not fetch sentiment, fallback to default", err);
    return {
      fearAndGreedValue: 50,
      fearAndGreedClassification: "Neutral",
      sentimentBias: "NEUTRAL",
      shortWarning: false,
      longWarning: false,
      macroEventAlert: null,
      updatedAt: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    };
  }
}
