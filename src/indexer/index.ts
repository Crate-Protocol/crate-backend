import "dotenv/config";
import { pool } from "../db/client.js";
import { loadConfigFromEnv, runForever } from "./worker.js";

// Standalone process — deliberately not wired into src/index.ts. Polling a
// blockchain and holding open a long DB transaction per batch is a different
// operational shape than an HTTP request handler: it needs its own restart
// policy, and a slow or wedged indexer cycle must never be able to block
// (or share fate with) the API process. Run with `npm run indexer` (dev) or
// `node dist/indexer/index.js` (prod, after `npm run build`).

const config = loadConfigFromEnv();
const controller = new AbortController();

console.log(`[indexer] starting for contract ${config.contractId}`);

runForever(config, controller.signal)
  .catch((err) => {
    console.error("[indexer] fatal error", err);
    process.exitCode = 1;
  })
  .finally(() => {
    pool.end().catch(() => {});
  });

function shutdown(signal: string) {
  console.log(`[indexer] ${signal} received, finishing the current cycle then exiting...`);
  controller.abort();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
