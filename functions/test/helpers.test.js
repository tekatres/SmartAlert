// Unit tests for shared helpers. Run with: npm test (uses jest)
const { userMatchesAlert, DEFAULT_PREFS } = require("../src/repositories");
const { callAlertEngine } = require("../src/alertEngineClient");
const { persistAlerts } = require("../src/repositories");

// Manual fetch mock for callAlertEngine tests
global.fetch = jest.fn();

describe("userMatchesAlert", () => {
  const baseAlert = {
    id: "x",
    type: "price_surge",
    severity: "medium",
    coin_id: "bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    price_usd: 1,
    previous_price_usd: 1,
    change_pct: 1,
    volume_24h_usd: 1,
    volume_ratio: 1,
    score: 50,
    title: "",
    summary: "",
    explanation: "",
    created_at: new Date().toISOString(),
  };

  test("rejects by score", () => {
    const prefs = { ...DEFAULT_PREFS, min_score: 60 };
    expect(userMatchesAlert(prefs, baseAlert)).toBe(false);
  });

  test("rejects by type", () => {
    const prefs = { ...DEFAULT_PREFS, enabled_types: ["volume_spike"] };
    expect(userMatchesAlert(prefs, baseAlert)).toBe(false);
  });

  test("rejects by muted coin", () => {
    const prefs = { ...DEFAULT_PREFS, muted_coins: ["bitcoin"] };
    expect(userMatchesAlert(prefs, baseAlert)).toBe(false);
  });

  test("accepts when all conditions met", () => {
    expect(userMatchesAlert(DEFAULT_PREFS, baseAlert)).toBe(true);
  });
});

describe("callAlertEngine", () => {
  beforeEach(() => fetch.mockReset());

  test("posts payload and parses response", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ generated_at: "x", count: 0, alerts: [], provider: "mock", ai_provider: "mock" }),
    });
    const out = await callAlertEngine("https://api.example.com", "secret", {
      sensitivity: "medium",
      use_ai: true,
    });
    expect(out.count).toBe(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/alerts/generate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": "secret" }),
      })
    );
  });

  test("throws on non-2xx", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    await expect(
      callAlertEngine("https://api.example.com", "secret", { sensitivity: "medium", use_ai: true })
    ).rejects.toThrow(/500/);
  });
});
