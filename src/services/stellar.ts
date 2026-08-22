import { Horizon } from "@stellar/stellar-sdk";
import { getPlatformStats } from "../db/indexerRepository.js";
import { getSalesBySeller, getTotalEarnings } from "../db/salesRepository.js";

const HORIZON_URL   = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const TX_LIMIT      = Math.min(200, Math.max(1, parseInt(process.env.EARNINGS_TX_LIMIT ?? "20", 10)));
const CONTRACT_ID   = process.env.CONTRACT_ID ?? "";

const server = new Horizon.Server(HORIZON_URL, { timeout: 10_000 } as any);

export async function getStats() {
  // Backed by platform_stats, kept up to date by the indexer worker
  // (src/indexer) from real "uploaded"/"licensed" contract events — not a
  // live contract call, and not client-submitted values.
  const stats = await getPlatformStats(CONTRACT_ID);
  return {
    totalSamples: stats.totalSamples,
    totalVolume: stats.totalVolume.toString(),
    totalProducers: stats.totalProducers,
  };
}

export const STELLAR_ADDR_RE = /^G[A-Z2-7]{55}$/;

export async function getEarningsHistory(address: string) {
  if (!STELLAR_ADDR_RE.test(address)) {
    throw new Error(`Invalid Stellar address: ${address}`);
  }
  const sales = await getSalesBySeller(address, TX_LIMIT);
  return sales.map(sale => ({
    id: sale.tx_hash,
    createdAt: sale.occurred_at.toISOString(),
    successful: true,
    sampleId: sale.sample_id.toString(),
    amount: sale.amount.toString(),
    tier: sale.tier,
  }));
}

export async function getSalesByAddress(address: string, limit: number = TX_LIMIT) {
  if (!STELLAR_ADDR_RE.test(address)) {
    throw new Error(`Invalid Stellar address: ${address}`);
  }
  const sales = await getSalesBySeller(address, limit);
  return {
    totalEarnings: (await getTotalEarnings(address)).toString(),
    sales: sales.map(s => ({
      txHash: s.tx_hash,
      sampleId: s.sample_id.toString(),
      buyer: s.buyer,
      tier: s.tier,
      amount: s.amount.toString(),
      token: s.token,
      ledger: s.ledger.toString(),
      occurredAt: s.occurred_at.toISOString(),
    })),
  };
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
