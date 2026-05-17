/**
 * routes/analytics.ts
 * ─────────────────────
 * GET /analytics/stats         — platform-wide stats
 * GET /analytics/earnings/:address — producer-specific stats
 */

import { Router, Request, Response } from "express";
import {
  getContractTransactions,
  getContractXlmBalance,
  getAddressBalance,
} from "../services/stellar.js";

const router = Router();

/**
 * GET /analytics/stats
 * Returns platform-wide stats from Horizon + contract.
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const [transactions, contractBalance] = await Promise.all([
      getContractTransactions(50),
      getContractXlmBalance(),
    ]);

    const totalTxCount = transactions.length;
    const uniqueAccounts = new Set(transactions.map((tx) => tx.sourceAccount)).size;

    res.json({
      contractId: process.env.CONTRACT_ID ?? "CA7DGEWWS3VH5J2I4I7FFEB5UHK2MJSYWDKDQKXQM7GDNLI2IRATDTLG",
      network: process.env.STELLAR_NETWORK ?? "testnet",
      contractBalanceXlm: contractBalance,
      recentTransactionCount: totalTxCount,
      uniqueParticipants: uniqueAccounts,
      revenueShare: { producer: 90, platform: 10 },
      settlementTimeSeconds: 5,
    });
  } catch (err) {
    console.error("[analytics/stats]", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * GET /analytics/earnings/:address
 * Returns the XLM balance and recent transactions for a producer address.
 */
router.get("/earnings/:address", async (req: Request, res: Response) => {
  const { address } = req.params;

  if (!address || !/^G[A-Z2-7]{55}$/.test(address)) {
    res.status(400).json({ error: "Invalid Stellar address" });
    return;
  }

  try {
    const [balance, transactions] = await Promise.all([
      getAddressBalance(address),
      getContractTransactions(20),
    ]);

    // Filter transactions where this address was the source
    const addressTxs = transactions.filter(
      (tx) => tx.sourceAccount === address
    );

    res.json({
      address,
      balanceXlm: balance,
      recentTransactionCount: addressTxs.length,
      recentTransactions: addressTxs.slice(0, 10),
    });
  } catch (err) {
    console.error("[analytics/earnings]", err);
    res.status(500).json({ error: "Failed to fetch earnings data" });
  }
});

/**
 * GET /analytics/transactions
 * Recent contract transactions.
 */
router.get("/transactions", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
  try {
    const txs = await getContractTransactions(limit);
    res.json({ transactions: txs, count: txs.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
