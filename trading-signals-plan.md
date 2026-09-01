# Plan: Sistema de Señales de Trading con Indicadores Técnicos Avanzados

## Visión General

Transformar SmartAlert en un **asesor autónomo de trading crypto con futuros** de uso personal que analiza múltiples indicadores técnicos de alta fiabilidad y decide cuándo entrar en LONG o SHORT, con qué apalancamiento, dónde colocar el stop-loss y el take-profit.

> **Uso personal**: No hay restricciones de tier para las señales. Todo es visible siempre. La lógica Premium de las alertas existentes no se toca.

### Regla de oro: Confluencia mínima 7/12

El motor solo emite señal cuando **al menos 7 de los 12 indicadores apuntan en la misma dirección**. Si la confluencia es menor → decisión `WAIT` → no se notifica ni se persiste. Calidad sobre cantidad: habrá días sin señales, y eso es correcto.

### Arquitectura del cambio

El sistema se construye sobre lo que ya existe siguiendo los patrones establecidos:

1. **Backend FastAPI** — motor de indicadores técnicos (klines Binance Futures) + nueva capa de decisión inteligente
2. **Cloud Functions** — persiste y entrega las nuevas señales igual que las alertas actuales
3. **Frontend React** — nueva tarjeta de señal de trading con toda la información operativa

### Indicadores seleccionados (alta fiabilidad en crypto futures)

| Indicador | Por qué no falla | Fuente de datos |
|---|---|---|
| **RSI 14** (multi-timeframe: 15m + 1h + 4h) | Identifica sobrecompra/sobreventa con confirmación de 3 marcos temporales | Binance klines |
| **MACD 12/26/9** | Cruce de señal + divergencia = momentum confirmado | Binance klines |
| **EMA 9/21/50/200** | Golden/Death cross son los setups más confiables del mercado | Binance klines |
| **Bollinger Bands 20,2** | Squeezes y breakouts de banda = volatilidad comprimida + explosión | Binance klines |
| **ATR 14** | Base para calcular TP/SL dinámicos según volatilidad real del activo | Binance klines |
| **Stochastic RSI** | Filtra señales falsas del RSI en tendencias fuertes | Binance klines |
| **ADX 14** | Confirma que hay tendencia real antes de entrar (evita laterales) | Binance klines |
| **OBV** (On-Balance Volume) | Dinero inteligente: el volumen precede al precio | Binance klines |
| **VWAP** | Precio justo del día — entrar por debajo para LONG, encima para SHORT | Binance klines |
| **Funding Rate** | En futuros: funding rate negativo = shorts atrapados = LONG setup | Binance Futures API |
| **Open Interest** | Crecimiento de OI + precio = tendencia real, no trampa | Binance Futures API |
| **CVD** (Cumulative Volume Delta) | Presión compradora vs vendedora en tiempo real | Binance klines |

### Lógica de decisión: Motor de Confluencia

Para emitir señal **LONG** necesita confluencia de al menos 7/12 indicadores:
- RSI < 35 en 2+ timeframes
- MACD cruce alcista (o histograma en positivo)
- Precio cerca de EMA 50/200 (soporte dinámico)
- Bollinger Band toca/penetra banda inferior
- ADX > 20 (hay tendencia)
- OBV divergencia alcista
- Funding rate ≤ -0.01%

Mismo principio invertido para **SHORT**.

Si confluencia < 7 → señal **WAIT** (no entrar).

### Cálculo de apalancamiento

```
apalancamiento = min(20, max(1, floor(10 / ATR_pct_14)))
```
A mayor volatilidad (ATR alto) → menor apalancamiento. A menor volatilidad → mayor apalancamiento. Rango: 1x-20x.

### Cálculo de TP/SL

