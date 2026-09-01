/**
 * seed-watch.mjs
 *
 * Runs seed-alerts.mjs once immediately, then every INTERVAL_MIN minutes.
 * Keeps the Firestore `alerts` collection fresh while developing locally
 * without needing Cloud Functions deployed.
 *
 * Usage:
 *   node scripts/seed-watch.mjs          # every 5 min (default)
 *   node scripts/seed-watch.mjs 2        # every 2 min
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT = join(__dirname, "..", "functions", "seed-alerts.mjs");
const INTERVAL_MIN = Number(process.argv[2]) || 5;
const INTERVAL_MS = INTERVAL_MIN * 60 * 1000;

function runSeed() {
  const now = new Date().toLocaleTimeString();
  console.log(`\n[${now}] Running seed…`);
  const child = spawn("node", [SEED_SCRIPT], { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code !== 0) console.warn(`  seed exited with code ${code}`);
  });
}

runSeed(); // run immediately on start
console.log(`\n⏱  Refrescando cada ${INTERVAL_MIN} min (Ctrl+C para parar)\n`);
setInterval(runSeed, INTERVAL_MS);
