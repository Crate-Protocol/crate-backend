import { Router } from "express";
const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, data: [], message: "Sample index from contract events" });
});

router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid sample id" });
  }
  res.json({ ok: true, data: { id, title: "Sample", genre: "Trap" } });
});

router.post("/metadata", (req, res) => {
  const { sampleId, title, genre, bpm, ipfsCid } = req.body;
  if (!sampleId || !ipfsCid) return res.status(400).json({ ok: false, error: "sampleId and ipfsCid required" });
  // Store metadata for fast search
  res.json({ ok: true, data: { sampleId, title, genre, bpm, ipfsCid } });
});

export { router as samplesRouter };