```
SL = precio_entrada ± (ATR * 1.5)
TP1 = precio_entrada ± (ATR * 2.0)  [take profit parcial 50%]
TP2 = precio_entrada ± (ATR * 3.5)  [take profit total]
RR = (TP1 - entrada) / (entrada - SL)  → debe ser ≥ 1.5 para emitir señal
```

---

## Sub-Tareas

---

### Sub-Tarea 1 — Servicio de klines y datos de futuros de Binance

**Status:** [ ] pending

**Intent**
Crear un nuevo módulo Python que obtiene velas históricas (klines) en múltiples timeframes (15m, 1h, 4h) y datos exclusivos de futuros (funding rate, open interest) desde la API pública de Binance Futures. Es la base de datos sobre la que se calculan todos los indicadores.

**Expected Outcomes**
- Nuevo archivo `backend/app/services/binance_futures.py`
- Función `fetch_klines(symbol, interval, limit)` → lista de OHLCV
- Función `fetch_funding_rate(symbol)` → tasa actual
- Función `fetch_open_interest(symbol)` → OI actual y cambio
- Función `fetch_multi_timeframe_klines(symbol)` → dict con 15m/1h/4h simultáneo (asyncio.gather)

**Todo List**
1. Crear `backend/app/services/binance_futures.py`
2. Añadir endpoint base `BINANCE_FUTURES_BASE = "https://fapi.binance.com"` (Binance USD-M Futures)
3. Implementar `fetch_klines(client, symbol, interval, limit=200)` — devuelve lista de dicts `{open, high, low, close, volume, timestamp}`
4. Implementar `fetch_funding_rate(client, symbol)` — endpoint `/fapi/v1/fundingRate`
5. Implementar `fetch_open_interest(client, symbol)` — endpoint `/fapi/v1/openInterest` + `/fapi/v1/openInterestHist`
6. Implementar `fetch_multi_timeframe_klines(symbols)` con `asyncio.gather` para todos los timeframes en paralelo
7. Añadir manejo de errores (timeout, rate limit) con logging

**Relevant Context**
- Patrón existente: [`BinanceProvider`](backend/app/services/binance.py:50) — copiar estructura de `httpx.AsyncClient`
- Los endpoints de futuros usan `fapi.binance.com` (no `api.binance.com`)
- No requiere API key para datos públicos
- Pairs de futuros: BTCUSDT, ETHUSDT, SOLUSDT, etc. (mismos que en [`ID_TO_BINANCE`](backend/app/services/binance.py:19))

---

### Sub-Tarea 2 — Librería de indicadores técnicos (cálculo puro)

**Status:** [ ] pending

**Intent**
Implementar todas las funciones de cálculo de indicadores técnicos en Python puro (sin dependencias externas como `ta-lib`). Cada función recibe una lista de valores OHLCV y devuelve el/los valores calculados. Esto garantiza que el backend no necesite instalar librerías C nativas.

**Expected Outcomes**
- Nuevo archivo `backend/app/alert_engine/indicators.py`
- Funciones para: RSI, MACD, EMA, Bollinger Bands, ATR, Stochastic RSI, ADX, OBV, VWAP, CVD
- Cada función devuelve el valor más reciente (escalar) y opcionalmente los últimos N valores (para detectar cruces)
- 100% en Python, sin dependencias adicionales en `requirements.txt`

**Todo List**
1. Crear `backend/app/alert_engine/indicators.py`
2. Implementar `ema(values, period)` — media exponencial ponderada
3. Implementar `rsi(closes, period=14)` — usando EMA de gains/losses de Wilder
4. Implementar `macd(closes, fast=12, slow=26, signal=9)` → `(macd_line, signal_line, histogram)`
5. Implementar `bollinger_bands(closes, period=20, std_dev=2)` → `(upper, middle, lower, bandwidth)`
6. Implementar `atr(highs, lows, closes, period=14)` → valor ATR actual
7. Implementar `stochastic_rsi(closes, rsi_period=14, stoch_period=14, k=3, d=3)` → `(k, d)`
8. Implementar `adx(highs, lows, closes, period=14)` → valor ADX actual
9. Implementar `obv(closes, volumes)` → lista OBV, pendiente reciente
10. Implementar `vwap(highs, lows, closes, volumes)` → VWAP del día
11. Implementar `cvd(closes, volumes)` → CVD acumulado y tendencia reciente
12. Cada función debe aceptar `List[float]` y ser determinista y eficiente (O(n))

