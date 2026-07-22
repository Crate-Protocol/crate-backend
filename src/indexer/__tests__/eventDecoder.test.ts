import { describe, it, expect } from "vitest";
import { Keypair, Address, nativeToScVal } from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import { decodeEvent, decodeEvents } from "../eventDecoder.js";

function fakeEvent(opts: {
  ledger?: number;
  txHash?: string;
  eventName: string;
  sampleId: number;
  value: ReturnType<typeof nativeToScVal>;
}): rpc.Api.EventResponse {
  return {
    id: "fake-event-id",
    type: "contract",
    ledger: opts.ledger ?? 100,
    ledgerClosedAt: "2024-01-01T00:00:00Z",
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: opts.txHash ?? "tx1",
    contractId: undefined,
    topic: [
      nativeToScVal(opts.eventName, { type: "symbol" }),
      nativeToScVal(opts.sampleId, { type: "u32" }),
    ],
    value: opts.value,
  } as rpc.Api.EventResponse;
}

const uploader = Keypair.random().publicKey();
const buyer = Keypair.random().publicKey();

describe("decodeEvent", () => {
  it("decodes an uploaded event", () => {
    const event = fakeEvent({
      eventName: "uploaded",
      sampleId: 7,
      value: nativeToScVal(Address.fromString(uploader), { type: "address" }),
    });

    const decoded = decodeEvent(event, 0);
    expect(decoded).toEqual({
      contractId: "",
      ledger: 100,
      txHash: "tx1",
      eventIndex: 0,
      ledgerClosedAt: "2024-01-01T00:00:00Z",
      sampleId: 7n,
      eventType: "uploaded",
      uploader,
    });
  });

  it("decodes a licensed event", () => {
    const price = 123456789012345n;
    const event = fakeEvent({
      eventName: "licensed",
      sampleId: 7,
      value: nativeToScVal([Address.fromString(buyer), price], {
        type: ["address", "i128"],
      }),
    });

    const decoded = decodeEvent(event, 0);
    expect(decoded).toEqual({
      contractId: "",
      ledger: 100,
      txHash: "tx1",
      eventIndex: 0,
      ledgerClosedAt: "2024-01-01T00:00:00Z",
      sampleId: 7n,
      eventType: "licensed",
      buyer,
      price,
    });
  });

  it("returns null for an event topic it doesn't recognize", () => {
    const event = fakeEvent({
      eventName: "something_else",
      sampleId: 7,
      value: nativeToScVal(Address.fromString(uploader), { type: "address" }),
    });
    expect(decodeEvent(event, 0)).toBeNull();
  });

  it("returns null when topic has fewer than 2 entries", () => {
    const event = fakeEvent({
      eventName: "uploaded",
      sampleId: 7,
      value: nativeToScVal(Address.fromString(uploader), { type: "address" }),
    });
    event.topic = [event.topic[0]!];
    expect(decodeEvent(event, 0)).toBeNull();
  });

  it("returns null for a licensed event whose value isn't the expected [address, i128] shape", () => {
    const event = fakeEvent({
      eventName: "licensed",
      sampleId: 7,
      value: nativeToScVal(Address.fromString(buyer), { type: "address" }), // malformed: missing price
    });
    expect(decodeEvent(event, 0)).toBeNull();
  });
});

describe("decodeEvents", () => {
  it("assigns event_index per (ledger, txHash) group, resetting for each new group", () => {
    const events = [
      fakeEvent({ ledger: 100, txHash: "txA", eventName: "uploaded", sampleId: 1, value: nativeToScVal(Address.fromString(uploader), { type: "address" }) }),
      fakeEvent({ ledger: 100, txHash: "txA", eventName: "uploaded", sampleId: 2, value: nativeToScVal(Address.fromString(uploader), { type: "address" }) }),
      fakeEvent({ ledger: 100, txHash: "txB", eventName: "uploaded", sampleId: 3, value: nativeToScVal(Address.fromString(uploader), { type: "address" }) }),
      fakeEvent({ ledger: 101, txHash: "txA", eventName: "uploaded", sampleId: 4, value: nativeToScVal(Address.fromString(uploader), { type: "address" }) }),
    ];

    const decoded = decodeEvents(events);
    expect(decoded.map((e) => e.eventIndex)).toEqual([0, 1, 0, 0]);
    expect(decoded.map((e) => e.sampleId)).toEqual([1n, 2n, 3n, 4n]);
  });

  it("skips events it can't decode instead of throwing", () => {
    const good = fakeEvent({ eventName: "uploaded", sampleId: 1, value: nativeToScVal(Address.fromString(uploader), { type: "address" }) });
    const bad = fakeEvent({ eventName: "unknown_event", sampleId: 2, value: nativeToScVal(Address.fromString(uploader), { type: "address" }) });

    const decoded = decodeEvents([good, bad]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.sampleId).toBe(1n);
  });
});
