/**
 * seed-alerts.mjs
 *
 * Calls the local FastAPI backend and writes the resulting alerts + signals
 * directly into Firestore using the Firebase REST API authenticated with the
 * token stored by the Firebase CLI (no service-account JSON required).
 *
 * Usage (from repo root):
 *   node functions/seed-alerts.mjs
 *
 * Requirements:
 *   - Backend running on http://localhost:8000
 *   - Already logged in via `firebase login`
 */

import { createRequire } from "module";
import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";

const require = createRequire(import.meta.url);

const PROJECT_ID = "smartalerts-ae4ec";
const ENGINE_URL = "http://localhost:8000";
const ENGINE_API_KEY = "change-me-super-secret";

// ---------------------------------------------------------------------------
// 1. Load access token from firebase-tools config (~/.config/configstore)
// ---------------------------------------------------------------------------
const cfgPath = join(homedir(), ".config", "configstore", "firebase-tools.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const tokens = cfg?.tokens;

if (!tokens?.access_token) {
  console.error("✗ No Firebase access token found. Run `firebase login` first.");
  process.exit(1);
}

const expiresAt = new Date(tokens.expires_at);
if (expiresAt <= new Date()) {
  console.error("✗ Firebase access token has expired. Run `firebase login --reauth`.");
  process.exit(1);
}

const access_token = tokens.access_token;
console.log("✓ Access token loaded from Firebase CLI (expires", expiresAt.toLocaleTimeString(), ")");

// ---------------------------------------------------------------------------
// 3. Call the backend engine
// ---------------------------------------------------------------------------
console.log("→ Calling engine at", ENGINE_URL + "/alerts/generate …");
const engineRes = await fetch(ENGINE_URL + "/alerts/generate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": ENGINE_API_KEY,
  },
  body: JSON.stringify({ sensitivity: "medium", use_ai: true }),
});

if (!engineRes.ok) {
  const text = await engineRes.text();
  console.error("✗ Engine error", engineRes.status, text);
  process.exit(1);
}

const data = await engineRes.json();
console.log(
  `✓ Engine returned ${data.count} alerts, ${(data.trading_signals ?? []).length} signals`
);

// ---------------------------------------------------------------------------
// 4. Write to Firestore via REST
// ---------------------------------------------------------------------------
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "created_at" || k === "expires_at") {
      fields[k] = v ? { timestampValue: new Date(v).toISOString() } : { nullValue: null };
    } else {
      fields[k] = toFirestoreValue(v);
    }
  }
  return { fields };
}

async function upsertDoc(collection, docId, obj) {
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;
  const doc = toFirestoreDoc(obj);
  const res = await fetch(url + "?currentDocument.exists=false", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(doc),
  });
  if (!res.ok && res.status !== 409) {
    // 409 = already exists, use PATCH to update
    const patchRes = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(doc),
    });
    if (!patchRes.ok) {
      const t = await patchRes.text();
      console.warn(`  PATCH ${collection}/${docId} failed: ${patchRes.status} ${t.slice(0, 200)}`);
    }
  }
}

// Persist alerts
let alertCount = 0;
for (const alert of data.alerts) {
  await upsertDoc("alerts", alert.id, { ...alert, delivered_to: [] });
  alertCount++;
}
console.log(`✓ Persisted ${alertCount} alerts`);

// Persist signals
let signalCount = 0;
for (const signal of data.trading_signals ?? []) {
  await upsertDoc("trading_signals", signal.id, signal);
  signalCount++;
}
console.log(`✓ Persisted ${signalCount} signals`);

console.log("\n✓ Done — refresh the dashboard to see the data.");
process.exit(0);
