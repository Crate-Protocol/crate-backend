import { pool } from "./client.js";
import type { LineItem } from "../services/royaltySplit.js";

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
 */
export async function createPayout(
  sampleId: number,
  saleEventId: string,
  splitVersion: number,
  totalAmount: bigint,
  lineItems: LineItem[],
): Promise<CreatePayoutResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT id FROM payouts WHERE sale_event_id = $1", [saleEventId]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { payoutId: existing.rows[0].id, created: false };
    }

    const { rows } = await client.query(
      `INSERT INTO payouts (sample_id, sale_event_id, split_version, total_amount, status)
       VALUES ($1, $2, $3, $4, 'computed') RETURNING id`,
      [sampleId, saleEventId, splitVersion, totalAmount],
    );
    const payoutId: number = rows[0].id;

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

export async function recordSubmission(payoutId: number, recipient: string, stellarTxHash: string): Promise<void> {
  await pool.query(
    `UPDATE payout_line_items SET stellar_tx_hash = $1 WHERE payout_id = $2 AND recipient = $3`,
    [stellarTxHash, payoutId, recipient],
  );
}

export async function updatePayoutStatus(payoutId: number, status: PayoutStatus): Promise<void> {
  await pool.query("UPDATE payouts SET status = $1 WHERE id = $2", [status, payoutId]);
}

export interface PayoutRow {
  id: number;
  sale_event_id: string;
  split_version: number;
  total_amount: bigint;
  status: PayoutStatus;
  created_at: Date;
}

export async function listPayoutsForSample(sampleId: number): Promise<PayoutRow[]> {
  const { rows } = await pool.query(
    `SELECT id, sale_event_id, split_version, total_amount, status, created_at
     FROM payouts WHERE sample_id = $1 ORDER BY created_at DESC`,
    [sampleId],
  );
  return rows;
}
