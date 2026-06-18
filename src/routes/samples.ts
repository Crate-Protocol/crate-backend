import { Router } from "express";
import { z } from "zod";
import {
  listSamples,
  getSampleByChainId,
  upsertSampleMetadata,
} from "../db/sampleRepository.js";

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  genre: z.string().optional(),
  uploader: z.string().optional(),
});

const metadataSchema = z.object({
  sampleId: z.number().int().positive(),
  ipfsCid: z.string().regex(
    /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{56})$/,
    "Invalid IPFS CID",
  ),
  title: z.string().min(1).max(200),
  uploader: z.string().length(56, "Invalid Stellar address"),
  genre: z.string().max(50).optional(),
  bpm: z.number().int().min(1).max(400).optional(),
  leasePrice: z.number().int().min(0).optional(),
  premiumPrice: z.number().int().min(0).optional(),
  exclusivePrice: z.number().int().min(0).optional(),
  isExclusive: z.boolean().optional(),
});

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
  }
  try {
    const { data, total } = await listSamples(parsed.data);
    res.json({ ok: true, data, total, limit: parsed.data.limit, offset: parsed.data.offset });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const chainId = parseInt(req.params.id, 10);
  if (isNaN(chainId) || chainId <= 0) {
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
    return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
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
    res.status(inserted ? 201 : 200).json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export { router as samplesRouter };
