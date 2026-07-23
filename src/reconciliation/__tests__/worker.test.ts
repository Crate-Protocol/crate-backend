import { describe, it, expect, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";
import { reconcileOnce } from "../worker.js";

let db: IMemoryDb;
let pool: any;

const CONFIG = { pollIntervalMs: 1, batchSize: 100 };

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE samples (
      id SERIAL PRIMARY KEY,
      chain_id BIGINT UNIQUE NOT NULL
    )
  `);
  db.public.none(`
    CREATE TABLE royalty_splits (
      id SERIAL PRIMARY KEY,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      version INTEGER NOT NULL,
      recipient TEXT NOT NULL,
      basis_points INTEGER NOT NULL,
      effective_from TIMESTAMPTZ NOT NULL
    )
  `);
  db.public.none(`
    CREATE TABLE payouts (
      id SERIAL PRIMARY KEY,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      sale_event_id TEXT NOT NULL UNIQUE,
      split_version INTEGER NOT NULL,
      total_amount BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'computed'
    )
  `);
  db.public.none(`
    CREATE TABLE payout_line_items (
      id SERIAL PRIMARY KEY,
      payout_id INTEGER NOT NULL REFERENCES payouts(id),
      recipient TEXT NOT NULL,
      amount BIGINT NOT NULL
    )
  `);
  db.public.none(`
    CREATE TABLE contract_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      sample_id BIGINT NOT NULL,
      payload JSONB NOT NULL,
      ledger_closed_at TIMESTAMPTZ NOT NULL
    )
  `);
  pool = new (db.adapters.createPg().Pool)();
});

function seedSample(chainId: number): number {
  const [{ id }] = db.public.many(
    `INSERT INTO samples (chain_id) VALUES (${chainId}) RETURNING id`,
  );
  return id;
}

function seedSplit(sampleId: number, recipient: string, bps: number, effectiveFrom: string) {
  db.public.none(
    `INSERT INTO royalty_splits (sample_id, version, recipient, basis_points, effective_from)
     VALUES (${sampleId}, 1, '${recipient}', ${bps}, '${effectiveFrom}')`,
  );
}

function seedEvent(sampleChainId: number, price: string, closedAt: string) {
  db.public.none(
    `INSERT INTO contract_events (event_type, sample_id, payload, ledger_closed_at)
     VALUES ('licensed', ${sampleChainId}, '${JSON.stringify({ buyer: "GBUYER", price })}', '${closedAt}')`,
  );
}

describe("reconcileOnce", () => {
  it("creates a payout with line items for a licensed event against a configured split", async () => {
    const sampleId = seedSample(1);
    seedSplit(sampleId, "GA", 6000, "2026-01-01T00:00:00Z");
    seedSplit(sampleId, "GB", 4000, "2026-01-01T00:00:00Z");
    seedEvent(1, "1000000", "2026-06-01T00:00:00Z");

    const result = await reconcileOnce(CONFIG, pool);
    expect(result).toEqual({ processed: 1, skippedNoSample: 0, skippedNoSplit: 0, failed: 0 });

    const payout = db.public.one("SELECT * FROM payouts");
    expect(payout.split_version).toBe(1);
    expect(BigInt(payout.total_amount)).toBe(1_000_000n);

    const items = db.public.many(`SELECT * FROM payout_line_items WHERE payout_id = ${payout.id}`);
    expect(items).toHaveLength(2);
    const byRecipient = Object.fromEntries(items.map((i: any) => [i.recipient, BigInt(i.amount)]));
    expect(byRecipient.GA).toBe(600_000n);
    expect(byRecipient.GB).toBe(400_000n);
  });

  it("skips an event whose sample metadata was never posted", async () => {
    seedEvent(999, "1000000", "2026-06-01T00:00:00Z"); // no matching samples row

    const result = await reconcileOnce(CONFIG, pool);
    expect(result).toEqual({ processed: 0, skippedNoSample: 1, skippedNoSplit: 0, failed: 0 });
    expect(db.public.many("SELECT * FROM payouts")).toHaveLength(0);
  });

  it("skips an event for a sample with no royalty split configured", async () => {
    seedSample(1);
    seedEvent(1, "1000000", "2026-06-01T00:00:00Z");

    const result = await reconcileOnce(CONFIG, pool);
    expect(result).toEqual({ processed: 0, skippedNoSample: 0, skippedNoSplit: 1, failed: 0 });
  });

  it("resolves against the split effective at the sale's ledger time, not a later one", async () => {
    const sampleId = seedSample(1);
    seedSplit(sampleId, "GOLD", 10000, "2026-01-01T00:00:00Z"); // v1, effective from Jan
    // A second split version is configured later, effective from Aug —
    // must not apply to a sale that happened in June.
    db.public.none(
      `INSERT INTO royalty_splits (sample_id, version, recipient, basis_points, effective_from)
       VALUES (${sampleId}, 2, 'GNEW', 10000, '2026-08-01T00:00:00Z')`,
    );
    seedEvent(1, "500000", "2026-06-01T00:00:00Z");

    await reconcileOnce(CONFIG, pool);

    const payout = db.public.one("SELECT * FROM payouts");
    expect(payout.split_version).toBe(1);
    const [item] = db.public.many(`SELECT * FROM payout_line_items WHERE payout_id = ${payout.id}`);
    expect(item.recipient).toBe("GOLD");
  });

  it("processes multiple events in one pass and is idempotent on a second pass", async () => {
    const sampleId = seedSample(1);
    seedSplit(sampleId, "GA", 10000, "2026-01-01T00:00:00Z");
    seedEvent(1, "100", "2026-06-01T00:00:00Z");
    seedEvent(1, "200", "2026-06-02T00:00:00Z");

    const first = await reconcileOnce(CONFIG, pool);
    expect(first.processed).toBe(2);

    const second = await reconcileOnce(CONFIG, pool);
    expect(second).toEqual({ processed: 0, skippedNoSample: 0, skippedNoSplit: 0, failed: 0 });
    expect(db.public.many("SELECT * FROM payouts")).toHaveLength(2);
  });

  it("does not let one failing event block the rest of the batch", async () => {
    const sampleId = seedSample(1);
    seedSplit(sampleId, "GA", 10000, "2026-01-01T00:00:00Z");
    // A malformed price (non-numeric) throws inside computeLineItems —
    // must not stop the second, valid event from still being processed.
    seedEvent(1, "not-a-number", "2026-06-01T00:00:00Z");
    seedEvent(1, "500", "2026-06-02T00:00:00Z");

    const result = await reconcileOnce(CONFIG, pool);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
    expect(db.public.many("SELECT * FROM payouts")).toHaveLength(1);
  });
});
