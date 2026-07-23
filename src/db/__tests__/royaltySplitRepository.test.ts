import { describe, it, expect, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";

let db: IMemoryDb;

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE samples (
      id SERIAL PRIMARY KEY,
      chain_id BIGINT UNIQUE NOT NULL,
      uploader VARCHAR(56) NOT NULL
    )
  `);
  db.public.none(`
    CREATE TABLE royalty_splits (
      id SERIAL PRIMARY KEY,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      version INTEGER NOT NULL,
      recipient VARCHAR(56) NOT NULL,
      basis_points INTEGER NOT NULL,
      effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (sample_id, version, recipient)
    )
  `);
  db.public.none(`INSERT INTO samples (chain_id, uploader) VALUES (1, 'GA')`);
});

// createSplitVersion() computes next_version as MAX(version)+1 for the
// sample inside a transaction guarded by an advisory lock — the advisory
// lock itself isn't something a single-threaded pg-mem test can exercise
// meaningfully, but the version-numbering logic it protects is tested here
// directly against the schema.
function nextVersion(sampleId: number): number {
  const row = db.public.one(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM royalty_splits WHERE sample_id = ${sampleId}`,
  );
  return row.next_version;
}

function insertVersion(sampleId: number, version: number, rows: { recipient: string; bps: number }[]) {
  for (const r of rows) {
    db.public.none(
      `INSERT INTO royalty_splits (sample_id, version, recipient, basis_points) VALUES (${sampleId}, ${version}, '${r.recipient}', ${r.bps})`,
    );
  }
}

describe("royalty_splits versioning", () => {
  it("first version for a sample is 1", () => {
    expect(nextVersion(1)).toBe(1);
  });

  it("increments per sample after a version is written", () => {
    insertVersion(1, nextVersion(1), [{ recipient: "GA", bps: 10000 }]);
    expect(nextVersion(1)).toBe(2);

    insertVersion(1, nextVersion(1), [{ recipient: "GB", bps: 10000 }]);
    expect(nextVersion(1)).toBe(3);
  });

  it("does not touch rows from a previous version when a new one is written", () => {
    insertVersion(1, 1, [{ recipient: "GA", bps: 10000 }]);
    insertVersion(1, 2, [{ recipient: "GB", bps: 5000 }, { recipient: "GC", bps: 5000 }]);

    const v1 = db.public.many(`SELECT * FROM royalty_splits WHERE sample_id = 1 AND version = 1`);
    expect(v1).toHaveLength(1);
    expect(v1[0].recipient).toBe("GA");
    expect(v1[0].basis_points).toBe(10000);
  });

  it("tracks version numbers independently per sample", () => {
    db.public.none(`INSERT INTO samples (chain_id, uploader) VALUES (2, 'GB')`);
    insertVersion(1, 1, [{ recipient: "GA", bps: 10000 }]);
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(2)).toBe(1);
  });

  it("rejects a duplicate recipient within the same version via the unique constraint", () => {
    insertVersion(1, 1, [{ recipient: "GA", bps: 5000 }]);
    expect(() => insertVersion(1, 1, [{ recipient: "GA", bps: 5000 }])).toThrow();
  });

  it("allows the same recipient to appear again in a later version", () => {
    insertVersion(1, 1, [{ recipient: "GA", bps: 10000 }]);
    expect(() => insertVersion(1, 2, [{ recipient: "GA", bps: 10000 }])).not.toThrow();
  });
});

describe("resolving the effective split at a point in time", () => {
  function insertVersionAt(sampleId: number, version: number, effectiveFrom: string, rows: { recipient: string; bps: number }[]) {
    for (const r of rows) {
      db.public.none(
        `INSERT INTO royalty_splits (sample_id, version, recipient, basis_points, effective_from)
         VALUES (${sampleId}, ${version}, '${r.recipient}', ${r.bps}, '${effectiveFrom}')`,
      );
    }
  }

  function effectiveVersionAt(sampleId: number, atTime: string): number | null {
    const rows = db.public.many(
      `SELECT version FROM royalty_splits
       WHERE sample_id = ${sampleId} AND effective_from <= '${atTime}'
       ORDER BY effective_from DESC, version DESC LIMIT 1`,
    );
    return rows.length > 0 ? rows[0].version : null;
  }

  it("resolves to null before any split exists", () => {
    expect(effectiveVersionAt(1, "2026-01-01T00:00:00Z")).toBeNull();
  });

  it("resolves to the only version once one is configured", () => {
    insertVersionAt(1, 1, "2026-01-01T00:00:00Z", [{ recipient: "GA", bps: 10000 }]);
    expect(effectiveVersionAt(1, "2026-06-01T00:00:00Z")).toBe(1);
  });

  it("a sale before any version was effective resolves to null, not the earliest version", () => {
    insertVersionAt(1, 1, "2026-06-01T00:00:00Z", [{ recipient: "GA", bps: 10000 }]);
    expect(effectiveVersionAt(1, "2026-01-01T00:00:00Z")).toBeNull();
  });

  it("a later version doesn't apply to a sale before its effective_from", () => {
    insertVersionAt(1, 1, "2026-01-01T00:00:00Z", [{ recipient: "GA", bps: 10000 }]);
    insertVersionAt(1, 2, "2026-06-01T00:00:00Z", [{ recipient: "GB", bps: 10000 }]);

    // Sale happened between v1 and v2 becoming effective — must resolve to v1,
    // exactly the "past payouts aren't retroactively altered" requirement.
    expect(effectiveVersionAt(1, "2026-03-01T00:00:00Z")).toBe(1);
    expect(effectiveVersionAt(1, "2026-07-01T00:00:00Z")).toBe(2);
  });
});
