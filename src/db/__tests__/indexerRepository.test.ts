import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";
import type { Pool, PoolClient } from "pg";
import {
  getCursor,
  initCursor,
  applyEventBatchAndAdvanceCursor,
  getPlatformStats,
} from "../indexerRepository.js";
import type { DecodedEvent } from "../../indexer/types.js";

// pg-mem doesn't route BIGINT columns through pg.types.setTypeParser the way
// real Postgres does — it returns a plain JS number instead of the bigint
// src/db/client.ts's setTypeParser(20, BigInt) produces in production.
// Values here stay well under Number.MAX_SAFE_INTEGER, so BigInt(...) is a
// safe, honest coercion for comparison rather than a workaround masking
// anything.
const bi = (v: unknown): bigint => BigInt(v as number | string | bigint);

let db: IMemoryDb;
let pool: any;

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE samples (
      id SERIAL PRIMARY KEY,
      chain_id BIGINT UNIQUE NOT NULL,
      total_sales INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.public.none(`
    CREATE TABLE contract_events (
      id SERIAL PRIMARY KEY,
      contract_id TEXT NOT NULL,
      ledger INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      sample_id BIGINT NOT NULL,
      payload JSONB NOT NULL,
      ledger_closed_at TIMESTAMP NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (ledger, tx_hash, event_index)
    )
  `);
  db.public.none(`
    CREATE TABLE known_producers (
      address TEXT PRIMARY KEY,
      first_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  db.public.none(`
    CREATE TABLE platform_stats (
      contract_id TEXT PRIMARY KEY,
      total_samples INTEGER NOT NULL DEFAULT 0,
      total_volume BIGINT NOT NULL DEFAULT 0,
      total_producers INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  db.public.none(`
    CREATE TABLE indexer_cursor (
      contract_id TEXT PRIMARY KEY,
      last_ledger INTEGER NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  db.public.none(`INSERT INTO samples (chain_id, total_sales) VALUES (7, 0)`);

  const { Pool } = db.adapters.createPg();
  pool = new Pool();
});

const CONTRACT_ID = "CTESTCONTRACT";

function uploadedEvent(overrides: Partial<DecodedEvent> = {}): DecodedEvent {
  return {
    contractId: CONTRACT_ID,
    ledger: 100,
    txHash: "tx1",
    eventIndex: 0,
    ledgerClosedAt: "2024-01-01T00:00:00Z",
    eventType: "uploaded",
    sampleId: 7n,
    uploader: "GUPLOADER",
    ...overrides,
  } as DecodedEvent;
}

function licensedEvent(overrides: Partial<DecodedEvent> = {}): DecodedEvent {
  return {
    contractId: CONTRACT_ID,
    ledger: 100,
    txHash: "tx2",
    eventIndex: 0,
    ledgerClosedAt: "2024-01-01T00:00:00Z",
    eventType: "licensed",
    sampleId: 7n,
    buyer: "GBUYER",
    price: 1000n,
    ...overrides,
  } as DecodedEvent;
}

describe("cursor", () => {
  it("returns null before it's been initialized", async () => {
    expect(await getCursor(CONTRACT_ID, pool)).toBeNull();
  });

  it("initCursor seeds it, and only the first call wins", async () => {
    await initCursor(CONTRACT_ID, 50, pool);
    await initCursor(CONTRACT_ID, 999, pool); // should be a no-op
    expect(await getCursor(CONTRACT_ID, pool)).toBe(50);
  });
});

// pg-mem's ON CONFLICT DO NOTHING (with or without RETURNING) always reports
// rowCount: 1, even on an actual conflict — confirmed independently with a
// minimal repro. That makes it unable to correctly exercise the "was this
// insert actually new" branch that applyEventBatchAndAdvanceCursor's
// concurrency-safety now depends on. So this suite keeps pg-mem only for
// what it does get right (schema-level reads/writes with no duplicate
// insert involved); the RETURNING-gated branching itself is tested below
// against a hand-controlled fake client instead.
describe("applyEventBatchAndAdvanceCursor — schema-level behavior (pg-mem)", () => {
  it("applying a licensed event once bumps total_sales and total_volume", async () => {
    const result = await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [licensedEvent()], 100, pool);
    expect(result).toEqual({ applied: 1, skipped: 0 });

    const sample = db.public.one("SELECT total_sales FROM samples WHERE chain_id = 7");
    expect(sample.total_sales).toBe(1);

    const stats = await getPlatformStats(CONTRACT_ID, pool);
    expect(bi(stats.totalVolume)).toBe(1000n);
  });

  it("advances the cursor to the batch's end ledger only when the batch commits", async () => {
    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [licensedEvent()], 150, pool);
    expect(await getCursor(CONTRACT_ID, pool)).toBe(150);
  });

  it("propagates a constraint violation from a malformed event instead of swallowing it", async () => {
    // pg-mem does not actually implement transactional ROLLBACK — a
    // statement that ran before a later failure stays committed even after
    // catching the error and calling ROLLBACK (confirmed independently: a
    // plain BEGIN; INSERT; INSERT-violating-NOT-NULL; catch; ROLLBACK still
    // leaves the first INSERT's row in place under pg-mem). So this test
    // can only verify what pg-mem actually gets right here — that a
    // constraint violation propagates as a rejected promise rather than
    // being silently swallowed. The "nothing partially commits" guarantee
    // itself comes from standard Postgres BEGIN/COMMIT/ROLLBACK semantics
    // in applyEventBatchAndAdvanceCursor, which is well-established
    // behavior, not something pg-mem can be used to verify.
    const badBatch: DecodedEvent[] = [
      licensedEvent({ txHash: "tx-good" }),
      // @ts-expect-error deliberately invalid to force a DB-level error
      { ...licensedEvent({ txHash: "tx-bad" }), sampleId: null },
    ];

    await expect(
      applyEventBatchAndAdvanceCursor(CONTRACT_ID, badBatch, 200, pool),
    ).rejects.toThrow();
  });
});

interface FakeResponse {
  rowCount?: number;
  rows?: unknown[];
}

interface RecordedCall {
  sql: string;
  params: unknown[];
}

// Lets a test dictate exactly what each query returns by matching a SQL
// substring, rather than relying on any real (or emulated) database's
// conflict-detection fidelity. This is what actually exercises
// applyEventBatchAndAdvanceCursor's RETURNING-gated branches precisely.
function createFakeClient(overrides: Record<string, FakeResponse> = {}) {
  const calls: RecordedCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const [pattern, response] of Object.entries(overrides)) {
        if (sql.includes(pattern)) {
          return { rowCount: response.rowCount ?? 1, rows: response.rows ?? [] };
        }
      }
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

function createFakeDb(client: unknown): Pool {
  return { connect: async () => client as PoolClient } as unknown as Pool;
}

describe("applyEventBatchAndAdvanceCursor — concurrency-safe side effect gating (fake client)", () => {
  it("skips side effects when the contract_events insert returns no row (already applied)", async () => {
    const { client, calls } = createFakeClient({
      "INSERT INTO contract_events": { rowCount: 0 },
    });

    const result = await applyEventBatchAndAdvanceCursor(
      CONTRACT_ID,
      [licensedEvent()],
      100,
      createFakeDb(client),
    );

    expect(result).toEqual({ applied: 0, skipped: 1 });
    expect(calls.some((c) => c.sql.includes("UPDATE samples"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("INSERT INTO platform_stats"))).toBe(false);
  });

  it("applies side effects when the contract_events insert returns a new row", async () => {
    const { client, calls } = createFakeClient();

    const result = await applyEventBatchAndAdvanceCursor(
      CONTRACT_ID,
      [licensedEvent()],
      100,
      createFakeDb(client),
    );

    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(calls.some((c) => c.sql.includes("UPDATE samples"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("INSERT INTO platform_stats"))).toBe(true);
  });

  it("does not double-count a producer when the known_producers insert returns no row", async () => {
    const { client, calls } = createFakeClient({
      "INSERT INTO known_producers": { rowCount: 0 },
    });

    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [uploadedEvent()], 100, createFakeDb(client));

    const statsCall = calls.find((c) => c.sql.includes("INSERT INTO platform_stats"));
    expect(statsCall?.params[1]).toBe(0); // total_producers
  });

  it("counts a producer once when the known_producers insert returns a new row", async () => {
    const { client, calls } = createFakeClient();

    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [uploadedEvent()], 100, createFakeDb(client));

    const statsCall = calls.find((c) => c.sql.includes("INSERT INTO platform_stats"));
    expect(statsCall?.params[1]).toBe(1); // total_producers
  });

  it("warns instead of throwing when a licensed event's sample_id has no matching samples row", async () => {
    const { client } = createFakeClient({
      "UPDATE samples SET total_sales": { rowCount: 0 },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applyEventBatchAndAdvanceCursor(
      CONTRACT_ID,
      [licensedEvent({ sampleId: 999n })],
      100,
      createFakeDb(client),
    );

    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("999"));

    warnSpy.mockRestore();
  });
});
