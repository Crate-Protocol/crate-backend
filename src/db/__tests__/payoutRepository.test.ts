import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";
import type { Pool, PoolClient } from "pg";
import { createPayout } from "../payoutRepository.js";

let db: IMemoryDb;
let pool: any;

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE samples (
      id SERIAL PRIMARY KEY,
      chain_id BIGINT UNIQUE NOT NULL
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
  db.public.none(`INSERT INTO samples (id, chain_id) VALUES (1, 1)`);
  pool = new (db.adapters.createPg().Pool)();
});

describe("createPayout — plain-insert path (pg-mem)", () => {
  it("creates a payout with its line items and reports created: true", async () => {
    const result = await createPayout(
      1,
      "sale-1",
      1,
      1000n,
      [{ recipient: "GA", amount: 1000n }],
      pool,
    );
    expect(result.created).toBe(true);

    const items = db.public.many(`SELECT * FROM payout_line_items WHERE payout_id = ${result.payoutId}`);
    expect(items).toHaveLength(1);
  });
});

// pg-mem reports rowCount: 1 for INSERT ... ON CONFLICT DO NOTHING RETURNING
// even when the row wasn't actually inserted — the same limitation already
// documented in indexerRepository.test.ts for the identical pattern. So the
// conflict branch here is tested the same way that file tests it: against a
// hand-controlled fake client where the mocked response is exact, not
// against pg-mem's approximation of it.
interface MockResponse {
  rowCount?: number;
  rows?: unknown[];
}

interface RecordedCall {
  sql: string;
  params: unknown[];
}

function createFakeClient(responses: Record<string, MockResponse> = {}) {
  const calls: RecordedCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const [key, response] of Object.entries(responses)) {
        if (sql.includes(key)) {
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

describe("createPayout — conflict branch (fake client)", () => {
  it("fetches the existing payout instead of inserting when the insert returns no row", async () => {
    const { client } = createFakeClient({
      "INSERT INTO payouts": { rowCount: 0, rows: [] },
      "SELECT id FROM payouts": { rows: [{ id: 42 }] },
    });

    const result = await createPayout(1, "sale-2", 1, 1000n, [{ recipient: "GA", amount: 1000n }], createFakeDb(client));

    expect(result).toEqual({ payoutId: 42, created: false });
  });

  it("does not insert line items when the payout insert conflicted", async () => {
    const { client, calls } = createFakeClient({
      "INSERT INTO payouts": { rowCount: 0, rows: [] },
      "SELECT id FROM payouts": { rows: [{ id: 42 }] },
    });

    await createPayout(1, "sale-3", 1, 1000n, [{ recipient: "GA", amount: 1000n }], createFakeDb(client));

    expect(calls.some((c) => c.sql.includes("INSERT INTO payout_line_items"))).toBe(false);
  });

  it("inserts line items when the payout insert actually landed", async () => {
    const { client, calls } = createFakeClient({
      "INSERT INTO payouts": { rowCount: 1, rows: [{ id: 7 }] },
    });

    const result = await createPayout(
      1,
      "sale-4",
      1,
      1000n,
      [{ recipient: "GA", amount: 600n }, { recipient: "GB", amount: 400n }],
      createFakeDb(client),
    );

    expect(result).toEqual({ payoutId: 7, created: true });
    expect(calls.filter((c) => c.sql.includes("INSERT INTO payout_line_items"))).toHaveLength(2);
  });
});
