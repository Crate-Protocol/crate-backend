import { pool } from "./client.js";
import type { Sample, ModerationStatus } from "./sampleRepository.js";

export interface SampleFlag {
  id: number;
  sample_chain_id: bigint;
  reporter: string | null;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  resolution_note: string | null;
  reviewed_by: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

export interface CreateFlagData {
  sampleChainId: bigint;
  reason: string;
  reporter?: string;
}

// Reports the sample and — the first time it happens — moves it from
// active to flagged so it surfaces in the review queue. A second report
// against an already flagged/under_review/taken_down sample still gets
// recorded, it just doesn't move the status backward.
export async function createFlag(data: CreateFlagData): Promise<{ flag: SampleFlag; sample: Sample } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sampleResult = await client.query(
      "SELECT * FROM samples WHERE chain_id = $1 FOR UPDATE",
      [data.sampleChainId],
    );
    const sampleRow = sampleResult.rows[0] as Sample | undefined;
    if (!sampleRow) {
      await client.query("ROLLBACK");
      return null;
    }

    const flagResult = await client.query(
      `INSERT INTO sample_flags (sample_chain_id, reporter, reason)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.sampleChainId, data.reporter ?? null, data.reason],
    );

    let sample = sampleRow;
    if (sampleRow.moderation_status === "active") {
      const updateResult = await client.query(
        "UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = $1 RETURNING *",
        [data.sampleChainId],
      );
      sample = updateResult.rows[0] as Sample;
    }

    await client.query("COMMIT");
    return { flag: flagResult.rows[0] as SampleFlag, sample };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface QueueEntry {
  sample: Sample;
  openFlags: SampleFlag[];
}

export async function getModerationQueue(opts: {
  status?: Extract<ModerationStatus, "flagged" | "under_review">;
  limit: number;
  offset: number;
}): Promise<{ data: QueueEntry[]; total: number }> {
  const statuses = opts.status ? [opts.status] : ["flagged", "under_review"];

  const countResult = await pool.query(
    "SELECT COUNT(*)::int AS total FROM samples WHERE moderation_status = ANY($1)",
    [statuses],
  );
  const total: number = countResult.rows[0].total;

  const samplesResult = await pool.query(
    `SELECT * FROM samples WHERE moderation_status = ANY($1)
     ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
    [statuses, opts.limit, opts.offset],
  );
  const samples = samplesResult.rows as Sample[];
  if (samples.length === 0) return { data: [], total };

  const chainIds = samples.map((s) => s.chain_id);
  const flagsResult = await pool.query(
    "SELECT * FROM sample_flags WHERE sample_chain_id = ANY($1) AND status = 'open' ORDER BY created_at ASC",
    [chainIds],
  );
  const flagsBySample = new Map<string, SampleFlag[]>();
  for (const flag of flagsResult.rows as SampleFlag[]) {
    const key = flag.sample_chain_id.toString();
    const list = flagsBySample.get(key) ?? [];
    list.push(flag);
    flagsBySample.set(key, list);
  }

  const data = samples.map((sample) => ({
    sample,
    openFlags: flagsBySample.get(sample.chain_id.toString()) ?? [],
  }));

  return { data, total };
}

export async function markUnderReview(chainId: bigint): Promise<Sample | null> {
  const result = await pool.query(
    "UPDATE samples SET moderation_status = 'under_review' WHERE chain_id = $1 AND moderation_status = 'flagged' RETURNING *",
    [chainId],
  );
  return (result.rows[0] as Sample | undefined) ?? null;
}

export interface ResolveFlagsOpts {
  note?: string;
  reviewedBy: string;
}

export interface ResolutionResult {
  sample: Sample;
  flagsResolved: number;
}

// Confirmed takedown is reachable from any non-terminal status, not just
// flagged/under_review — a platform-side takedown doesn't need a prior
// report. The caller is responsible for the actual IPFS unpin.
export async function confirmTakedown(chainId: bigint, opts: ResolveFlagsOpts): Promise<ResolutionResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sampleResult = await client.query(
      "UPDATE samples SET moderation_status = 'taken_down' WHERE chain_id = $1 AND moderation_status != 'taken_down' RETURNING *",
      [chainId],
    );
    const sample = sampleResult.rows[0] as Sample | undefined;
    if (!sample) {
      await client.query("ROLLBACK");
      return null;
    }

    const flagsResult = await client.query(
      `UPDATE sample_flags SET status = 'reviewed', resolution_note = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE sample_chain_id = $1 AND status = 'open'`,
      [chainId, opts.note ?? null, opts.reviewedBy],
    );

    await client.query("COMMIT");
    return { sample, flagsResolved: flagsResult.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function dismissFlags(chainId: bigint, opts: ResolveFlagsOpts): Promise<ResolutionResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sampleResult = await client.query(
      "UPDATE samples SET moderation_status = 'active' WHERE chain_id = $1 AND moderation_status IN ('flagged', 'under_review') RETURNING *",
      [chainId],
    );
    const sample = sampleResult.rows[0] as Sample | undefined;
    if (!sample) {
      await client.query("ROLLBACK");
      return null;
    }

    const flagsResult = await client.query(
      `UPDATE sample_flags SET status = 'dismissed', resolution_note = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE sample_chain_id = $1 AND status = 'open'`,
      [chainId, opts.note ?? null, opts.reviewedBy],
    );

    await client.query("COMMIT");
    return { sample, flagsResolved: flagsResult.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
