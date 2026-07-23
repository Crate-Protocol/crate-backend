import { pool } from "./client.js";
import { assertValidSplit, type SplitRecipient } from "../services/royaltySplit.js";
import type { Pool } from "pg";

export interface RoyaltySplitRow {
  version: number;
  recipient: string;
  basis_points: number;
  effective_from: Date;
}

export interface CreateSplitVersionResult {
  version: number;
  effectiveFrom: Date;
}

/**
 * Creates a new split version for a sample. Never touches existing rows —
 * versions are append-only so past payouts (which record the version they
 * were computed against) can't be retroactively altered by a later config
 * change.
 *
 * Serializes concurrent calls for the same sample with a transaction-scoped
 * advisory lock. Without it, two concurrent configure requests could both
 * read "next version = N" before either commits and interleave two
 * different recipient sets under the same version number.
 */
export async function createSplitVersion(
  sampleId: number,
  recipients: SplitRecipient[],
  effectiveFrom: Date = new Date(),
): Promise<CreateSplitVersionResult> {
  assertValidSplit(recipients);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [sampleId]);

    const { rows } = await client.query(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM royalty_splits WHERE sample_id = $1",
      [sampleId],
    );
    const version: number = rows[0].next_version;

    for (const r of recipients) {
      await client.query(
        `INSERT INTO royalty_splits (sample_id, version, recipient, basis_points, effective_from)
         VALUES ($1, $2, $3, $4, $5)`,
        [sampleId, version, r.recipient, r.basisPoints, effectiveFrom],
      );
    }

    await client.query("COMMIT");
    return { version, effectiveFrom };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listSplitVersions(sampleId: number): Promise<RoyaltySplitRow[]> {
  const { rows } = await pool.query(
    `SELECT version, recipient, basis_points, effective_from FROM royalty_splits
     WHERE sample_id = $1 ORDER BY version ASC, recipient ASC`,
    [sampleId],
  );
  return rows;
}

/**
 * Resolves the split version effective at `atTime` — the greatest
 * effective_from <= atTime for the sample. Returns null if no split has
 * been configured yet, or none is effective at that time.
 */
export async function getEffectiveSplit(
  sampleId: number,
  atTime: Date,
  db: Pool = pool,
): Promise<{ version: number; recipients: SplitRecipient[] } | null> {
  const { rows: versionRows } = await db.query(
    `SELECT version FROM royalty_splits
     WHERE sample_id = $1 AND effective_from <= $2
     ORDER BY effective_from DESC, version DESC LIMIT 1`,
    [sampleId, atTime],
  );
  if (versionRows.length === 0) return null;

  const version: number = versionRows[0].version;
  const { rows } = await db.query(
    `SELECT recipient, basis_points AS "basisPoints" FROM royalty_splits
     WHERE sample_id = $1 AND version = $2`,
    [sampleId, version],
  );
  return { version, recipients: rows };
}
