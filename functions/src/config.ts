// Centralized configuration with secrets support.
// Secrets are read from process.env when deployed to Cloud Functions (2nd gen).
import { defineSecret, defineString } from "firebase-functions/params";

export const ALERT_ENGINE_URL = defineSecret("ALERT_ENGINE_URL");
export const ALERT_ENGINE_API_KEY = defineSecret("ALERT_ENGINE_API_KEY");

// Optional: cron schedule override (default: every 5 minutes)
export const CRON_SCHEDULE = defineString("CRON_SCHEDULE", {
  default: "every 5 minutes",
});