**Relevant Context**
- No añadir dependencias en [`backend/requirements.txt`](backend/requirements.txt) — Python puro
- Referencia de fórmulas: las fórmulas son estándar de análisis técnico (no inventadas)
- Los klines de Binance dan OHLCV en arrays — las funciones deben operar sobre esos arrays

---

### Sub-Tarea 3 — Motor de decisión: TradingSignalEngine

**Status:** [ ] pending

**Intent**
Crear el cerebro del sistema: un motor que toma los klines multi-timeframe, calcula todos los indicadores, aplica el sistema de confluencia de 7/12 señales y emite una decisión estructurada `LONG / SHORT / WAIT` con apalancamiento, TP, SL y puntuación de confianza.

**Expected Outcomes**
- Nuevo archivo `backend/app/alert_engine/signal_engine.py`
- Nuevo tipo de dato `TradingSignal` con todos los campos de la señal
- Función principal `analyze(symbol, klines_15m, klines_1h, klines_4h, funding_rate, open_interest)` → `TradingSignal | None`
- Solo emite señal si la confianza es suficientemente alta (confluencia ≥ 7 de 12)
- El apalancamiento y TP/SL se calculan automáticamente según ATR

**Todo List**
1. Crear `backend/app/alert_engine/signal_engine.py`
2. Definir dataclass `SignalIndicator(name, signal, weight, explanation)` para cada indicador votante
3. Definir dataclass/Pydantic `TradingSignal`:
   - `direction: Literal["LONG", "SHORT", "WAIT"]`
   - `confidence: float` (0-1, ratio de confluencia)
   - `confluence_score: int` (X de 12 indicadores alineados)
   - `entry_price: float`
   - `leverage: int` (1-20)
   - `stop_loss: float`
   - `take_profit_1: float` (50% del tamaño)
   - `take_profit_2: float` (100% del tamaño)
   - `risk_reward: float`
   - `atr: float`
   - `indicators: List[SignalIndicator]` (desglose de cada indicador)
   - `timeframe_bias: dict` (15m/1h/4h → "LONG"/"SHORT"/"NEUTRAL")
   - `funding_rate: float`
   - `open_interest_change_pct: float`
   - `signal_type: str` — etiqueta del setup (ej. "RSI_OVERSOLD_MACD_CROSS")
4. Implementar `_vote_rsi(rsi_15m, rsi_1h, rsi_4h)` → `SignalIndicator`
5. Implementar `_vote_macd(macd_1h)` → `SignalIndicator`
6. Implementar `_vote_ema_cross(emas_1h)` → `SignalIndicator` (golden/death cross)
7. Implementar `_vote_bollinger(bb_1h, current_price)` → `SignalIndicator`
8. Implementar `_vote_adx(adx_1h)` → `SignalIndicator` (solo vota si ADX > 20)
9. Implementar `_vote_stoch_rsi(stoch_rsi_15m)` → `SignalIndicator`
10. Implementar `_vote_obv(obv_trend)` → `SignalIndicator`
11. Implementar `_vote_vwap(current_price, vwap)` → `SignalIndicator`
12. Implementar `_vote_funding_rate(funding_rate)` → `SignalIndicator`
13. Implementar `_vote_open_interest(oi_change)` → `SignalIndicator`
14. Implementar `_vote_cvd(cvd_trend)` → `SignalIndicator`
15. Implementar `_calculate_leverage(atr_pct)` → int (fórmula: `min(20, max(1, floor(10/atr_pct)))`)
16. Implementar `_calculate_tp_sl(entry, atr, direction)` → `(sl, tp1, tp2, rr)`
17. Implementar `analyze(...)` — agrega todos los votos, computa RR, devuelve `TradingSignal` o `None` si RR < 1.5 o confluencia < 7

