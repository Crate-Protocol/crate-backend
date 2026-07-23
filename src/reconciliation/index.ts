import "dotenv/config";
import { pool } from "../db/client.js";
import { loadReconciliationConfigFromEnv, runReconciliationForever } from "./worker.js";

// Standalone process — deliberately not wired into src/index.ts, same
// reasoning as src/indexer/index.ts: this polls the database on its own
// cycle and shouldn't share fate with the API process. Also deliberately
// separate from the indexer process itself, despite both being pollers —
// the indexer talks to Soroban RPC and only ever writes contract_events,
// this only ever reads contract_events and writes payouts. Different
// failure domains: an RPC outage stalls the indexer, not this; a
// reconciliation bug (see reconcileOnce's per-event try/catch) can't stall
// event ingestion. Run with `npm run dev:reconciliation` (dev) or
// `node dist/reconciliation/index.js` (prod, after `npm run build`).

const config = loadReconciliationConfigFromEnv();
const controller = new AbortController();

console.log("[reconciliation] starting");

runReconciliationForever(config, controller.signal)
  .catch((err) => {
    console.error("[reconciliation] fatal error", err);
    process.exitCode = 1;
  })
  .finally(() => {
    pool.end().catch(() => {});
  });

function shutdown(signal: string) {
  console.log(`[reconciliation] ${signal} received, finishing the current pass then exiting...`);
  controller.abort();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
