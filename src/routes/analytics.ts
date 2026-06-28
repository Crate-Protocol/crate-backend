import { Router }        from "express";
import { getStats, getEarningsHistory, getAccountBalance, STELLAR_ADDR_RE } from "../services/stellar.js";
import { withTimeout }    from "../utils/timeout.js";

const router = Router();

router.get("/stats", async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({ ok: true, data: stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

router.get("/earnings/:address", async (req, res) => {
  const { address } = req.params;
  if (!STELLAR_ADDR_RE.test(address)) {
    return res.status(400).json({ ok: false, error: "Invalid Stellar address" });
  }
  try {
    const history = await withTimeout(() => getEarningsHistory(address), 10_000);
    res.json({ ok: true, data: history });
  } catch (err) {
    if (err instanceof Error && err.message === "TimeoutError") {
      return res.status(503).json({ ok: false, error: "Service unavailable: request timed out" });
    }
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

router.get("/balance/:address", async (req, res) => {
  const { address } = req.params;
  if (!STELLAR_ADDR_RE.test(address)) {
    return res.status(400).json({ ok: false, error: "Invalid Stellar address" });
  }
  try {
    const balance = await withTimeout(() => getAccountBalance(address), 10_000);
    res.json({ ok: true, data: { address, balance } });
  } catch (err) {
    if (err instanceof Error && err.message === "TimeoutError") {
      return res.status(503).json({ ok: false, error: "Service unavailable: request timed out" });
    }
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

export { router as analyticsRouter };
