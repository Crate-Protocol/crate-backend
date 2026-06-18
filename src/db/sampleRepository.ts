import pg from "pg";
import { pool } from "./client.js";

pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));

export interface Sample {
  id: number;
  chain_id: number;
  title: string;
  ipfs_cid: string;
  uploader: string;
  genre: string | null;
  bpm: number | null;
  lease_price: number | null;
  premium_price: number | null;
  exclusive_price: number | null;
  is_exclusive: boolean;
  total_sales: number;
  created_at: Date;
  updated_at: Date;
}

export interface ListSamplesOpts {
  limit: number;
  offset: number;
  genre?: string;
  uploader?: string;
}

export async function listSamples(opts: ListSamplesOpts): Promise<{ data: Sample[]; total: number }> {
  const conditions: string[] = [];
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

export async function getSampleByChainId(chainId: number): Promise<Sample | null> {
  const result = await pool.query("SELECT * FROM samples WHERE chain_id = $1", [chainId]);
  return result.rows[0] as Sample | undefined ?? null;
}

export interface UpsertSampleData {
  chain_id: number;
  title: string;
  ipfs_cid: string;
  uploader: string;
  genre?: string;
  bpm?: number;
  lease_price?: number;
  premium_price?: number;
  exclusive_price?: number;
  is_exclusive?: boolean;
}

export async function upsertSampleMetadata(data: UpsertSampleData): Promise<{ row: Sample; inserted: boolean }> {
  const result = await pool.query(
    `INSERT INTO samples (chain_id, title, ipfs_cid, uploader, genre, bpm, lease_price, premium_price, exclusive_price, is_exclusive)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (chain_id) DO UPDATE SET
       title = EXCLUDED.title,
       ipfs_cid = EXCLUDED.ipfs_cid,
       uploader = EXCLUDED.uploader,
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

export async function incrementSales(chainId: number): Promise<void> {
  await pool.query("UPDATE samples SET total_sales = total_sales + 1 WHERE chain_id = $1", [chainId]);
}

export async function deleteSample(chainId: number, uploader: string): Promise<number> {
  const result = await pool.query("DELETE FROM samples WHERE chain_id = $1 AND uploader = $2", [chainId, uploader]);
  return result.rowCount ?? 0;
}