**Relevant Context**
- Patrón de reglas existente: [`Rule` ABC](backend/app/alert_engine/rules.py:28) — seguir el mismo patrón con clases de votación
- El scoring engine actual: [`compute_score`](backend/app/alert_engine/scoring.py:66) — el nuevo motor es paralelo a este, no lo reemplaza
- El ATR debe calcularse sobre klines de 1h para que los niveles TP/SL sean razonables

---

### Sub-Tarea 4 — Ampliar schemas y tipos: `TradingSignalAlert`

**Status:** [ ] pending

**Intent**
Extender los modelos Pydantic del backend y los tipos TypeScript del frontend/functions para incluir la nueva entidad `TradingSignalAlert` que convive con el `Alert` existente. Es un tipo nuevo en Firestore (`trading_signals/{id}`), no modifica los documentos `alerts/{id}`.

**Expected Outcomes**
- [`backend/app/models/schemas.py`](backend/app/models/schemas.py) — nuevos modelos `TradingSignalAlert`, `SignalIndicatorSchema`
- [`functions/src/types.ts`](functions/src/types.ts) — nuevo tipo `TradingSignalAlert`
- [`frontend/src/types/index.ts`](frontend/src/types/index.ts) — mismo tipo `TradingSignalDoc`
- Nueva colección Firestore: `trading_signals/{id}` (no cambia `alerts/{id}`)

**Todo List**
1. En `backend/app/models/schemas.py` añadir:
   - Enum `SignalDirection` con valores `LONG`, `SHORT`, `WAIT`
   - `SignalIndicatorSchema(name, signal, weight, value, explanation)`
   - `TradingSignalAlert` (todos los campos de `TradingSignal` del motor + campos de alert: `id, coin_id, symbol, name, created_at, expires_at, min_tier`)
2. En `functions/src/types.ts` añadir interface `TradingSignalPayload` (mirror del modelo Python)
3. En `frontend/src/types/index.ts` añadir interface `TradingSignalDoc` con todos los campos
4. Actualizar `firestore.indexes.json` con índice compuesto `trading_signals` por `coin_id + created_at`
5. Actualizar `firestore.rules` para proteger la colección `trading_signals` (lectura autenticada, escritura solo servidor)

**Relevant Context**
- [`AlertDoc`](frontend/src/types/index.ts:36) — modelo a seguir para `TradingSignalDoc`
- [`AlertPayload`](functions/src/types.ts:11) — modelo a seguir para `TradingSignalPayload`
- Las señales `WAIT` NO se persisten — solo `LONG` y `SHORT` llegan a Firestore

---

### Sub-Tarea 5 — Integrar el motor en el ciclo de generación (backend)

**Status:** [ ] pending

**Intent**
Conectar el nuevo `TradingSignalEngine` al ciclo de ejecución del backend. En cada run del cron (cada 5 minutos), además de generar alertas normales, se ejecuta el análisis técnico para cada coin y se incluyen las señales de trading en la respuesta del endpoint.

**Expected Outcomes**
- El endpoint `/alerts/generate` devuelve tanto alertas clásicas como `trading_signals` en el mismo response
- `TradingSignalEngine` se instancia una vez y se reutiliza entre runs
- Las señales `WAIT` se filtran antes de devolver la respuesta
- Se añade enriquecimiento AI (OpenAI) para las señales: el prompt incluye todos los indicadores y la IA genera `title`, `summary`, `explanation`, `recommended_action` adaptados al contexto LONG/SHORT/apalancamiento

