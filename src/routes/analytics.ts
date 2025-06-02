import { Router }        from "express";
import { getStats, getEarningsHistory, STELLAR_ADDR_RE } from "../services/stellar";

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
    const history = await getEarningsHistory(address);
    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

export { router as analyticsRouter };
