// Cloud Functions entrypoint.
import { initializeApp, getApps } from "firebase-admin/app";

if (getApps().length === 0) {
  initializeApp();
}

// Triggers
export { onAuthCreate } from "./handlers/onAuthCreate";
export { onAlertCreated } from "./handlers/onAlertCreated";
export { onTradingSignalCreated } from "./handlers/onTradingSignalCreated";

// Scheduled
export { generateAlertsCron } from "./handlers/generateAlertsCron";
export { cleanupJob } from "./handlers/cleanupJob";
export { scoreOutcomeJob } from "./handlers/scoreOutcomeJob";
export { deliverDelayedFreeAlerts } from "./handlers/deliverDelayedFreeAlerts";

// Callables
export { registerFcmToken } from "./handlers/registerFcmToken";
export { updateUserPreferences } from "./handlers/updateUserPreferences";
export { createCheckoutSession } from "./handlers/createCheckoutSession";
export { submitAlertFeedback } from "./handlers/submitAlertFeedback";
export { getConversionStats } from "./handlers/getConversionStats";
export { trackCtaEvent } from "./handlers/trackCtaEvent";
export { setEngineConfig } from "./handlers/setEngineConfig";
export { getEngineConfig } from "./handlers/getEngineConfig";

// HTTPS
export { triggerAlerts } from "./handlers/triggerAlerts";
export { stripeWebhook } from "./handlers/stripeWebhook";
