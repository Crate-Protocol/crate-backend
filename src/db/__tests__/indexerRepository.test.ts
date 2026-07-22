import { describe, it, expect, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";
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

describe("applyEventBatchAndAdvanceCursor — idempotency", () => {
  it("applying a licensed event once bumps total_sales and total_volume", async () => {
    const result = await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [licensedEvent()], 100, pool);
    expect(result).toEqual({ applied: 1, skipped: 0 });

    const sample = db.public.one("SELECT total_sales FROM samples WHERE chain_id = 7");
    expect(sample.total_sales).toBe(1);

    const stats = await getPlatformStats(CONTRACT_ID, pool);
    expect(bi(stats.totalVolume)).toBe(1000n);
  });

  it("replaying the exact same event does not double-count", async () => {
    const event = licensedEvent();
    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [event], 100, pool);
    const second = await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [event], 100, pool);

    expect(second).toEqual({ applied: 0, skipped: 1 });

    const sample = db.public.one("SELECT total_sales FROM samples WHERE chain_id = 7");
    expect(sample.total_sales).toBe(1); // not 2

    const stats = await getPlatformStats(CONTRACT_ID, pool);
    expect(bi(stats.totalVolume)).toBe(1000n); // not 2000n
  });

  it("replaying a batch that mixes already-applied and new events only applies the new ones", async () => {
    const first = licensedEvent({ eventIndex: 0 });
    const second = licensedEvent({ eventIndex: 1, txHash: "tx3" });

    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [first], 100, pool);
    // Replay first alongside a genuinely new second event, as would happen
    // if a poll cycle re-fetches part of an already-processed window.
    const result = await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [first, second], 100, pool);

    expect(result).toEqual({ applied: 1, skipped: 1 });
    const stats = await getPlatformStats(CONTRACT_ID, pool);
    expect(bi(stats.totalVolume)).toBe(2000n); // first counted once, second counted once
  });

  it("only counts a producer toward total_producers the first time they're seen", async () => {
    const first = uploadedEvent({ txHash: "tx1", uploader: "GSAME" });
    const second = uploadedEvent({ ledger: 101, txHash: "tx4", uploader: "GSAME", sampleId: 8n });
    db.public.none(`INSERT INTO samples (chain_id, total_sales) VALUES (8, 0)`);

    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [first], 100, pool);
    await applyEventBatchAndAdvanceCursor(CONTRACT_ID, [second], 101, pool);

    const stats = await getPlatformStats(CONTRACT_ID, pool);
    expect(stats.totalSamples).toBe(2);
    expect(stats.totalProducers).toBe(1); // same uploader both times
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
