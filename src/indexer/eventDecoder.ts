import { rpc, scValToNative } from "@stellar/stellar-sdk";
import type { DecodedEvent } from "./types.js";

/**
 * Decodes one raw Soroban event into a DecodedEvent, or returns null for an
 * event type this indexer doesn't know about (defensive against the contract
 * emitting something new later — skip it rather than crash the worker).
 *
 * eventIndex is assigned by the caller: it's this event's position among
 * events sharing the same (ledger, txHash) within a getEvents response, not
 * something the RPC gives us directly. See the comment on contract_events in
 * db/migrations/0004_create_indexer_tables.sql for why.
 */
export function decodeEvent(
  event: rpc.Api.EventResponse,
  eventIndex: number,
): DecodedEvent | null {
  if (event.topic.length < 2) return null;

  const eventName = scValToNative(event.topic[0]!);
  const sampleId = scValToNative(event.topic[1]!);

  if (typeof eventName !== "string" || typeof sampleId !== "number") {
    return null;
  }

  const base = {
    contractId: event.contractId?.toString() ?? "",
    ledger: event.ledger,
    txHash: event.txHash,
    eventIndex,
    ledgerClosedAt: event.ledgerClosedAt,
    sampleId: BigInt(sampleId),
  };

  if (eventName === "uploaded") {
    const uploader = scValToNative(event.value);
    if (typeof uploader !== "string") return null;
    return { ...base, eventType: "uploaded", uploader };
  }

  if (eventName === "licensed") {
    const decoded = scValToNative(event.value);
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [buyer, price] = decoded;
    if (typeof buyer !== "string" || typeof price !== "bigint") return null;
    return { ...base, eventType: "licensed", buyer, price };
  }

  return null;
}

/**
 * Assigns eventIndex per event: position within its (ledger, txHash) group,
 * in the order the RPC returned them. Stable and reproducible on replay —
 * getEvents returns events in execution order, so re-fetching the same
 * range and re-decoding always assigns the same indices.
 */
export function decodeEvents(events: rpc.Api.EventResponse[]): DecodedEvent[] {
  const seenInGroup = new Map<string, number>();
  const decoded: DecodedEvent[] = [];

  for (const event of events) {
    const groupKey = `${event.ledger}:${event.txHash}`;
    const eventIndex = seenInGroup.get(groupKey) ?? 0;
    seenInGroup.set(groupKey, eventIndex + 1);

    const result = decodeEvent(event, eventIndex);
    if (result) decoded.push(result);
  }

  return decoded;
}
