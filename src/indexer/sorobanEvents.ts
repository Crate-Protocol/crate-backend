import { rpc } from "@stellar/stellar-sdk";

const DEFAULT_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_MAINNET_RPC_URL = "https://mainnet.sorobanrpc.com";

const RPC_URL =
  process.env.STELLAR_RPC_URL ??
  (process.env.STELLAR_NETWORK === "mainnet"
    ? DEFAULT_MAINNET_RPC_URL
    : DEFAULT_TESTNET_RPC_URL);

const server = new rpc.Server(RPC_URL);

export async function getLatestLedger(): Promise<number> {
  const response = await server.getLatestLedger();
  return response.sequence;
}

/**
 * Fetches every "contract" event for contractId within [startLedger, endLedger]
 * (inclusive), paging through with the RPC's cursor when a single response
 * doesn't cover the whole range (i.e. hits pageLimit). Bounding by endLedger
 * rather than relying on limit/truncation alone means the caller always
 * knows exactly how far it's actually scanned once this returns.
 */
export async function fetchEventsInRange(
  contractId: string,
  startLedger: number,
  endLedger: number,
  pageLimit: number,
): Promise<rpc.Api.EventResponse[]> {
  const events: rpc.Api.EventResponse[] = [];
  let cursor: string | undefined;

  for (;;) {
    const request: rpc.Api.GetEventsRequest = cursor
      ? {
          filters: [{ type: "contract", contractIds: [contractId] }],
          cursor,
          limit: pageLimit,
        }
      : {
          filters: [{ type: "contract", contractIds: [contractId] }],
          startLedger,
          endLedger,
          limit: pageLimit,
        };

    const response = await server.getEvents(request);
    events.push(...response.events);

    if (response.events.length < pageLimit) break;
    cursor = response.cursor;
  }

  return events;
}
