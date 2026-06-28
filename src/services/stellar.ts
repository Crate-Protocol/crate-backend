import { Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL   = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const TX_LIMIT      = Math.min(200, Math.max(1, parseInt(process.env.EARNINGS_TX_LIMIT ?? "20", 10)));

const server = new Horizon.Server(HORIZON_URL, { timeout: 10_000 } as any);

export async function getStats() {
  // In production: query Soroban RPC get_stats
  return { totalSamples: 0, totalVolume: "0", totalProducers: 0 };
}

export const STELLAR_ADDR_RE = /^G[A-Z2-7]{55}$/;

export async function getEarningsHistory(address: string) {
  if (!STELLAR_ADDR_RE.test(address)) {
    throw new Error(`Invalid Stellar address: ${address}`);
  }
  try {
    const txs = await server.transactions().forAccount(address).limit(TX_LIMIT).order("desc").call();
    if (!txs.records) return [];
    return txs.records.map(tx => ({
      id:         tx.id,
      createdAt:  tx.created_at,
      successful: tx.successful,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Horizon query failed: ${msg}`);
  }
}

export async function getAccountBalance(address: string): Promise<string> {
  if (!STELLAR_ADDR_RE.test(address)) {
    throw new Error(`Invalid Stellar address: ${address}`);
  }
  try {
    const account = await server.loadAccount(address);
    const native  = account.balances.find(b => b.asset_type === "native");
    return native?.balance ?? "0";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load account: ${msg}`);
  }
}
