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
  const { sampleId, title, genre, bpm, ipfsCid } = req.body as Record<string, unknown>;
  if (!sampleId || !ipfsCid) return res.status(400).json({ ok: false, error: "sampleId and ipfsCid required" });
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ ok: false, error: "title must be a non-empty string" });
  }
  if (typeof genre !== "string" || !genre.trim()) {
    return res.status(400).json({ ok: false, error: "genre must be a non-empty string" });
  }
  const bpmNum = typeof bpm === "number" ? bpm : parseInt(String(bpm), 10);
  if (!Number.isInteger(bpmNum) || bpmNum <= 0) {
    return res.status(400).json({ ok: false, error: "bpm must be a positive integer" });
  }
  res.json({ ok: true, data: { sampleId, title, genre, bpm, ipfsCid } });
});

export { router as samplesRouter };
