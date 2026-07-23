import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import rateLimit from "express-rate-limit";
import { requireAdminAuth } from "../middleware/auth.js";
import {
  createFlag,
  getModerationQueue,
  markUnderReview,
  confirmTakedown,
  dismissFlags,
} from "../db/moderationRepository.js";
import { getSampleByChainId } from "../db/sampleRepository.js";
import { unpinFromIPFS } from "../services/ipfs.js";

const router = Router();

// Reporting is intentionally public — no login is required to flag a
// listing, same as most UGC report buttons. Rate limited so it can't be
// used to spam the review queue.
const flagLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

const flagSchema = z.object({
  sampleId: z.coerce.bigint().positive(),
  reason: z.string().min(1).max(1000),
  reporter: z.string().refine(
    (v) => StrKey.isValidEd25519PublicKey(v),
    "Invalid Stellar address",
  ).optional(),
});

const queueQuerySchema = z.object({
  status: z.enum(["flagged", "under_review"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const resolutionSchema = z.object({
  note: z.string().max(1000).optional(),
});

function parseChainIdParam(id: unknown): bigint | null {
  if (typeof id !== "string") return null;
  try {
    const chainId = BigInt(id);
    return chainId > 0n ? chainId : null;
  } catch {
    return null;
  }
}

router.post("/flags", flagLimiter, async (req, res) => {
  const parsed = flagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const result = await createFlag({
      sampleChainId: parsed.data.sampleId,
      reason: parsed.data.reason,
      reporter: parsed.data.reporter,
    });
    if (!result) {
      return res.status(404).json({ ok: false, error: "Sample not found" });
    }
    res.status(201).json({ ok: true, data: result.flag });
  } catch (err) {
    console.error("[moderation]", err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/queue", requireAdminAuth, async (req, res) => {
  const parsed = queueQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const { data, total } = await getModerationQueue(parsed.data);
    res.json({ ok: true, data, total, limit: parsed.data.limit, offset: parsed.data.offset });
  } catch (err) {
    console.error("[moderation]", err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/review", requireAdminAuth, async (req, res) => {
  const chainId = parseChainIdParam(req.params.id);
  if (chainId === null) {
    return res.status(400).json({ ok: false, error: "Invalid sample id" });
  }
  try {
    const sample = await markUnderReview(chainId);
    if (!sample) {
      return res.status(409).json({ ok: false, error: "Sample is not currently flagged" });
    }
    res.json({ ok: true, data: sample });
  } catch (err) {
    console.error("[moderation]", err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/takedown", requireAdminAuth, async (req, res) => {
  const chainId = parseChainIdParam(req.params.id);
  if (chainId === null) {
    return res.status(400).json({ ok: false, error: "Invalid sample id" });
  }
  const parsed = resolutionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  const reviewedBy = (req as any).user.id as string;

  try {
    const sampleBeforeTakedown = await getSampleByChainId(chainId);
    const result = await confirmTakedown(chainId, { note: parsed.data.note, reviewedBy });
    if (!result) {
      return res.status(409).json({ ok: false, error: "Sample not found or already taken down" });
    }

    let unpinned = true;
    if (sampleBeforeTakedown) {
      try {
        await unpinFromIPFS(sampleBeforeTakedown.ipfs_cid);
      } catch (err) {
        unpinned = false;
        console.error(
          "[moderation] unpin failed after takedown, retry manually:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    res.json({ ok: true, data: result.sample, flagsResolved: result.flagsResolved, unpinned });
  } catch (err) {
    console.error("[moderation]", err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/dismiss", requireAdminAuth, async (req, res) => {
  const chainId = parseChainIdParam(req.params.id);
  if (chainId === null) {
    return res.status(400).json({ ok: false, error: "Invalid sample id" });
  }
  const parsed = resolutionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  const reviewedBy = (req as any).user.id as string;

  try {
    const result = await dismissFlags(chainId, { note: parsed.data.note, reviewedBy });
    if (!result) {
      return res.status(409).json({ ok: false, error: "Sample is not currently flagged or under review" });
    }
    res.json({ ok: true, data: result.sample, flagsResolved: result.flagsResolved });
  } catch (err) {
    console.error("[moderation]", err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export { router as moderationRouter };
