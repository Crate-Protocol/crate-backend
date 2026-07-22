import { pool } from "./client.js";
import { incrementSales } from "./sampleRepository.js";
import type { DecodedEvent } from "../indexer/types.js";
import type { Pool } from "pg";

// Every function here defaults to the shared pool but accepts an injectable
// Pool — lets tests run this exact code against a pg-mem instance instead of
// a hand-reimplemented approximation of its SQL.

export async function getCursor(contractId: string, db: Pool = pool): Promise<number | null> {
  const result = await db.query<{ last_ledger: number }>(
    "SELECT last_ledger FROM indexer_cursor WHERE contract_id = $1",
    [contractId],
  );
  return result.rows[0]?.last_ledger ?? null;
}

/**
 * Sets the cursor only if one doesn't already exist — used once, to seed the
 * backfill start point on first run. Safe to call more than once (e.g. two
 * worker instances racing on startup): whichever insert wins is authoritative,
 * the other is a no-op, and the caller should re-read via getCursor after.
 */
export async function initCursor(contractId: string, lastLedger: number, db: Pool = pool): Promise<void> {
  await db.query(
    `INSERT INTO indexer_cursor (contract_id, last_ledger)
     VALUES ($1, $2)
     ON CONFLICT (contract_id) DO NOTHING`,
    [contractId, lastLedger],
  );
}

export interface ApplyResult {
  applied: number;
  skipped: number;
}

/**
 * Applies a batch of already-decoded events and advances the cursor to
 * newLastLedger, all in one transaction. Each event insert is
 * ON CONFLICT (ledger, tx_hash, event_index) DO NOTHING, so replaying a
 * range that was already (fully or partially) applied — from a restart, or
 * a retried poll after a mid-batch crash — only applies the side effects
 * (samples.total_sales, platform_stats) for events that weren't already
 * recorded. The cursor only advances if the whole batch commits, so a crash
 * partway through never leaves the cursor ahead of what's actually applied.
 */
export async function applyEventBatchAndAdvanceCursor(
  contractId: string,
  events: DecodedEvent[],
  newLastLedger: number,
  db: Pool = pool,
): Promise<ApplyResult> {
  const client = await db.connect();
  let applied = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");

    for (const event of events) {
      // Checked with a plain SELECT rather than leaning on INSERT ...
      // ON CONFLICT DO NOTHING's own row count: within a single worker's
      // sequential restart-replay (this function's actual concurrency
      // model — see the note on ensureCursor in worker.ts) there's no
      // concurrent writer to race against, so a pre-check inside this same
      // transaction is exact. The INSERT below still carries ON CONFLICT DO
      // NOTHING regardless, so the row itself can never actually be
      // duplicated even if that assumption is ever violated.
      const existing = await client.query(
        "SELECT 1 FROM contract_events WHERE ledger = $1 AND tx_hash = $2 AND event_index = $3",
        [event.ledger, event.txHash, event.eventIndex],
      );

      if ((existing.rowCount ?? 0) > 0) {
        // Already applied in a previous run — must not re-apply side effects.
        skipped++;
        continue;
      }
      applied++;

      const payload =
        event.eventType === "uploaded"
          ? { uploader: event.uploader }
          : { buyer: event.buyer, price: event.price.toString() };

      await client.query(
        `INSERT INTO contract_events
           (contract_id, ledger, tx_hash, event_index, event_type, sample_id, payload, ledger_closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ledger, tx_hash, event_index) DO NOTHING`,
        [
          event.contractId,
          event.ledger,
          event.txHash,
          event.eventIndex,
          event.eventType,
          event.sampleId,
          JSON.stringify(payload),
          event.ledgerClosedAt,
        ],
      );

      if (event.eventType === "licensed") {
        await incrementSales(event.sampleId, client);
        await client.query(
          `INSERT INTO platform_stats (contract_id, total_volume)
           VALUES ($1, $2)
           ON CONFLICT (contract_id) DO UPDATE SET
             total_volume = platform_stats.total_volume + EXCLUDED.total_volume,
             updated_at = NOW()`,
          [contractId, event.price],
        );
      } else {
        // Mirrors the contract's own Producer(Address) flag: only count a
        // producer toward total_producers the first time we see them upload.
        const existingProducer = await client.query(
          "SELECT 1 FROM known_producers WHERE address = $1",
          [event.uploader],
        );
        const isNewProducer = (existingProducer.rowCount ?? 0) === 0;

        if (isNewProducer) {
          await client.query(
            "INSERT INTO known_producers (address) VALUES ($1) ON CONFLICT DO NOTHING",
            [event.uploader],
          );
        }

        await client.query(
          `INSERT INTO platform_stats (contract_id, total_samples, total_producers)
           VALUES ($1, 1, $2)
           ON CONFLICT (contract_id) DO UPDATE SET
             total_samples = platform_stats.total_samples + 1,
             total_producers = platform_stats.total_producers + EXCLUDED.total_producers,
             updated_at = NOW()`,
          [contractId, isNewProducer ? 1 : 0],
        );
      }
    }

    await client.query(
      `INSERT INTO indexer_cursor (contract_id, last_ledger)
       VALUES ($1, $2)
       ON CONFLICT (contract_id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = NOW()`,
      [contractId, newLastLedger],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { applied, skipped };
}

export interface PlatformStats {
  totalSamples: number;
  totalVolume: bigint;
  totalProducers: number;
}

export async function getPlatformStats(contractId: string, db: Pool = pool): Promise<PlatformStats> {
  const result = await db.query<{
    total_samples: number;
    total_volume: bigint;
    total_producers: number;
  }>(
    "SELECT total_samples, total_volume, total_producers FROM platform_stats WHERE contract_id = $1",
    [contractId],
  );

  const row = result.rows[0];
  if (!row) {
    return { totalSamples: 0, totalVolume: 0n, totalProducers: 0 };
  }
  return {
    totalSamples: row.total_samples,
    totalVolume: row.total_volume,
    totalProducers: row.total_producers,
  };
}
