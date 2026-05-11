import { Router }        from "express";
import { getStats, getEarningsHistory } from "../services/stellar";

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
  try {
    const history = await getEarningsHistory(req.params.address);
    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

export { router as analyticsRouter };
