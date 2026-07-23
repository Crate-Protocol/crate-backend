import { describe, it, expect, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { IMemoryDb } from "pg-mem";
import { findUnreconciledLicensedEvents } from "../reconciliationRepository.js";

let db: IMemoryDb;
let pool: any;

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE payouts (
      id SERIAL PRIMARY KEY,
      sale_event_id TEXT NOT NULL UNIQUE
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

function insertEvent(eventType: string, sampleId: number, payload: object, closedAt = "2026-01-01T00:00:00Z") {
  db.public.none(
    `INSERT INTO contract_events (event_type, sample_id, payload, ledger_closed_at)
     VALUES ('${eventType}', ${sampleId}, '${JSON.stringify(payload)}', '${closedAt}')`,
  );
}

describe("findUnreconciledLicensedEvents", () => {
  it("returns a licensed event with no payout yet", async () => {
    insertEvent("licensed", 7, { buyer: "GBUYER", price: "5000000" });

    const pending = await findUnreconciledLicensedEvents(10, pool);
    expect(pending).toHaveLength(1);
    expect(pending[0].sampleChainId).toBe(7n);
    expect(pending[0].payload.price).toBe("5000000");
    expect(pending[0].payload.buyer).toBe("GBUYER");
  });

  it("ignores uploaded events, only licensed ones are sales", async () => {
    insertEvent("uploaded", 7, { uploader: "GUPLOADER" });

    const pending = await findUnreconciledLicensedEvents(10, pool);
    expect(pending).toHaveLength(0);
  });

  it("excludes a licensed event that already has a payout", async () => {
    insertEvent("licensed", 7, { buyer: "GBUYER", price: "1000" });
    const [{ id: eventId }] = db.public.many("SELECT id FROM contract_events");
    db.public.none(`INSERT INTO payouts (sale_event_id) VALUES ('${eventId}')`);

    const pending = await findUnreconciledLicensedEvents(10, pool);
    expect(pending).toHaveLength(0);
  });

  it("returns events oldest-first", async () => {
    insertEvent("licensed", 1, { buyer: "GA", price: "100" });
    insertEvent("licensed", 2, { buyer: "GB", price: "200" });

    const pending = await findUnreconciledLicensedEvents(10, pool);
    expect(pending.map((p) => p.sampleChainId)).toEqual([1n, 2n]);
  });

  it("respects the limit", async () => {
    insertEvent("licensed", 1, { buyer: "GA", price: "100" });
    insertEvent("licensed", 2, { buyer: "GB", price: "200" });

    const pending = await findUnreconciledLicensedEvents(1, pool);
    expect(pending).toHaveLength(1);
  });
});
