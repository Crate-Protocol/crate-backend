import { pool } from "../db/client.js";
import { findUnreconciledLicensedEvents } from "../db/reconciliationRepository.js";
import { getSampleByChainId } from "../db/sampleRepository.js";
import { getEffectiveSplit } from "../db/royaltySplitRepository.js";
import { createPayout } from "../db/payoutRepository.js";
import { computeLineItems } from "../services/royaltySplit.js";
import type { Pool } from "pg";

export interface ReconciliationConfig {
  pollIntervalMs: number;
  batchSize: number;
}

export function loadReconciliationConfigFromEnv(): ReconciliationConfig {
  return {
    pollIntervalMs: Number(process.env.RECONCILIATION_POLL_INTERVAL_MS) || 30_000,
    batchSize: Number(process.env.RECONCILIATION_BATCH_SIZE) || 100,
  };
}

export interface ReconcileOnceResult {
  processed: number;
  skippedNoSample: number;
  skippedNoSplit: number;
  failed: number;
}

/**
 * One reconciliation pass: finds "licensed" sale events with no payout yet
 * (see findUnreconciledLicensedEvents), resolves each against the sample's
 * royalty split effective at the sale's own on-chain ledger-close time —
 * not the current time — and creates a payout with its line items.
 *
 * Using the sale's ledger_closed_at rather than "now" is what makes a split
 * change after the fact unable to reach back and alter which version an
 * already-happened sale resolves to, this is the same "versioned splits
 * can't retroactively alter past payouts" property #22 asked for, actually
 * exercised end to end for the first time here.
 *
 * Each event is processed independently inside its own try/catch: one
 * malformed or unresolvable event must not block every event after it in
 * this batch, or every batch after this one — findUnreconciledLicensedEvents
 * orders oldest-first, so a permanently-failing event would otherwise sit
 * at the head of every future pass forever.
 */
export async function reconcileOnce(config: ReconciliationConfig, db: Pool = pool): Promise<ReconcileOnceResult> {
  const pending = await findUnreconciledLicensedEvents(config.batchSize, db);

  const result: ReconcileOnceResult = { processed: 0, skippedNoSample: 0, skippedNoSplit: 0, failed: 0 };

  for (const event of pending) {
    try {
      // sample_id in contract_events is the on-chain id (samples.chain_id),
      // same convention every other route resolves through.
      const sample = await getSampleByChainId(event.sampleChainId, db);
      if (!sample) {
        // Metadata was never POSTed to /api/samples/metadata for this
        // on-chain sample — the same gap already logged for
        // incrementSales() when this happens on the indexer side.
        result.skippedNoSample++;
        continue;
      }

      const effective = await getEffectiveSplit(sample.id, event.ledgerClosedAt, db);
      if (!effective) {
        // The sale happened, but no royalty split has ever been configured
        // for this sample — nobody to pay out to yet. Stays unreconciled
        // and is picked up again once a split exists.
        result.skippedNoSplit++;
        continue;
      }

      // Parsed here, inside the per-event try/catch, not in
      // findUnreconciledLicensedEvents — a malformed price must only ever
      // fail this one event, not the batch fetch every event in this pass
      // depends on.
      const totalAmount = BigInt(event.payload.price);
      const lineItems = computeLineItems(totalAmount, effective.recipients);
      await createPayout(sample.id, event.eventId, effective.version, totalAmount, lineItems, db);
      result.processed++;
    } catch (err) {
      result.failed++;
      console.error(`[reconciliation] failed to reconcile contract_events.id=${event.eventId}`, err);
    }
  }

  return result;
}

/**
 * Runs reconcileOnce on a fixed interval until the abort signal fires. A
 * failed pass is logged and retried next interval rather than crashing the
 * process — nothing commits for an event until its own createPayout call
 * succeeds, so there's no partial state to recover, just pick up again.
 */
export async function runReconciliationForever(config: ReconciliationConfig, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try {
      const result = await reconcileOnce(config);
      if (result.processed || result.skippedNoSample || result.skippedNoSplit || result.failed) {
        console.log(
          `[reconciliation] processed ${result.processed}, skipped ${result.skippedNoSample} (no sample metadata), ` +
            `${result.skippedNoSplit} (no split configured), ${result.failed} failed`,
        );
      }
    } catch (err) {
      console.error("[reconciliation] pass failed, will retry next interval", err);
    }
    await sleep(config.pollIntervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
