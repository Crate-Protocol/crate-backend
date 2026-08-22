import { pool } from "./client.js";
import type { Pool, PoolClient } from "pg";

export interface Sale {
  id: number;
  tx_hash: string;
  sample_id: bigint;
  buyer: string;
  seller: string;
  tier: number;
  amount: bigint;
  token: string;
  ledger: bigint;
  occurred_at: Date;
  created_at: Date;
}

export interface InsertSaleData {
  tx_hash: string;
  sample_id: bigint;
  buyer: string;
  seller: string;
  tier: number;
  amount: bigint;
  token: string;
  ledger: number;
  occurred_at: string;
}

/**
 * Inserts a sale record. Uses ON CONFLICT DO NOTHING so replaying the same
 * event (worker restart, overlapping range) doesn't duplicate rows.
 * Returns true if a new row was inserted, false if it was a no-op.
 */
export async function insertSale(data: InsertSaleData, db: Pool | PoolClient = pool): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO sales (tx_hash, sample_id, buyer, seller, tier, amount, token, ledger, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tx_hash) DO NOTHING`,
    [
      data.tx_hash,
      data.sample_id,
      data.buyer,
      data.seller,
      data.tier,
      data.amount,
      data.token,
      data.ledger,
      data.occurred_at,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns all sales for a given seller address, most recent first.
 * Used by the earnings endpoint to give producers a breakdown of
 * which beats earned what.
 */
export async function getSalesBySeller(
  address: string,
  limit: number = 50,
  db: Pool | PoolClient = pool,
): Promise<Sale[]> {
  const result = await db.query<Sale>(
    `SELECT * FROM sales WHERE seller = $1 ORDER BY occurred_at DESC LIMIT $2`,
    [address, limit],
  );
  return result.rows;
}

/**
 * Returns total earnings (sum of amounts) for a seller address.
 */
export async function getTotalEarnings(
  address: string,
  db: Pool | PoolClient = pool,
): Promise<bigint> {
  const result = await db.query<{ total: bigint | null }>(
    `SELECT SUM(amount) as total FROM sales WHERE seller = $1`,
    [address],
  );
  return result.rows[0]?.total ?? 0n;
}

/**
 * Returns per-beat sales breakdown for a seller: how many times each
 * sample sold and total revenue per sample.
 */
export async function getSalesBreakdownBySeller(
  address: string,
  db: Pool | PoolClient = pool,
): Promise<Array<{ sample_id: bigint; count: number; total_amount: bigint }>> {
  const result = await db.query(
    `SELECT sample_id, COUNT(*)::int as count, SUM(amount) as total_amount
     FROM sales WHERE seller = $1
     GROUP BY sample_id
     ORDER BY total_amount DESC`,
    [address],
  );
  return result.rows;
}
