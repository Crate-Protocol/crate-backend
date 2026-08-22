import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import {
  listSamples,
  getSampleByChainId,
  upsertSampleMetadata,
} from "../db/sampleRepository.js";
import { cacheWith, etagForKey } from "../cache/cacheWith.js";
import { invalidateSampleCache } from "../cache/invalidate.js";

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  genre: z.string().optional(),
  uploader: z.string().optional(),
});

const metadataSchema = z.object({
  sampleId: z.coerce.bigint().positive(),
  ipfsCid: z.string().regex(
    /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{56})$/,
    "Invalid IPFS CID",
  ),
  title: z.string().min(1).max(200),
  uploader: z.string().refine(
    (v) => StrKey.isValidEd25519PublicKey(v),
    "Invalid Stellar address",
  ),
  genre: z.string().max(50).optional(),
  bpm: z.number().int().min(1).max(400).optional(),
  leasePrice: z.coerce.bigint().min(0n).optional(),
  premiumPrice: z.coerce.bigint().min(0n).optional(),
  exclusivePrice: z.coerce.bigint().min(0n).optional(),
  isExclusive: z.boolean().optional(),
});

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const { genre, uploader, limit, offset } = parsed.data;
    const cacheKey = `samples:${genre || ""}:${uploader || ""}:${limit}:${offset}`;

    const result = await cacheWith(cacheKey, 30, () => listSamples(parsed.data));

    // ETag support — return 304 if client already has this version
    const etag = etagForKey(cacheKey);
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }
    res.set("ETag", etag);

    res.json({ ok: true, data: result.data, total: result.total, limit, offset });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const chainId = BigInt(req.params.id);
  if (chainId <= 0n) {
    return res.status(400).json({ ok: false, error: "Invalid sample id" });
  }
  try {
    const sample = await getSampleByChainId(chainId);
    if (!sample) {
      return res.status(404).json({ ok: false, error: "Sample not found" });
    }
    res.json({ ok: true, data: sample });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/metadata", async (req, res) => {
  const parsed = metadataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const { row, inserted } = await upsertSampleMetadata({
      chain_id: parsed.data.sampleId,
      title: parsed.data.title,
      ipfs_cid: parsed.data.ipfsCid,
      uploader: parsed.data.uploader,
      genre: parsed.data.genre,
      bpm: parsed.data.bpm,
      lease_price: parsed.data.leasePrice,
      premium_price: parsed.data.premiumPrice,
      exclusive_price: parsed.data.exclusivePrice,
      is_exclusive: parsed.data.isExclusive,
    });
    // Invalidate sample listings so next GET reflects the upsert
    await invalidateSampleCache();
    res.status(inserted ? 201 : 200).json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export { router as samplesRouter };
