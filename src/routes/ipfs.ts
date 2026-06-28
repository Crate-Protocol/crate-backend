import { Router } from "express";
import multer    from "multer";
import { uploadToIPFS } from "../services/ipfs.js";
import { withTimeout } from "../utils/timeout.js";

const ALLOWED_MIMES  = new Set(["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4"]);
const MAX_FILE_BYTES = parseInt(process.env.IPFS_MAX_FILE_MB ?? "100", 10) * 1024 * 1024;

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file provided" });
  if (!ALLOWED_MIMES.has(req.file.mimetype)) {
    return res.status(415).json({ ok: false, error: `Unsupported file type: ${req.file.mimetype}` });
  }
  const file = req.file;
  try {
    const result = await withTimeout(() => uploadToIPFS(file.buffer, file.originalname), 30_000);
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof Error && err.message === "TimeoutError") {
      return res.status(503).json({ ok: false, error: "Service unavailable: request timed out" });
    }
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

export { router as ipfsRouter };
