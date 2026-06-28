import { Router } from "express";
import multer    from "multer";
import { uploadToIPFS } from "../services/ipfs.js";
import { withTimeout } from "../utils/timeout.js";
import { requireProducerAuth } from "../middleware/auth.js";
import rateLimit from "express-rate-limit";
import { checkAndIncrementQuota } from "../db/uploadQuotaRepository.js";

const ALLOWED_MIMES  = new Set(["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4"]);
const MAX_FILE_BYTES = parseInt(process.env.IPFS_MAX_FILE_MB ?? "100", 10) * 1024 * 1024;

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: parseInt(process.env.IPFS_IP_RATE_LIMIT ?? "20", 10), // Limit each IP to 20 upload requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many upload requests from this IP, please try again after an hour" },
});

router.post("/upload", uploadRateLimiter, requireProducerAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file provided" });
  if (!ALLOWED_MIMES.has(req.file.mimetype)) {
    return res.status(415).json({ ok: false, error: `Unsupported file type: ${req.file.mimetype}` });
  }
  const file = req.file;

  const accountId = (req as any).user?.id;
  if (accountId) {
    const withinQuota = await checkAndIncrementQuota(accountId);
    if (!withinQuota) {
      return res.status(429).json({ ok: false, error: "Daily upload quota exceeded for this account" });
    }
  }

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
