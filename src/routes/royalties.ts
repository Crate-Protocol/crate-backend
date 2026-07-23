import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { requireProducerAuth } from "../middleware/auth.js";
import { getSampleByChainId, type Sample } from "../db/sampleRepository.js";
import { createSplitVersion, listSplitVersions, getEffectiveSplit } from "../db/royaltySplitRepository.js";
import { listPayoutsForSample } from "../db/payoutRepository.js";
import { SplitValidationError } from "../services/royaltySplit.js";

const router = Router();

const recipientSchema = z.object({
  recipient: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "Invalid Stellar address"),
  basisPoints: z.number().int().min(1).max(10000),
});

const configureSplitSchema = z.object({
  recipients: z.array(recipientSchema).min(1).max(20),
  effectiveFrom: z.coerce.date().optional(),
});

type ResolveResult = { sample: Sample } | { error: "invalid" | "not_found" };

async function resolveSample(chainIdParam: string | string[]): Promise<ResolveResult> {
  if (typeof chainIdParam !== "string") return { error: "invalid" };

  let chainId: bigint;
  try {
    chainId = BigInt(chainIdParam);
  } catch {
    return { error: "invalid" };
  }
  if (chainId <= 0n) return { error: "invalid" };

  const sample = await getSampleByChainId(chainId);
  if (!sample) return { error: "not_found" };
  return { sample };
}

function respondNotResolved(res: import("express").Response, result: { error: "invalid" | "not_found" }) {
  if (result.error === "not_found") {
    return res.status(404).json({ ok: false, error: "Sample not found" });
  }
  return res.status(400).json({ ok: false, error: "Invalid sample id" });
}

router.post("/:id/royalty-splits", requireProducerAuth, async (req, res) => {
  const resolved = await resolveSample(req.params.id);
  if ("error" in resolved) return respondNotResolved(res, resolved);
  const { sample } = resolved;

  const callerId = (req as any).user?.id;
  if (sample.uploader !== callerId) {
    return res.status(403).json({ ok: false, error: "Only the sample's uploader can configure royalty splits" });
  }

  const parsed = configureSplitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.issues.map((i) => i.message) });
  }

  // Versions only ever apply forward from creation — allowing a backdated
  // effectiveFrom would let a config change reach into a window that may
  // already have unreconciled sales, which is exactly the ambiguity
  // versioning exists to avoid.
  if (parsed.data.effectiveFrom && parsed.data.effectiveFrom.getTime() < Date.now()) {
    return res.status(400).json({ ok: false, error: "effectiveFrom cannot be in the past" });
  }

  try {
    const result = await createSplitVersion(sample.id, parsed.data.recipients, parsed.data.effectiveFrom);
    res.status(201).json({
      ok: true,
      data: { version: result.version, effectiveFrom: result.effectiveFrom.toISOString() },
    });
  } catch (err) {
    if (err instanceof SplitValidationError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error("[royalties]", err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/royalty-splits", async (req, res) => {
  const resolved = await resolveSample(req.params.id);
  if ("error" in resolved) return respondNotResolved(res, resolved);

  try {
    const versions = await listSplitVersions(resolved.sample.id);
    res.json({
      ok: true,
      data: versions.map((v) => ({ ...v, effective_from: v.effective_from.toISOString() })),
    });
  } catch {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/royalty-splits/current", async (req, res) => {
  const resolved = await resolveSample(req.params.id);
  if ("error" in resolved) return respondNotResolved(res, resolved);

  try {
    const effective = await getEffectiveSplit(resolved.sample.id, new Date());
    if (!effective) {
      return res.status(404).json({ ok: false, error: "No royalty split configured for this sample" });
    }
    res.json({ ok: true, data: effective });
  } catch {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/payouts", async (req, res) => {
  const resolved = await resolveSample(req.params.id);
  if ("error" in resolved) return respondNotResolved(res, resolved);

  try {
    const payouts = await listPayoutsForSample(resolved.sample.id);
    res.json({
      ok: true,
      data: payouts.map((p) => ({ ...p, total_amount: p.total_amount.toString() })),
    });
  } catch {
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export { router as royaltiesRouter };
