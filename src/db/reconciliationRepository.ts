import { pool } from "./client.js";
import type { Pool } from "pg";

export interface PendingSaleEvent {
  /** contract_events.id, stringified — becomes the payout's sale_event_id. */
  eventId: string;
  sampleChainId: bigint;
  ledgerClosedAt: Date;
  /**
   * The raw, un-parsed JSONB payload — {buyer, price} for a "licensed"
   * event. Deliberately not parsed to bigint/etc. here: a malformed value
   * (bad JSON shape from a future event type change, say) would throw for
   * the whole batch this function returns, before the caller's per-event
   * error handling ever gets a chance to isolate it to just that one event.
   * See reconcileOnce() in reconciliation/worker.ts for where parsing and
   * that isolation actually happen.
   */
  payload: { buyer: string; price: string };
}

/**
 * Finds "licensed" contract_events with no corresponding payout yet, oldest
 * first. "No payout yet" is a LEFT JOIN against payouts on sale_event_id
 * rather than a separate reconciliation cursor — createPayout() is already
 * idempotent on that column, so there's nothing left for a cursor to
 * protect against, and unlike a cursor this can't drift: an event that
 * failed to reconcile for any reason just shows up again on the next call,
 * nothing to reset or re-seed.
 */
export async function findUnreconciledLicensedEvents(limit: number, db: Pool = pool): Promise<PendingSaleEvent[]> {
  const { rows } = await db.query(
    `SELECT ce.id, ce.sample_id, ce.payload, ce.ledger_closed_at
     FROM contract_events ce
     LEFT JOIN payouts p ON p.sale_event_id = ce.id::text
     WHERE ce.event_type = 'licensed' AND p.id IS NULL
     ORDER BY ce.id ASC
     LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    eventId: String(row.id),
    sampleChainId: BigInt(row.sample_id),
    ledgerClosedAt: new Date(row.ledger_closed_at),
    payload: row.payload,
  }));
}
