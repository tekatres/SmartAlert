#!/usr/bin/env node
// Seed Firestore with demo data from docs/firestore-seed.json
// Usage:
//   node scripts/seed-firestore.js
//
// Requires a service account key. Easiest path:
//   1. Firebase Console → Project Settings → Service Accounts
//   2. "Generate new private key" → save as scripts/service-account.json
//   3. export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/scripts/service-account.json"
//   4. node scripts/seed-firestore.js
// Or run from the Firebase Emulator with FIRESTORE_EMULATOR_HOST=localhost:8080
//   and GOOGLE_APPLICATION_CREDENTIALS pointing to a fake account (or no key at all).

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();

async function main() {
  const seedPath = path.resolve(__dirname, "..", "docs", "firestore-seed.json");
  const raw = fs.readFileSync(seedPath, "utf-8");
  const data = JSON.parse(raw);

  // Replace placeholder alert ids with real auto-ids, but keep a stable
  // copy in a `seed_example_*` collection for reference.
  let count = 0;
  for (const [docPath, docData] of Object.entries(data)) {
    const ref = db.doc(docPath);
    const cleaned = JSON.parse(JSON.stringify(docData));
    // Convert ISO strings to Firestore Timestamps
    if (cleaned.created_at) cleaned.created_at = admin.firestore.Timestamp.fromDate(new Date(cleaned.created_at));
    if (cleaned.expires_at) cleaned.expires_at = admin.firestore.Timestamp.fromDate(new Date(cleaned.expires_at));
    if (Array.isArray(cleaned.fcm_tokens)) {
      cleaned.fcm_tokens = cleaned.fcm_tokens.map((t) => ({
        ...t,
        created_at: t.created_at ? admin.firestore.Timestamp.fromDate(new Date(t.created_at)) : null,
        last_seen: t.last_seen ? admin.firestore.Timestamp.fromDate(new Date(t.last_seen)) : null,
      }));
    }
    await ref.set(cleaned, { merge: true });
    count++;
    console.log(`  ✓ ${docPath}`);
  }
  console.log(`\nSeeded ${count} documents into project ${admin.instanceId() || process.env.GCLOUD_PROJECT || "<emulator>"}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
