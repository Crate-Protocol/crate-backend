import { Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL   = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const TX_LIMIT      = parseInt(process.env.EARNINGS_TX_LIMIT ?? "20", 10);

const server = new Horizon.Server(HORIZON_URL);

export async function getStats() {
  // In production: query Soroban RPC get_stats
  return { totalSamples: 0, totalVolume: "0", totalProducers: 0 };
}

export async function getEarningsHistory(address: string) {
  const txs = await server.transactions().forAccount(address).limit(20).order("desc").call();
  return txs.records.map(tx => ({
    id:        tx.id,
    createdAt: tx.created_at,
    successful: tx.successful,
  }));
}

export async function getAccountBalance(address: string): Promise<string> {
  const account = await server.loadAccount(address);
  const native  = account.balances.find(b => b.asset_type === "native");
  return native?.balance ?? "0";
}