**Todo List**
1. Crear `backend/app/alert_engine/signal_orchestrator.py` — orquesta: fetch klines → calcular indicadores → votar → generar señal
2. En [`backend/app/routers/alerts.py`](backend/app/routers/alerts.py) ampliar `AlertGenerationResponse` para incluir campo `trading_signals: List[TradingSignalAlert]`
3. En el router `POST /alerts/generate`, llamar al orchestrator y adjuntar señales al response
4. Añadir enriquecimiento AI al prompt de OpenAI — extender [`_build_prompt`](backend/app/ai/openai_provider.py:108) para incluir datos de señal cuando aplique
5. Añadir campo `trading_signals` en `AlertGenerationResponse` del schema
6. Añadir endpoint `GET /signals/recent` para consultar señales recientes (últimas 24h) por símbolo

**Relevant Context**
- Router actual: `backend/app/routers/alerts.py` — añadir `trading_signals` al response body
- `AlertGenerationResponse` en [`schemas.py`](backend/app/models/schemas.py:123)
- Seguir el mismo patrón que el `alert_engine` — la señal es adicional, no reemplaza nada

---

### Sub-Tarea 6 — Cloud Function: persistir señales y enviar push notifications

**Status:** [ ] pending

**Intent**
Ampliar la Cloud Function `generateAlertsCron` para que también persista las `TradingSignalAlert` en la colección `trading_signals/{id}` de Firestore y dispare notificaciones push con el mensaje operativo completo (LONG/SHORT, apalancamiento, TP, SL).

**Expected Outcomes**
- `functions/src/handlers/generateAlertsCron.ts` actualizado para leer y persistir `trading_signals`
- Nueva función trigger `onTradingSignalCreated` que envía FCM con el payload completo de la señal
- Mensaje de push diferenciado: 🟢 LONG o 🔴 SHORT con apalancamiento y niveles
- Solo usuarios Premium reciben señales de trading inmediatamente (Free: delay de 5 min)

**Todo List**
1. En `functions/src/handlers/generateAlertsCron.ts`, extraer `trading_signals` del response del engine y llamar a `persistTradingSignals(db, signals)`
2. En `functions/src/repositories.ts` añadir `persistTradingSignals` y `userMatchesTradingSignal`
3. Crear `functions/src/handlers/onTradingSignalCreated.ts` — trigger `onDocumentCreated("trading_signals/{id}")`, envía FCM con payload estructurado
4. El cuerpo de la notificación push debe incluir: dirección, apalancamiento, símbolo, precio de entrada
5. Exportar el nuevo handler en `functions/src/index.ts`
6. Las señales de trading son **siempre Premium** (min_tier = "premium") — free solo ve que existe pero no el detalle

**Relevant Context**
- Seguir exactamente el patrón de [`onAlertCreated.ts`](functions/src/handlers/) para el nuevo trigger
- `persistAlerts` en [`repositories.ts`](functions/src/repositories.ts) — copiar patrón para `persistTradingSignals`
- La colección es `trading_signals` (no `alerts`) — no colisiona

---

### Sub-Tarea 7 — Frontend: TradingSignalCard y página de detalle

**Status:** [ ] pending

**Intent**
Crear los componentes visuales que muestran las señales de trading en el dashboard: una tarjeta compacta `TradingSignalCard` para el feed principal y una sección expandida en `AlertDetailPage` (o nueva ruta `/signals/:id`) con todos los indicadores, gráfico de entrada, y el panel operativo completo.

**Expected Outcomes**
- Nuevo componente `frontend/src/components/TradingSignalCard.tsx`
- Nueva ruta `/signals/:id` con `SignalDetailPage`
- `TradingSignalCard` integrada en el Dashboard junto a las alertas normales
- Filtro de tipo añadido: "Señales de Entrada" como opción adicional en `Filters.tsx`
- Los niveles de TP/SL se muestran visualmente en un mini gráfico horizontal de precio
- Panel de indicadores: tabla con los 12 indicadores, su voto (🟢/🔴/⚪) y explicación
- Apalancamiento recomendado destacado con badge

