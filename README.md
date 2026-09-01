# Smart Alerts AI

> Plataforma de **alertas inteligentes en tiempo real** con explicación por IA, autenticación Firebase y push notifications a móvil/web.
> Diseñada con una **arquitectura híbrida**: Firebase como core (Auth, Firestore, FCM, Functions) + microservicio **FastAPI** como motor de detección y enriquecimiento.

---

## Tabla de contenidos
1. [Visión general](#visión-general)
2. [Arquitectura](#arquitectura)
3. [Estructura del repo](#estructura-del-repo)
4. [Quick start (local)](#quick-start-local)
5. [Variables de entorno](#variables-de-entorno)
6. [Despliegue paso a paso](#despliegue-paso-a-paso)
7. [Esquema de Firestore](#esquema-de-firestore)
8. [Ejemplo real de alerta](#ejemplo-real-de-alerta)
9. [Monetización](#monetización)
10. [Roadmap MVP → Premium](#roadmap-mvp--premium)

---

## Visión general

**Smart Alerts AI** detecta oportunidades de mercado (crypto en el MVP) mediante reglas de price-action + volumen, **enriquece cada evento con IA** (resumen, score 0-100, explicación) y **notifica al usuario** en su dispositivo en segundos.

**Diferenciador clave**: cada alerta viene con una **explicación en lenguaje claro** de por qué el sistema la considera interesante. No sólo "BTC subió", sino *"BTC repunta 4.2% en 5 minutos con volumen 1.9x por encima de la media. Movimiento alcista con confirmación de volumen. Posible continuación si mantiene el nivel."*

---

## Arquitectura

```
┌────────────────────┐    HTTP /alerts/generate   ┌──────────────────────┐
│  Cloud Function    │ ─────────────────────────► │  FastAPI Engine      │
│  (cron 1-5 min)    │                            │  - CoinGecko/Binance │
│  + onAlertCreated  │ ◄───────────────────────── │  - Reglas detección  │
└─────────┬──────────┘       Alerts (JSON)        │  - OpenAI o Mock     │
          │                                         └──────────────────────┘
          ▼
   ┌──────────────┐      ┌─────────────────────┐
   │  Firestore   │ ───► │  Push (FCM)          │ ──► Web / Android / iOS
   │  (alerts,    │      │  onAlertCreated      │
   │   users)     │      └─────────────────────┘
   └─────┬────────┘
         │ onSnapshot (real-time)
         ▼
   ┌─────────────────────┐
   │  React Frontend     │  (Vite + TS + Tailwind + PWA)
   │  - Login (Auth)     │
   │  - Dashboard        │
   │  - Settings         │
   └─────────────────────┘
```

### ¿Por qué este modelo?

- **Firebase** te da auth, DB reactiva, push, hosting y serverless con muy poco código.
- **FastAPI** te da velocidad de iteración para el motor de alertas y la IA, sin acoplarte a Node ni a Cloud Functions cold-starts.
- La Cloud Function es el **pegamento**: orquesta, persiste y dispara notificaciones.

---

## Estructura del repo

```
smart-alert/
├── backend/                  # FastAPI - Alert engine
│   ├── app/
│   │   ├── main.py           # Entry point
│   │   ├── core/             # Config + logging
│   │   ├── models/           # Pydantic schemas
│   │   ├── services/         # CoinGecko, Binance, Mock
│   │   ├── alert_engine/     # Detection rules
│   │   ├── ai/               # AI providers (OpenAI, Mock)
│   │   └── routers/          # /health, /alerts/*
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
│
├── functions/                # Firebase Cloud Functions (TypeScript)
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts                 # Secrets & params
│   │   ├── types.ts                  # AlertPayload, etc.
│   │   ├── alertEngineClient.ts      # HTTP client to FastAPI
│   │   ├── repositories.ts           # persistAlerts, findMatchingUsers
│   │   └── handlers/
│   │       ├── onAuthCreate.ts       # Auth trigger (create user doc)
│   │       ├── onAlertCreated.ts     # Firestore trigger (send FCM)
│   │       ├── generateAlertsCron.ts # Scheduled: call engine + persist
│   │       ├── cleanupJob.ts         # Scheduled: delete expired alerts/tokens
│   │       ├── registerFcmToken.ts   # Callable: store FCM token
│   │       ├── updateUserPreferences.ts  # Callable: update prefs
│   │       ├── triggerAlerts.ts      # HTTPS: manual admin trigger
│   │       ├── createCheckoutSession.ts # Callable: Stripe Premium
│   │       └── stripeWebhook.ts      # HTTPS: Stripe webhook
│   ├── test/                 # Jest tests
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                 # React + Vite + TS + Tailwind + PWA
│   └── src/
│       ├── App.tsx           # Routes (login, dashboard, history, alert detail, settings, premium, onboarding)
│       ├── main.tsx          # Theme bootstrap
│       ├── index.css         # Tailwind + light/dark variables
│       ├── pages/            # Login, Dashboard, History, AlertDetail, Settings, Onboarding, Premium
│       ├── components/       # Layout, AlertCard, Filters, MetricCard, Skeleton, Toaster, ErrorBoundary,
│       │                     # PwaPrompts, BottomNav, Chart, ProtectedRoute
│       ├── hooks/            # useAuth, useAlerts, usePushNotifications, usePwa
│       ├── services/         # firebase.ts, auth.ts, fcm.ts, alerts.ts
│       ├── store/            # Zustand (auth, alerts, toasts, theme)
│       ├── utils/            # chartSeries.ts (price/volume mock data)
│       └── types/
│
├── mobile/                   # Native config placeholders
│   ├── android/app/google-services.json
│   └── ios/Runner/GoogleService-Info.plist
│
├── scripts/                  # Admin scripts
│   └── seed-firestore.js
│
├── firebase.json             # Firebase project config
├── firestore.rules           # Security rules
├── firestore.indexes.json
├── .firebaserc
├── docker-compose.yml
└── docs/
    ├── firestore-seed.json   # Ejemplo de datos
    └── test-alerts.ps1       # Probar el motor local
```

---

## Quick start (local)

### 1. Levanta el motor FastAPI

```bash
cd backend
cp .env.example .env          # ya hay un .env dev listo
docker compose -f ../docker-compose.yml up -d --build
# o sin Docker:
#   pip install -r requirements.txt
#   uvicorn app.main:app --reload --port 8000
```

Verifica:
- `http://localhost:8000/health` → `{"status":"ok",...}`
- `http://localhost:8000/docs` → Swagger UI
- `POST http://localhost:8000/alerts/recent` → JSON con alertas mock (perfecto para demo)

### 2. Firebase (Auth + Firestore + FCM)

```bash
npm i -g firebase-tools
firebase login
firebase use --add            # selecciona tu proyecto
cd functions
npm install
cd ..
firebase emulators:start      # opcional, para dev local
```

**Configurar secrets** (obligatorio):
```bash
firebase functions:secrets:set ALERT_ENGINE_URL        # https://TU-ENGINE-URL.com
firebase functions:secrets:set ALERT_ENGINE_API_KEY    # mismo valor que INTERNAL_API_KEY del backend
firebase functions:secrets:set ADMIN_TOKEN              # token para el endpoint /triggerAlerts
firebase functions:secrets:set STRIPE_SECRET            # opcional, sólo si activas Premium
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET    # opcional
```

Sube reglas e índices:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Despliega todas las Functions:
```bash
firebase deploy --only functions
```

Funciones desplegadas (resumen):

| Nombre | Tipo | Trigger | Auth |
|---|---|---|---|
| `onAuthCreate` | `beforeUserCreated` | Auth | n/a (system) |
| `onAlertCreated` | `onDocumentCreated` | `alerts/{id}` | n/a (system) |
| `generateAlertsCron` | `onSchedule` | cada 5 min | n/a |
| `cleanupJob` | `onSchedule` | cada 1 hora | n/a |
| `registerFcmToken` | `https.onCall` | cliente | usuario autenticado |
| `updateUserPreferences` | `https.onCall` | cliente | usuario autenticado |
| `createCheckoutSession` | `https.onCall` | cliente | usuario autenticado |
| `triggerAlerts` | `https.onRequest` | admin / testing | `X-Admin-Token` |
| `stripeWebhook` | `https.onRequest` | Stripe | firma Stripe |

**Disparar manualmente el motor (sin esperar al cron):**
```bash
curl -X POST https://us-central1-<project>.cloudfunctions.net/triggerAlerts \
  -H "X-Admin-Token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"sensitivity":"medium","use_ai":true}'
```

**Sembrar datos demo en Firestore:**
```bash
# Opción A: usar el script admin
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
node scripts/seed-firestore.js

# Opción B: pegar el JSON en Firebase Console → Firestore → Import
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
# rellena con las credenciales de tu Firebase Web App
npm install
npm run dev                   # http://localhost:5173
```

---

## Variables de entorno

### Backend (`backend/.env`)

| Variable | Default | Descripción |
|---|---|---|
| `APP_ENV` | `development` | dev / staging / production |
| `APP_PORT` | `8000` | Puerto del uvicorn |
| `DATA_PROVIDER` | `mock` | `mock` \| `coingecko` \| `binance` |
| `COINS` | top 8 cryptos | Lista separada por comas |
| `PRICE_CHANGE_PCT` | `3.0` | Umbral de movimiento (%) |
| `PRICE_WINDOW_MIN` | `5` | Ventana de análisis (min) |
| `VOLUME_SPIKE_MULTIPLIER` | `2.0` | Multiplicador de volumen |
| `AI_PROVIDER` | `mock` | `mock` \| `openai` |
| `OPENAI_API_KEY` | _(vacío)_ | Tu API key de OpenAI |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo a usar |
| `INTERNAL_API_KEY` | `change-me` | Shared secret con Cloud Functions |
| `CORS_ORIGINS` | localhost:5173 | Orígenes permitidos |

### Frontend (`frontend/.env.local`)

| Variable | Descripción |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web App |
| `VITE_FIREBASE_AUTH_DOMAIN` | |
| `VITE_FIREBASE_PROJECT_ID` | |
| `VITE_FIREBASE_STORAGE_BUCKET` | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | |
| `VITE_FIREBASE_APP_ID` | |
| `VITE_FIREBASE_VAPID_KEY` | VAPID para FCM web push |

---

## Frontend (PWA)

Stack: **React 18 + Vite + TypeScript + Tailwind + Zustand + vite-plugin-pwa**.

### Pantallas

| Ruta | Pantalla | Descripción |
|---|---|---|
| `/login` | Login | Email + Google, modo signin/signup |
| `/onboarding` | Onboarding | 4 pasos: monedas, tipos, sensibilidad, push (1ª vez) |
| `/` | Dashboard | KPIs, filtros, lista de alertas en tiempo real |
| `/history` | Historial | Paginación + scroll infinito de todas las alertas |
| `/alerts/:id` | Detalle | Mini-chart de precio + volumen + análisis IA |
| `/settings` | Ajustes | Sensibilidad, tipos, score mínimo, **monedas muteadas**, push, plan |
| `/premium` | Pricing | Free / Premium / Pro + Stripe Checkout |

### Componentes clave

- **`<Toaster>`** — sistema de notificaciones in-app (4 tonos: info/success/warning/error), hook `useToast()`.
- **`<ErrorBoundary>`** — captura crashes, UI de recuperación.
- **`<Skeleton>` + `AlertListSkeleton` + `MetricCardSkeleton`** — carga progresiva.
- **`<PwaPrompts>`** — prompt "Instalar app" (4s delay, dismissed en sessionStorage) + "Nueva versión disponible".
- **`<BottomNav>`** — nav inferior móvil (Inicio / Historial / Ajustes) con safe-area iOS.
- **`<Chart>`** — Sparkline + Bars SVG, zero-dependency.
- **`<ThemeToggle>`** — dark/light con CSS variables.
- **`<UserMenu>`** — dropdown con foto, email, link a Ajustes y Premium.

### Hooks

- `useAuth()` — observa Firebase Auth + user doc (preferences en tiempo real).
- `useAlerts(pageSize)` — `onSnapshot` sobre `alerts` ordenado por `created_at desc`.
- `usePushNotifications()` — request permission + getToken + register via callable.
- `usePwaInstall()` — captura `beforeinstallprompt` para instalar la PWA.
- `usePwaUpdate()` — detecta nueva versión del SW.

### Store (Zustand)

```ts
useAppStore.getState() = {
  user, authReady, preferences,
  alerts, filterType, searchQuery,
  toasts, theme,
  setUser, setAlerts, setFilterType, setSearchQuery,
  setPreferences, setTheme,
  pushToast, dismissToast,
}
```

### Diseño

- **Dark mode** por defecto; **light mode** soportado con variables CSS en `index.css`.
- **Mobile-first**: bottom nav < 640px, header sticky con backdrop-blur.
- **Score colors** semánticas (🟢 ≥75, 🟡 50-74, 🔴 <50).
- **Accesibilidad**: roles ARIA en toasts, labels en iconos, focus rings visibles.

### Build / Deploy

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # → dist/
npm run preview      # local preview del build

# Producción
firebase deploy --only hosting
```

### PWA

- **vite-plugin-pwa** con `registerType: "autoUpdate"`.
- **Manifest** preconfigurado (theme color, iconos 192/512, standalone).
- **Service Worker** de FCM en `public/firebase-messaging-sw.js`.
- **Install prompt** se muestra 4s después de cargar (si es instalable).
- **Update prompt** notifica cuando hay nueva versión del SW.

---

## 🎯 Scoring engine v2 (orientado a conversión)

El scoring es el corazón de la monetización. Tres palancas funcionan en paralelo:

### 1) Multi-factor breakdown (6 factores, suma = 100)

| Factor | Peso | Qué mide | Por qué importa |
|---|---|---|---|
| **Magnitud** | 25 | % de movimiento absoluto | Señal cruda de oportunidad |
| **Volumen** | 20 | Ratio vs media 24h | Filtra "ruido" sin convicción |
| **Tendencia** | 15 | Fuerza y dirección 24h/1h | Evita operar contra-tendencia |
| **Volatilidad** | 15 | Z-score vs realized vol | Premia los movimientos anómalos |
| **Patrón** | 15 | Winrate histórico de setups similares | **Closed-loop learning** |
| **Timing** | 10 | Hora UTC + liquidez del activo | Maximiza fills |

**El desglose completo sólo lo ven los usuarios Premium** (free ve el total y un teaser). Esto convierte una métrica opaca en un **producto** que justifica la suscripción.

### 2) Tier-aware delivery (3 min head-start)

```
                  Free user              Premium user
                  ─────────              ────────────
Alert fired ──┐
              │
              ├──► onAlertCreated ──► immediate push
              │                       (premium users)
              │
              └──► pending_free_delivery ──► +3 min
                                          (delayed push)
```

- **Free**: alertas top-score (≥80) y breakouts → **bloqueadas** (no se envían, sólo aparecen en feed como preview borroso).
- **Premium**: todo, inmediato, con desglose.

El motor marca cada alerta con `min_tier: "free" | "premium"`. La Cloud Function `onAlertCreated` y `deliverDelayedFreeAlerts` (cron cada minuto) aplican el delay.

### 3) Conversion widget + outcome tracking

Tres palancas en el frontend para empujar al upgrade:

| Componente | Qué hace | Cuándo se muestra |
|---|---|---|
| `<ConversionWidget>` | "Te has perdido X alertas / +Y% winrate Premium" | Sólo a free, en dashboard |
| `<PaywallAlertCard>` | Card borroso con CTA de upgrade | Top scores (≥80) para free |
| `<ScoreTooltip>` | "¿Por qué este score?" → link a upgrade | Hover en cualquier score |
| `submitAlertFeedback` | 👍/👎/⚡/⚠ entrena el patrón histórico | En toda alerta |
| `getConversionStats` | Aggrega el missed value real | Alimenta el widget |

### 4) A/B testing integrado

- Cada usuario recibe `ab_variant: "A" | "B"` en `onAuthCreate` (hash determinístico por uid).
- `trackCtaEvent(type, source, metadata)` registra impressions/clicks/conversions por variant.
- En Firebase Console → `cta_events`: filtra por `metadata.ab_variant` para ver conversión.

### Schema nuevo (Firestore)

```jsonc
alerts/{id} = {
  // ...campos existentes...
  "min_tier": "free" | "premium",        // 👈 nuevo
  "premium_only_reason": "Top score",    // 👈 nuevo
  "score_breakdown": {                   // 👈 premium-only
    "total": 87,
    "confidence": 0.82,
    "factors": [
      { "key": "magnitude", "label": "Magnitud del movimiento", "points": 22, "max_points": 25, ... },
      ...
    ],
    "narrative": "Setup dominado por volumen y patrón histórico."
  },
  "outcome": {                           // 👈 rellenado por scoreOutcomeJob
    "checked_at": "...",
    "price_after_1h": 68100.5,
    "profitable_1h": true,
    "score_was_correct": true
  },
  "feedback": {                          // 👈 aggregados
    "total": 42, "useful": 30, "acted_on": 8, ...
  }
}
```

```jsonc
// Cloud Function: deliverDelayedFreeAlerts (cada minuto)
pending_free_delivery/{alertId}_{uid} = {
  "alert_id": "abc123",
  "user_id": "uid",
  "token": "fcm_token",
  "not_before": Timestamp,  // = now + 3min
  "created_at": Timestamp
}
```

### Cómo activar Premium (resumen)

1. Despliega las nuevas Cloud Functions (`onAlertCreated`, `deliverDelayedFreeAlerts`, `scoreOutcomeJob`, `getConversionStats`, `trackCtaEvent`, `submitAlertFeedback`).
2. Configura Stripe (ver sección "Stripe" abajo).
3. En `useAppStore` ya se aplica el tier desde `preferences.plan`.
4. El motor y el trigger de FCM consultan ese campo automáticamente.

### Métricas clave a monitorizar

```sql
-- (BigQuery export o Cloud Console)

-- Conversión por tier
SELECT plan, COUNT(DISTINCT user_id) FROM users GROUP BY plan

-- Win rate por tier (alimenta el widget)
SELECT
  a.min_tier,
  AVG(IF(a.outcome.profitable_1h, 1, 0)) as winrate,
  COUNT(*) as n
FROM alerts a
WHERE a.outcome.checked_at IS NOT NULL
GROUP BY a.min_tier

-- A/B test CTA performance
SELECT
  user_id,
  metadata.ab_variant,
  COUNTIF(type='impression') as impressions,
  COUNTIF(type='click') as clicks,
  COUNTIF(type='conversion') as conversions
FROM cta_events
WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY user_id, ab_variant
```

---

## Configuración FCM (web, Android, iOS)

### Web (PWA)
1. Firebase Console → **Project Settings → Cloud Messaging**.
2. Sección **Web Push certificates** → **Generate key pair**.
3. Copia la key a `frontend/.env.local`:
   ```
   VITE_FIREBASE_VAPID_KEY=BH7d...tu_key...
   ```
4. El service worker ya está configurado en `frontend/public/firebase-messaging-sw.js`.
5. El usuario activa las notificaciones desde el botón **"Activar notificaciones"** en el header del dashboard.

### Android
1. Firebase Console → **Project Settings → Your apps → Android**.
2. Descarga `google-services.json` y reemplaza `mobile/android/app/google-services.json`.
3. En `android/app/build.gradle.kts` o `build.gradle`:
   ```gradle
   apply plugin: "com.google.gms.google-services"
   dependencies {
     implementation platform("com.google.firebase:firebase-bom:33.1.0")
     implementation "com.google.firebase:firebase-messaging-ktx"
   }
   ```
4. En `AndroidManifest.xml`, dentro de `<application>`:
   ```xml
   <service
     android:name=".MyFirebaseMessagingService"
     android:exported="false">
     <intent-filter>
       <action android:name="com.google.firebase.MESSAGING_EVENT" />
     </intent-filter>
   </service>
   ```
5. La función `registerFcmToken` (callable) recibe el token automáticamente cuando se invoca desde el cliente nativo.

### iOS
1. Firebase Console → **Project Settings → Your apps → iOS**.
2. Descarga `GoogleService-Info.plist` y reemplaza `mobile/ios/Runner/GoogleService-Info.plist`.
3. Xcode → **Signing & Capabilities**:
   - Añade **Push Notifications**.
   - Añade **Background Modes** → marca **Remote notifications**.
4. Sube el APNs certificate a Firebase Console → **Project Settings → Cloud Messaging → Apple app configuration**.
5. `Podfile`:
   ```ruby
   pod 'Firebase/Messaging'
   ```

### Probando las push en local
1. Despliega todo a staging.
2. Activa las notificaciones desde el dashboard con tu cuenta.
3. Dispara el motor manualmente con `triggerAlerts` (ver arriba).
4. Revisa los logs:
   ```bash
   firebase functions:log --only onAlertCreated
   ```
5. Si el token falla, la Cloud Function lo marca como inválido y `cleanupJob` lo borra la próxima hora.

---

## Stripe (Premium) — opcional

1. Crea cuenta en [stripe.com](https://stripe.com) y obtén las API keys.
2. Crea un producto/subscription con el precio que quieras (9€/mes por defecto).
3. Configura los secrets:
   ```bash
   firebase functions:secrets:set STRIPE_SECRET
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```
4. En `functions/src/handlers/createCheckoutSession.ts` reemplaza:
   - `PREMIUM_PRICE_ID` por el `price_xxx` real.
   - `SUCCESS_URL` / `CANCEL_URL` por tu dominio.
5. En Stripe Dashboard → **Webhooks** → añade endpoint:
   `https://us-central1-<project>.cloudfunctions.net/stripeWebhook`
   Suscribe a: `checkout.session.completed`, `customer.subscription.deleted`.
6. Redeploy: `firebase deploy --only functions`.
7. En el frontend, llama al callable `createCheckoutSession` desde el botón "Mejorar a Premium":
   ```ts
   import { httpsCallable, getFunctions } from "firebase/functions";
   const fn = httpsCallable(getFunctions(), "createCheckoutSession");
   const { data } = await fn({});
   window.location.href = data.url;
   ```

---

## Despliegue paso a paso (producción)

### A. Backend (FastAPI)

Opciones recomendadas:

1. **Render / Railway / Fly.io** (más fácil):
   - Conecta el repo, build command: `pip install -r backend/requirements.txt`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Root directory: `backend`

2. **Cloud Run** (Google, ideal para integrar con Firebase):
   ```bash
   gcloud builds submit --config cloudbuild.yaml backend
   gcloud run deploy smart-alerts-engine \
     --image gcr.io/PROJECT/smart-alerts-engine \
     --region europe-west1 \
     --allow-unauthenticated \
     --set-env-vars="DATA_PROVIDER=coingecko,AI_PROVIDER=openai" \
     --set-secrets="OPENAI_API_KEY=openai-key:latest"
   ```

3. **VPS + Docker**: clona, `docker compose up -d --build`, pon Nginx delante con TLS.

### B. Firebase

```bash
# 1) Crear proyecto en https://console.firebase.google.com
firebase use --add

# 2) Habilitar Auth (Email + Google) en la consola
# 3) Habilitar Firestore (modo producción)
firebase deploy --only firestore:rules,firestore:indexes

# 4) Registrar Web App en la consola → copiar credenciales a .env.local

# 5) Obtener VAPID key: Project Settings → Cloud Messaging → Web Push certificates
#    → Generate key pair → pegar en VITE_FIREBASE_VAPID_KEY

# 6) Secrets para Functions
firebase functions:secrets:set ALERT_ENGINE_URL
firebase functions:secrets:set ALERT_ENGINE_API_KEY

# 7) Deploy
cd functions && npm install && cd ..
firebase deploy --only functions

# 8) Hosting (opcional)
cd frontend && npm run build && cd ..
firebase deploy --only hosting
```

### C. Verificación end-to-end

1. `curl https://TU-ENGINE/alerts/recent` → debe devolver JSON con alertas.
2. Entra a `https://TU-FRONTEND`, regístrate con email, ve al dashboard.
3. Activa notificaciones. Espera al siguiente ciclo del cron (5 min) o
   dispara manualmente desde la consola de Cloud Functions.
4. Verifica logs: `firebase functions:log --only generateAlertsCron`.

---

## Resumen de Cloud Functions

| Función | Cuándo corre | Qué hace |
|---|---|---|
| `onAuthCreate` | Al registrarse un usuario (Auth) | Crea `users/{uid}` con preferencias por defecto (server-side, no cliente) |
| `generateAlertsCron` | Cada 5 min | Llama al motor FastAPI, persiste alertas, registra `engine_runs/{id}` |
| `onAlertCreated` | Cada nueva alerta en Firestore | Encuentra usuarios que matchean, envía FCM push |
| `cleanupJob` | Cada 1 hora | Borra alertas expiradas y tokens FCM inválidos |
| `registerFcmToken` | Callable (cliente) | Guarda el token FCM del dispositivo del usuario |
| `updateUserPreferences` | Callable (cliente) | Actualiza sensibilidad, tipos, score mínimo, plan |
| `createCheckoutSession` | Callable (cliente) | Crea sesión de Stripe Checkout para Premium |
| `stripeWebhook` | Webhook (Stripe) | Activa/desactiva `plan: premium` |
| `triggerAlerts` | HTTPS (admin) | Dispara el motor on-demand (testing / backfill) |

### Tests

```bash
cd functions
npm install
npm test
```

### Local con emuladores

```bash
firebase emulators:start --only auth,functions,firestore
# Frontend: apuntar a emuladores (frontend/src/services/firebase.ts):
#   import { connectAuthEmulator, connectFirestoreEmulator } from "firebase/auth" / "firebase/firestore"
#   connectAuthEmulator(auth, "http://localhost:9099")
#   connectFirestoreEmulator(db, "localhost", 8080)
```

### Logs útiles

```bash
firebase functions:log --only generateAlertsCron
firebase functions:log --only onAlertCreated
firebase functions:log --only cleanupJob
```

---

## Esquema de Firestore### `users/{uid}`

```json
{
  "email": "user@example.com",
  "display_name": "Ada Lovelace",
  "photo_url": "https://...",
  "created_at": "Timestamp",
  "preferences": {
    "sensitivity": "medium",          // low | medium | high
    "enabled_types": ["price_surge", "price_dump", "volume_spike", "breakout"],
    "min_score": 0,                   // 0-100
    "muted_coins": [],                // coin_ids silenciados
    "plan": "free"                    // free | premium
  },
  "fcm_tokens": [
    {
      "token": "...",
      "platform": "web",
      "device_id": "...",
      "last_seen": "Timestamp"
    }
  ]
}
```

### `alerts/{alertId}`

```json
{
  "id": "a1b2c3d4e5...",
  "type": "price_surge",             // price_surge | price_dump | volume_spike | breakout
  "severity": "high",                 // low | medium | high
  "coin_id": "bitcoin",
  "symbol": "BTC",
  "name": "Bitcoin",
  "price_usd": 67890.12,
  "previous_price_usd": 65100.45,
  "change_pct": 4.28,
  "volume_24h_usd": 28456789012.5,
  "volume_ratio": 1.85,
  "score": 82,                        // 0-100
  "title": "🚀 BTC repunta 4.28%",
  "summary": "BTC sube un 4.28% en los últimos minutos, con volumen alto.",
  "explanation": "Movimiento alcista con confirmación de volumen...",
  "recommended_action": "Considera entry en retroceso...",
  "created_at": "Timestamp",
  "expires_at": "Timestamp | null",
  "delivered_count": 12
}
```

### `engine_runs/{runId}` (logs internos, solo admin)

```json
{
  "started_at": "Timestamp",
  "finished_at": "Timestamp",
  "alerts": 3,
  "persisted": 3,
  "provider": "coingecko",
  "ai_provider": "openai",
  "status": "ok" | "error",
  "error": "..." // solo si error
}
```

---

## Ejemplo real de alerta

Request:
```bash
curl -X POST http://localhost:8000/alerts/recent
```

Response (con `DATA_PROVIDER=mock`):
```json
{
  "generated_at": "2026-06-06T12:34:56.123Z",
  "count": 2,
  "alerts": [
    {
      "id": "f3a1b9c2d4e5...",
      "type": "price_surge",
      "severity": "high",
      "coin_id": "bitcoin",
      "symbol": "BTC",
      "name": "Bitcoin",
      "price_usd": 70015.0,
      "previous_price_usd": 67100.45,
      "change_pct": 4.34,
      "volume_24h_usd": 36200000000.0,
      "volume_ratio": 1.95,
      "score": 86,
      "title": "🚀 BTC repunta 4.34%",
      "summary": "BTC sube un 4.34% en los últimos minutos, con volumen alto.",
      "explanation": "Movimiento alcista con confirmación de volumen. Posible continuación si el precio mantiene el nivel actual. Alta calidad estadística: prioriza esta alerta.",
      "recommended_action": "Considera entry en retroceso hacia soporte cercano con stop ajustado.",
      "created_at": "2026-06-06T12:34:56Z",
      "expires_at": "2026-06-06T14:34:56Z"
    },
    {
      "id": "0a8b1c2d3e4f...",
      "type": "volume_spike",
      "severity": "medium",
      "coin_id": "solana",
      "symbol": "SOL",
      "name": "Solana",
      "price_usd": 168.2,
      "previous_price_usd": 165.1,
      "change_pct": 1.88,
      "volume_24h_usd": 7800000000.0,
      "volume_ratio": 2.6,
      "score": 64,
      "title": "📊 SOL registra pico de volumen",
      "summary": "Volumen 24h de SOL multiplicado por 2.60x respecto a la media.",
      "explanation": "Pico de actividad inusual. Frecuentemente precede a movimientos direccionales fuertes. Calidad moderada: monitoriza evolución.",
      "recommended_action": "Observa el precio en los próximos minutos para confirmar dirección.",
      "created_at": "2026-06-06T12:34:56Z",
      "expires_at": "2026-06-06T14:34:56Z"
    }
  ],
  "provider": "mock",
  "ai_provider": "mock"
}
```

> El frontend muestra estas alertas en **tiempo real** vía `onSnapshot`, calcula el score color (🟢 ≥75, 🟡 50-74, 🔴 <50) y permite filtrar por tipo y buscar por símbolo.

---

## Monetización (preparado desde el MVP)

| Plan | Alertas/mes | Latencia | Score IA | Activos | Precio |
|---|---|---|---|---|---|
| **Free** | 100 | ~5 min | Básico | Top 8 | 0€ |
| **Premium** | Ilimitadas | ~1 min | Avanzado (OpenAI) | Top 50 | 9€/mes |
| **Pro** | Ilimitadas | ~30 s | + Backtesting | Custom | 29€/mes |

La columna `plan` ya existe en `users/{uid}.preferences` y la Cloud Function `updateUserPreferences` permite cambiarla. La **Cloud Function de cron** puede leer `plan` y ajustar la frecuencia/ejecutar lógica premium.

**Ideas para activar cobro rápido**:
- Stripe Checkout → Cloud Function `stripeWebhook` actualiza `users/{uid}.preferences.plan`.
- Magic link de "Upgrade" en el dashboard.
- Paywall en el frontend (sólo plan Free ve top 8, Premium ve más).

---

## Roadmap MVP → Premium

### ✅ MVP (lo que ya está hecho en este repo)
- [x] Motor FastAPI con 4 reglas de detección
- [x] 2 proveedores de datos (CoinGecko, Binance) + Mock
- [x] IA con OpenAI + fallback Mock sin API key
- [x] Auth Firebase (email + Google)
- [x] Cloud Function cron + onAlertCreated
- [x] FCM web push (Chrome/Firefox/Edge)
- [x] Dashboard con score color, filtros, búsqueda
- [x] Settings (sensibilidad, tipos, score mínimo, plan)
- [x] PWA instalable
- [x] Docker + docker-compose

### 🔜 v0.2
- [ ] Más activos (config por usuario)
- [ ] Onboarding con selector de monedas
- [ ] Email digest diario
- [ ] Historial paginado + export CSV

### 🔮 v1.0 Premium
- [ ] Backtesting de estrategias
- [ ] Alertas de portfolio (no sólo precio)
- [ ] Integración con exchanges (Binance Spot Testnet)
- [ ] Multi-idioma (i18n)
- [ ] Stripe + portal de suscripción

---

## Tests / Calidad

```bash
# Backend
cd backend
pip install pytest httpx
pytest -q                              # añade tests/ cuando los necesites

# Frontend
cd frontend
npm run lint
npm run build
```

---

## Licencia

MIT — úsalo, fórkalo, véndelo. Build something cool.

---

**¿Listo?** Empieza por `cd backend && docker compose up`, luego `cd frontend && npm run dev`. En 5 minutos tienes alertas en pantalla. 🚀
