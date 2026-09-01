# Smart Alerts AI - Cloud Functions

These functions orchestrate the platform end-to-end.

## Functions

| Function | Type | Purpose |
|---|---|---|
| `onAuthCreate` | `beforeUserCreated` | Creates `users/{uid}` with default preferences |
| `generateAlertsCron` | `onSchedule (5m)` | Calls FastAPI engine, persists alerts |
| `onAlertCreated` | `onDocumentCreated` | Sends FCM push to matching users |
| `cleanupJob` | `onSchedule (1h)` | Drops expired alerts and invalid FCM tokens |
| `registerFcmToken` | `https.onCall` | Stores user's FCM device token |
| `updateUserPreferences` | `https.onCall` | Updates user alert preferences |
| `createCheckoutSession` | `https.onCall` | Creates Stripe Checkout session (Premium) |
| `stripeWebhook` | `https.onRequest` | Handles Stripe subscription events |
| `triggerAlerts` | `https.onRequest` | Manual admin trigger (testing/backfill) |

## Required secrets

```bash
firebase functions:secrets:set ALERT_ENGINE_URL       # https://api.your-domain.com
firebase functions:secrets:set ALERT_ENGINE_API_KEY   # matches FastAPI INTERNAL_API_KEY
firebase functions:secrets:set ADMIN_TOKEN             # protects /triggerAlerts
firebase functions:secrets:set STRIPE_SECRET           # optional, for Premium
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET   # optional
```

## Local development

```bash
npm install
npm test               # jest unit tests
npm run build
npm run serve          # Firebase emulators (auth, functions, firestore)
```

## Deploy

```bash
npm run deploy
# Or all-in-one from the repo root:
firebase deploy --only functions
```

## Manual trigger

```bash
curl -X POST https://us-central1-<project>.cloudfunctions.net/triggerAlerts \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sensitivity":"medium","use_ai":true}'
```

## Logs

```bash
npm run logs
# or filtered:
firebase functions:log --only onAlertCreated
```