**Todo List**
1. Crear `frontend/src/components/TradingSignalCard.tsx` — muestra: dirección (LONG/SHORT badge), coin, apalancamiento, TP/SL compacto, score de confluencia
2. Crear `frontend/src/pages/SignalDetailPage.tsx` — vista completa con todos los indicadores y panel operativo
3. En `SignalDetailPage`, implementar `LevelChart` (componente SVG inline) que dibuja entrada, TP1, TP2 y SL en escala de precio
4. Panel de indicadores: tabla con columnas Indicador / Señal / Explicación para los 12 votantes
5. Sección de gestión de riesgo: apalancamiento, SL en porcentaje, TP1 y TP2 en porcentaje
6. Añadir hook `useSignals(pageSize)` en `frontend/src/hooks/` — suscripción real-time a `trading_signals` (Firestore `onSnapshot`)
7. Integrar `TradingSignalCard` en `frontend/src/pages/DashboardPage.tsx` — sección separada "🎯 Señales de Entrada" encima del feed de alertas
8. Añadir ruta `/signals/:id` en `frontend/src/App.tsx`
9. Añadir "Señales" al `BottomNav.tsx` con icono 🎯
10. Gate premium: si `min_tier === "premium"` y el usuario es free, mostrar tarjeta bloqueada con CTA

**Relevant Context**
- Patrón de componente: [`AlertCard.tsx`](frontend/src/components/AlertCard.tsx) — seguir estructura y estilos
- Patrón de página: [`AlertDetailPage.tsx`](frontend/src/pages/AlertDetailPage.tsx) — seguir estructura de secciones
- Patrón de hook: [`useAlerts`](frontend/src/hooks/) — copiar para `useSignals`
- Patrón de paywall: [`PaywallAlertCard.tsx`](frontend/src/components/PaywallAlertCard.tsx)
- Usar las variables CSS y clases Tailwind existentes (dark mode ya funciona)

---

## Orden de implementación

```
Sub-Tarea 1 → Sub-Tarea 2 → Sub-Tarea 3 → Sub-Tarea 4
                                                 ↓
                                    Sub-Tarea 5 → Sub-Tarea 6 → Sub-Tarea 7
```

Sub-Tareas 1, 2 y 3 son puramente backend y pueden desarrollarse secuencialmente.
Sub-Tarea 4 (tipos) desbloquea la Sub-Tarea 5 y 6 (integración).
Sub-Tarea 7 (frontend) puede empezar en paralelo con Sub-Tarea 6 una vez Sub-Tarea 4 esté hecha.

---

## Consideraciones técnicas importantes

### Sin dependencias adicionales
Todos los indicadores se implementan en Python puro. No se añade `ta-lib`, `pandas`, ni `numpy` para mantener el Dockerfile simple. Los algoritmos de RSI, MACD, etc. son fórmulas cerradas de O(n) iteraciones.

### Colección separada en Firestore
Las señales van a `trading_signals/{id}`, no mezcla con `alerts/{id}`. Esto garantiza que:
- Las reglas de negocio de alertas no cambian
- Los índices son independientes
- La UI puede suscribirse a ambas colecciones por separado

### Calidad de señal sobre cantidad
El motor NO emite señal si:
- Confluencia < 7 de 12 indicadores
- Risk/Reward < 1.5
- ADX < 20 (mercado sin tendencia — el mayor asesino de cuentas)

Esto significa que habrá días sin señales. Eso es correcto: es mejor no operar que operar en malas condiciones.

### Sin restricciones de tier para señales
La app es de uso personal. Las señales de trading son siempre completamente visibles: dirección, apalancamiento, TP, SL, desglose de indicadores. No se aplica ningún gate de Premium a la colección `trading_signals`.
