import { pool } from "./client.js";
import type { Pool, PoolClient } from "pg";
import type { ModerationStatus } from "../services/moderationStateMachine.js";

export interface Sample {
  id: number;
  chain_id: bigint;
  title: string;
  ipfs_cid: string;
  uploader: string;
  genre: string | null;
  bpm: number | null;
  lease_price: bigint | null;
  premium_price: bigint | null;
  exclusive_price: bigint | null;
  is_exclusive: boolean;
  total_sales: number;
  created_at: Date;
  updated_at: Date;
  moderation_status: ModerationStatus;
}

export interface ListSamplesOpts {
  limit: number;
  offset: number;
  genre?: string;
  uploader?: string;
}

export async function listSamples(opts: ListSamplesOpts): Promise<{ data: Sample[]; total: number }> {
  // Taken-down samples are excluded from public listing/search, but stay
  // resolvable via getSampleByChainId so payout/history lookups don't break.
  const conditions: string[] = ["moderation_status != 'taken_down'"];
  const values: unknown[] = [];
  let idx = 1;

  if (opts.genre) {
    conditions.push(`genre = $${idx++}`);
    values.push(opts.genre);
  }
  if (opts.uploader) {
    conditions.push(`uploader = $${idx++}`);
    values.push(opts.uploader);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM samples ${where}`, values);
  const total: number = countResult.rows[0].total;

  values.push(opts.limit, opts.offset);
  const dataResult = await pool.query(
    `SELECT * FROM samples ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    values,
  );

  return { data: dataResult.rows as Sample[], total };
}

export async function getSampleByChainId(chainId: bigint, db: Pool | PoolClient = pool): Promise<Sample | null> {
  const result = await db.query("SELECT * FROM samples WHERE chain_id = $1", [chainId]);
  return result.rows[0] as Sample | undefined ?? null;
}

export interface UpsertSampleData {
  chain_id: bigint;
  title: string;
  ipfs_cid: string;
  uploader: string;
  genre?: string;
  bpm?: number;
  lease_price?: bigint;
  premium_price?: bigint;
  exclusive_price?: bigint;
  is_exclusive?: boolean;
}

export async function upsertSampleMetadata(data: UpsertSampleData): Promise<{ row: Sample; inserted: boolean }> {
  const result = await pool.query(
    `INSERT INTO samples (chain_id, title, ipfs_cid, uploader, genre, bpm, lease_price, premium_price, exclusive_price, is_exclusive)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (chain_id) DO UPDATE SET
       title = EXCLUDED.title,
       ipfs_cid = EXCLUDED.ipfs_cid,
       genre = EXCLUDED.genre,
       bpm = EXCLUDED.bpm,
       lease_price = EXCLUDED.lease_price,
       premium_price = EXCLUDED.premium_price,
       exclusive_price = EXCLUDED.exclusive_price,
       is_exclusive = EXCLUDED.is_exclusive
     RETURNING *, (xmax::text = '0') AS was_inserted`,
    [
      data.chain_id,
      data.title,
      data.ipfs_cid,
      data.uploader,
      data.genre ?? null,
      data.bpm ?? null,
      data.lease_price ?? null,
      data.premium_price ?? null,
      data.exclusive_price ?? null,
      data.is_exclusive ?? false,
    ],
  );

  const row = result.rows[0] as Sample & { was_inserted: boolean };
  const { was_inserted, ...sample } = row;
  return { row: sample as Sample, inserted: was_inserted };
}

// db defaults to the shared pool, but accepts a PoolClient so a caller
// running inside its own transaction (the indexer, applying a "licensed"
// event alongside a contract_events insert and a cursor advance) can pass
// its client and have this participate in that same transaction instead of
// committing independently on a separate pooled connection.
// Returns the number of rows updated, so callers applying on-chain events can
// tell a genuine sample apart from one whose off-chain metadata was never
// POSTed to /api/samples/metadata (chainId not found -> 0 rows, silently).
export async function incrementSales(chainId: bigint, db: Pool | PoolClient = pool): Promise<number> {
  const result = await db.query("UPDATE samples SET total_sales = total_sales + 1 WHERE chain_id = $1", [chainId]);
  return result.rowCount ?? 0;
}

export async function deleteSample(chainId: bigint, uploader: string): Promise<number> {
  const result = await pool.query("DELETE FROM samples WHERE chain_id = $1 AND uploader = $2", [chainId, uploader]);
  return result.rowCount ?? 0;
}
