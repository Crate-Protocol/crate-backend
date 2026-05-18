import { Router }        from "express";
import { getStats, getEarningsHistory } from "../services/stellar";

const router = Router();

router.get("/stats", async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({ ok: true, data: stats });
  } catch { res.json({ ok: true, data: { totalSamples: 0, totalVolume: "0", totalProducers: 0 } }); }
});

router.get("/earnings/:address", async (req, res) => {
  try {
    const history = await getEarningsHistory(req.params.address);
    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export { router as analyticsRouter };
