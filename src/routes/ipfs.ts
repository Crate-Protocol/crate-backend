import { Router, Request, Response } from "express";
import Busboy from "busboy";
import { Readable } from "node:stream";
import { uploadToIPFS } from "../services/ipfs.js";
import { requireProducerAuth } from "../middleware/auth.js";
import rateLimit from "express-rate-limit";
import { checkAndIncrementQuota } from "../db/uploadQuotaRepository.js";
import { enforceStreamSize, destroyStreams } from "../utils/streamUtils.js";

const ALLOWED_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp4",
]);
const MAX_FILE_BYTES =
  parseInt(process.env.IPFS_MAX_FILE_MB ?? "100", 10) * 1024 * 1024;

const router = Router();

router.post("/upload", requireProducerAuth, async (req: Request, res: Response) => {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return res
      .status(400)
      .json({ ok: false, error: "Content-Type must be multipart/form-data" });
  }

  const accountId = (req as any).user?.id;
  if (accountId) {
    const withinQuota = await checkAndIncrementQuota(accountId);
    if (!withinQuota) {
      return res.status(429).json({ ok: false, error: "Daily upload quota exceeded for this account" });
    }
  }

  let fileStream: Readable | null = null;
  let filename = "";
  let mimetype = "";
  let uploadCompleted = false;

  const busboy = Busboy({
    headers: req.headers as Record<string, string>,
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  });

  // Handle client disconnect
  req.on("close", () => {
    if (!uploadCompleted) {
      destroyStreams(fileStream);
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      busboy.on("file", (fieldname, file, info) => {
        const { filename: fname, mimeType } = info;

        if (!ALLOWED_MIMES.has(mimeType)) {
          file.resume(); // drain the stream
          reject(new Error(`Unsupported file type: ${mimeType}`));
          return;
        }

        filename = fname;
        mimetype = mimeType;

        // Enforce file size at the stream level
        fileStream = enforceStreamSize(file, MAX_FILE_BYTES);

        fileStream.on("error", (err) => {
          if (err.name === "FileSizeExceeded") {
            reject(new Error(`File size exceeds maximum of ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB`));
          } else {
            reject(err);
          }
        });
      });

      busboy.on("error", (err) => reject(err));

      busboy.on("finish", () => {
        if (!fileStream) {
          reject(new Error("No file provided"));
          return;
        }
        resolve();
      });

      // Pipe the request into busboy
      req.pipe(busboy);
    });

    // Upload the stream directly to Pinata
    const result = await uploadToIPFS(fileStream!, filename);
    uploadCompleted = true;
    res.json({ ok: true, data: result });
  } catch (err) {
    destroyStreams(fileStream);

    if (err instanceof Error) {
      if (err.message === "No file provided") {
        return res.status(400).json({ ok: false, error: "No file provided" });
      }
      if (err.message.startsWith("Unsupported file type:")) {
        return res.status(415).json({ ok: false, error: err.message });
      }
      if (err.message.startsWith("File size exceeds")) {
        return res.status(413).json({ ok: false, error: err.message });
      }
    }

    console.error(
      "[ipfs]",
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    res.status(500).json({ ok: false, error: "Internal server error" });
  } finally {
    // Ensure busboy is cleaned up
    if (!busboy.destroyed) {
      busboy.destroy();
    }
  }
});

export { router as ipfsRouter };
