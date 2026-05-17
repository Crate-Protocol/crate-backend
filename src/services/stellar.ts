/**
 * stellar.ts
 * ──────────
 * Horizon queries and event streaming for the Sampled contract.
 */

import { Horizon } from "@stellar/stellar-sdk";

const NETWORK = (process.env.STELLAR_NETWORK ?? "testnet").toLowerCase();
const CONTRACT_ID =
  process.env.CONTRACT_ID ??
  "CA7DGEWWS3VH5J2I4I7FFEB5UHK2MJSYWDKDQKXQM7GDNLI2IRATDTLG";

const HORIZON_URL =
  NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(HORIZON_URL);
}

export interface ContractTransaction {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  feePaid: string;
}

/**
 * Fetch recent transactions for the contract account.
 */
export async function getContractTransactions(
  limit = 20
): Promise<ContractTransaction[]> {
  const server = getHorizonServer();
  try {
    const result = await server
      .transactions()
      .forAccount(CONTRACT_ID)
      .order("desc")
      .limit(limit)
      .call();

    return result.records.map((tx) => ({
      hash: tx.hash,
      ledger: tx.ledger_attr,
      createdAt: tx.created_at,
      sourceAccount: tx.source_account,
      feePaid: tx.fee_charged,
    }));
  } catch (err) {
    // Contract account may not have transactions yet
    console.warn("[stellar] getContractTransactions:", err);
    return [];
  }
}

/**
 * Get the XLM balance held by the contract (funds awaiting withdrawal).
 */
export async function getContractXlmBalance(): Promise<string> {
  const server = getHorizonServer();
  try {
    const account = await server.loadAccount(CONTRACT_ID);
    const nativeBalance = account.balances.find((b) => b.asset_type === "native");
    return nativeBalance?.balance ?? "0";
  } catch {
    return "0";
  }
}

/**
 * Get the XLM balance for any Stellar address.
 */
export async function getAddressBalance(address: string): Promise<string> {
  const server = getHorizonServer();
  try {
    const account = await server.loadAccount(address);
    const nativeBalance = account.balances.find((b) => b.asset_type === "native");
    return nativeBalance?.balance ?? "0";
  } catch {
    return "0";
  }
}

/**
 * Stream new transactions for the contract in real-time.
 * Calls onTransaction for each new event.
 */
export function streamContractTransactions(
  onTransaction: (tx: ContractTransaction) => void
): () => void {
  const server = getHorizonServer();
  const close = server
    .transactions()
    .forAccount(CONTRACT_ID)
    .cursor("now")
    .stream({
      onmessage: (tx) => {
        onTransaction({
          hash: tx.hash,
          ledger: tx.ledger_attr,
          createdAt: tx.created_at,
          sourceAccount: tx.source_account,
          feePaid: tx.fee_charged,
        });
      },
      onerror: (err) => {
        console.error("[stellar] stream error:", err);
      },
    });

  // Return cleanup function
  return close as unknown as () => void;
}
