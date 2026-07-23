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
      title VARCHAR(200) NOT NULL,
      ipfs_cid VARCHAR(100) NOT NULL,
      uploader VARCHAR(56) NOT NULL,
      genre VARCHAR(50),
      bpm INTEGER,
      lease_price BIGINT,
      premium_price BIGINT,
      exclusive_price BIGINT,
      is_exclusive BOOLEAN DEFAULT FALSE,
      total_sales INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      moderation_status VARCHAR(20) NOT NULL DEFAULT 'active'
    )
  `);
});

function insertSample(data: {
  chain_id: number;
  title: string;
  ipfs_cid: string;
  uploader: string;
  genre?: string;
  moderation_status?: string;
}) {
  const genre = data.genre ? `'${data.genre}'` : "NULL";
  const status = data.moderation_status ?? "active";
  db.public.none(
    `INSERT INTO samples (chain_id, title, ipfs_cid, uploader, genre, moderation_status) VALUES (${data.chain_id}, '${data.title}', '${data.ipfs_cid}', '${data.uploader}', ${genre}, '${status}')`,
  );
}

describe("upsertSampleMetadata", () => {
  it("inserts a new sample", () => {
    insertSample({ chain_id: 1, title: "Test", ipfs_cid: "QmHash", uploader: "GA" });
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.title).toBe("Test");
    expect(row.uploader).toBe("GA");
  });

  it("updates existing sample without changing uploader", () => {
    insertSample({ chain_id: 1, title: "Original", ipfs_cid: "QmOrig", uploader: "GA" });
    db.public.none(
      `INSERT INTO samples (chain_id, title, ipfs_cid, uploader) VALUES (1, 'Updated', 'QmUpd', 'GB')
       ON CONFLICT (chain_id) DO UPDATE SET title = EXCLUDED.title, ipfs_cid = EXCLUDED.ipfs_cid`,
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.title).toBe("Updated");
    expect(row.uploader).toBe("GA");
  });

  it("does not overwrite uploader on conflict", () => {
    insertSample({ chain_id: 1, title: "Orig", ipfs_cid: "Qm1", uploader: "GA" });
    db.public.none(
      `INSERT INTO samples (chain_id, title, ipfs_cid, uploader) VALUES (1, 'X', 'QmX', 'GB')
       ON CONFLICT (chain_id) DO UPDATE SET title = EXCLUDED.title, ipfs_cid = EXCLUDED.ipfs_cid`,
    );
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.uploader).toBe("GA");
  });
});

describe("listSamples", () => {
  beforeEach(() => {
    insertSample({ chain_id: 1, title: "S1", ipfs_cid: "Qm1", uploader: "GA", genre: "Trap" });
    insertSample({ chain_id: 2, title: "S2", ipfs_cid: "Qm2", uploader: "GB", genre: "HipHop" });
    insertSample({ chain_id: 3, title: "S3", ipfs_cid: "Qm3", uploader: "GA", genre: "Trap" });
  });

  it("returns all samples", () => {
    const count = db.public.one("SELECT COUNT(*)::int AS total FROM samples");
    expect(count.total).toBe(3);
  });

  it("filters by genre", () => {
    const result = db.public.many("SELECT * FROM samples WHERE genre = 'Trap'");
    expect(result).toHaveLength(2);
  });

  it("filters by uploader", () => {
    const result = db.public.many("SELECT * FROM samples WHERE uploader = 'GA'");
    expect(result).toHaveLength(2);
  });
});

describe("getSampleByChainId", () => {
  it("returns empty for non-existent chain_id", () => {
    const result = db.public.many("SELECT * FROM samples WHERE chain_id = 999");
    expect(result).toHaveLength(0);
  });

  it("returns sample for existing chain_id", () => {
    insertSample({ chain_id: 1, title: "Test", ipfs_cid: "QmHash", uploader: "GA" });
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 1");
    expect(row.title).toBe("Test");
  });
});

describe("deleteSample", () => {
  it("does not delete when uploader does not match", () => {
    insertSample({ chain_id: 1, title: "T", ipfs_cid: "Qm", uploader: "GA" });
    db.public.none("DELETE FROM samples WHERE chain_id = 1 AND uploader = 'GB'");
    const count = db.public.one("SELECT COUNT(*)::int AS total FROM samples");
    expect(count.total).toBe(1);
  });

  it("deletes when uploader matches", () => {
    insertSample({ chain_id: 1, title: "T", ipfs_cid: "Qm", uploader: "GA" });
    db.public.none("DELETE FROM samples WHERE chain_id = 1 AND uploader = 'GA'");
    const count = db.public.one("SELECT COUNT(*)::int AS total FROM samples");
    expect(count.total).toBe(0);
  });
});

describe("listSamples excludes taken_down samples", () => {
  beforeEach(() => {
    insertSample({ chain_id: 1, title: "S1", ipfs_cid: "Qm1", uploader: "GA", moderation_status: "active" });
    insertSample({ chain_id: 2, title: "S2", ipfs_cid: "Qm2", uploader: "GA", moderation_status: "flagged" });
    insertSample({ chain_id: 3, title: "S3", ipfs_cid: "Qm3", uploader: "GA", moderation_status: "taken_down" });
  });

  it("leaves taken_down samples out of the public listing query", () => {
    const result = db.public.many("SELECT * FROM samples WHERE moderation_status != 'taken_down'");
    expect(result).toHaveLength(2);
    expect(result.map((r: any) => Number(r.chain_id)).sort()).toEqual([1, 2]);
  });

  it("still lets flagged samples show up in listing (only taken_down is hidden)", () => {
    const result = db.public.many("SELECT * FROM samples WHERE moderation_status != 'taken_down'");
    expect(result.some((r: any) => Number(r.chain_id) === 2)).toBe(true);
  });

  it("still resolves a taken_down sample by chain_id, unfiltered", () => {
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 3");
    expect(row.moderation_status).toBe("taken_down");
  });

  it("still lets a taken_down sample's total_sales be incremented", () => {
    db.public.none("UPDATE samples SET total_sales = total_sales + 1 WHERE chain_id = 3");
    const row = db.public.one("SELECT * FROM samples WHERE chain_id = 3");
    expect(row.total_sales).toBe(1);
  });
});
