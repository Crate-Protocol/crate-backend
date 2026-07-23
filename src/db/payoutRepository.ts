import { pool } from "./client.js";
import type { LineItem } from "../services/royaltySplit.js";
import type { Pool } from "pg";

export type PayoutStatus = "computed" | "submitted" | "confirmed";

export interface CreatePayoutResult {
  payoutId: number;
  /** false if sale_event_id already had a payout — an idempotent replay, not an error. */
  created: boolean;
}

/**
 * Records a payout and its line items for a sale event, computed against
 * a specific split version. Idempotent on sale_event_id: replaying the
 * same sale event (e.g. from an at-least-once event indexer, see #20)
 * returns the existing payout instead of inserting a duplicate.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING RETURNING id rather than a
 * check-then-insert — two concurrent calls for the same sale_event_id can
 * otherwise both pass a SELECT that finds nothing yet, and the loser's
 * plain INSERT then throws a unique-violation instead of returning the
 * winner's row like this function promises. Same pattern
 * applyEventBatchAndAdvanceCursor uses in indexerRepository.ts for
 * contract_events, for the same reason.
 */
export async function createPayout(
  sampleId: number,
  saleEventId: string,
  splitVersion: number,
  totalAmount: bigint,
  lineItems: LineItem[],
  db: Pool = pool,
): Promise<CreatePayoutResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO payouts (sample_id, sale_event_id, split_version, total_amount, status)
       VALUES ($1, $2, $3, $4, 'computed')
       ON CONFLICT (sale_event_id) DO NOTHING
       RETURNING id`,
      [sampleId, saleEventId, splitVersion, totalAmount],
    );

    if (inserted.rows.length === 0) {
      // Lost the race (or this is a genuine replay) — the winning row
      // already exists, fetch it instead of inserting a duplicate.
      const existing = await client.query("SELECT id FROM payouts WHERE sale_event_id = $1", [saleEventId]);
      await client.query("COMMIT");
      return { payoutId: existing.rows[0].id, created: false };
    }

    const payoutId: number = inserted.rows[0].id;

    for (const item of lineItems) {
      await client.query(
        `INSERT INTO payout_line_items (payout_id, recipient, amount) VALUES ($1, $2, $3)`,
        [payoutId, item.recipient, item.amount],
      );
    }

    await client.query("COMMIT");
    return { payoutId, created: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function recordSubmission(
  payoutId: number,
  recipient: string,
  stellarTxHash: string,
  db: Pool = pool,
): Promise<void> {
  await db.query(
    `UPDATE payout_line_items SET stellar_tx_hash = $1 WHERE payout_id = $2 AND recipient = $3`,
    [stellarTxHash, payoutId, recipient],
  );
}

export async function updatePayoutStatus(payoutId: number, status: PayoutStatus, db: Pool = pool): Promise<void> {
  await db.query("UPDATE payouts SET status = $1 WHERE id = $2", [status, payoutId]);
}

export interface PayoutRow {
  id: number;
  sale_event_id: string;
  split_version: number;
  total_amount: bigint;
  status: PayoutStatus;
  created_at: Date;
}

export async function listPayoutsForSample(sampleId: number, db: Pool = pool): Promise<PayoutRow[]> {
  const { rows } = await db.query(
    `SELECT id, sale_event_id, split_version, total_amount, status, created_at
     FROM payouts WHERE sample_id = $1 ORDER BY created_at DESC`,
    [sampleId],
  );
  return rows;
}
