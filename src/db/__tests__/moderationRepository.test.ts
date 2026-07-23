import { describe, it, expect, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";

// Mirrors the repository's raw SQL against pg-mem, same style as
// sampleRepository.test.ts — the real functions use pool.connect() with
// transactions, which isn't wired through pg-mem here, so this checks the
// WHERE-clause semantics the transition guards rely on.
let db: IMemoryDb;

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE samples (
      id SERIAL PRIMARY KEY,
      chain_id BIGINT UNIQUE NOT NULL,
      uploader VARCHAR(56) NOT NULL,
      moderation_status VARCHAR(20) NOT NULL DEFAULT 'active'
    )
  `);
  db.public.none(`
    CREATE TABLE sample_flags (
      id SERIAL PRIMARY KEY,
      sample_chain_id BIGINT NOT NULL REFERENCES samples(chain_id) ON DELETE CASCADE,
      reporter VARCHAR(56),
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      resolution_note TEXT,
      reviewed_by VARCHAR(56),
      created_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP
    )
  `);
  db.public.none(
    "INSERT INTO samples (chain_id, uploader, moderation_status) VALUES (1, 'GA', 'active')",
  );
});

describe("reporting a sample", () => {
  it("moves an active sample to flagged on its first report", () => {
    db.public.none("INSERT INTO sample_flags (sample_chain_id, reason) VALUES (1, 'copyright')");
    db.public.none(
      "UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1 AND moderation_status = 'active'",
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("flagged");
  });

  it("does not move an already flagged sample when reported again", () => {
    db.public.none("UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1");
    db.public.none("INSERT INTO sample_flags (sample_chain_id, reason) VALUES (1, 'second report')");
    db.public.none(
      "UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1 AND moderation_status = 'active'",
    );
    const flags = db.public.many("SELECT * FROM sample_flags WHERE sample_chain_id = 1");
    expect(flags).toHaveLength(1);
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("flagged");
  });
});

describe("markUnderReview guard", () => {
  it("only succeeds from flagged", () => {
    db.public.none("UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1");
    db.public.none(
      "UPDATE samples SET moderation_status = 'under_review' WHERE chain_id = 1 AND moderation_status = 'flagged'",
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("under_review");
  });

  it("does nothing when the sample is active, not flagged", () => {
    const result = db.public.none(
      "UPDATE samples SET moderation_status = 'under_review' WHERE chain_id = 1 AND moderation_status = 'flagged'",
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("active");
  });
});

describe("confirmTakedown guard", () => {
  it("succeeds from active, flagged, or under_review", () => {
    for (const status of ["active", "flagged", "under_review"]) {
      db.public.none(`UPDATE samples SET moderation_status = '${status}' WHERE chain_id = 1`);
      db.public.none(
        "UPDATE samples SET moderation_status = 'taken_down' WHERE chain_id = 1 AND moderation_status != 'taken_down'",
      );
      const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
      expect(row.moderation_status).toBe("taken_down");
    }
  });

  it("is a no-op on an already taken_down sample", () => {
    db.public.none("UPDATE samples SET moderation_status = 'taken_down' WHERE chain_id = 1");
    db.public.none(
      "UPDATE samples SET moderation_status = 'taken_down' WHERE chain_id = 1 AND moderation_status != 'taken_down'",
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("taken_down");
  });

  it("resolves open flags as reviewed", () => {
    db.public.none("UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1");
    db.public.none("INSERT INTO sample_flags (sample_chain_id, reason) VALUES (1, 'copyright')");
    db.public.none(
      "UPDATE sample_flags SET status = 'reviewed', reviewed_by = 'GADMIN' WHERE sample_chain_id = 1 AND status = 'open'",
    );
    const flag = db.public.one("SELECT * FROM sample_flags WHERE sample_chain_id = 1");
    expect(flag.status).toBe("reviewed");
    expect(flag.reviewed_by).toBe("GADMIN");
  });
});

describe("dismissFlags guard", () => {
  it("only succeeds from flagged or under_review", () => {
    db.public.none("UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1");
    db.public.none(
      "UPDATE samples SET moderation_status = 'active' WHERE chain_id = 1 AND moderation_status IN ('flagged', 'under_review')",
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("active");
  });

  it("does not touch an already taken_down sample", () => {
    db.public.none("UPDATE samples SET moderation_status = 'taken_down' WHERE chain_id = 1");
    db.public.none(
      "UPDATE samples SET moderation_status = 'active' WHERE chain_id = 1 AND moderation_status IN ('flagged', 'under_review')",
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.moderation_status).toBe("taken_down");
  });

  it("marks open flags dismissed", () => {
    db.public.none("UPDATE samples SET moderation_status = 'flagged' WHERE chain_id = 1");
    db.public.none("INSERT INTO sample_flags (sample_chain_id, reason) VALUES (1, 'mistaken report')");
    db.public.none(
      "UPDATE sample_flags SET status = 'dismissed' WHERE sample_chain_id = 1 AND status = 'open'",
    );
    const flag = db.public.one("SELECT * FROM sample_flags WHERE sample_chain_id = 1");
    expect(flag.status).toBe("dismissed");
  });
});

describe("flag cascade", () => {
  it("deletes flags when the sample is deleted", () => {
    db.public.none("INSERT INTO sample_flags (sample_chain_id, reason) VALUES (1, 'copyright')");
    db.public.none("DELETE FROM samples WHERE chain_id = 1");
    const flags = db.public.many("SELECT * FROM sample_flags");
    expect(flags).toHaveLength(0);
  });
});
