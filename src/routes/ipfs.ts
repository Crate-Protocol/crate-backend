/**
 * routes/ipfs.ts
 * ───────────────
 * POST /upload — Proxy file upload to Pinata IPFS.
 * Accepts multipart/form-data with field "file" (audio file).
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { uploadFileToPinata, testPinataConnection } from "../services/ipfs.js";

const router = Router();

// Use memory storage — no disk writes needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
  },
  fileFilter: (_req, file, cb) => {
    const AUDIO_TYPES = [
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/flac",
      "audio/aiff",
      "audio/x-aiff",
      "audio/mp3",
    ];
    if (
      AUDIO_TYPES.includes(file.mimetype) ||
      /\.(mp3|wav|ogg|flac|aif|aiff)$/i.test(file.originalname)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (mp3, wav, flac, aiff, ogg)"));
    }
  },
});

/**
 * POST /upload
 * Form fields:
 *   file — audio file
 *   title — optional, used as Pinata metadata name
 *   uploader — optional, Stellar address of producer
 */
router.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const { title, uploader } = req.body as {
      title?: string;
      uploader?: string;
    };

    try {
      const metadata: Record<string, string> = {};
      if (title) metadata.title = title;
      if (uploader) metadata.uploader = uploader;

      const result = await uploadFileToPinata(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        metadata
      );

      res.json({
        cid: result.cid,
        url: result.url,
        size: result.size,
        filename: req.file.originalname,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      console.error("[ipfs route]", err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /upload/health
 * Check Pinata connectivity.
 */
router.get("/health", async (_req: Request, res: Response) => {
  const ok = await testPinataConnection();
  res.json({
    pinata: ok ? "connected" : "unavailable",
    configured: !!process.env.PINATA_JWT,
  });
});

export default router;
