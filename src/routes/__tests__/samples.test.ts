import { describe, it, expect } from "vitest";
import { z } from "zod";
import { StrKey, Keypair } from "@stellar/stellar-sdk";

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

const VALID_STELLAR = Keypair.random().publicKey();

describe("metadataSchema validation", () => {
  it("accepts valid input", () => {
    const result = metadataSchema.safeParse({
      sampleId: 1,
      ipfsCid: "QmXgGPq5BPT1ahX4b1GnXQpG5rXm9a9a9a9a9a9a9a9a9a",
      title: "Test",
      uploader: VALID_STELLAR,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid Stellar address", () => {
    const result = metadataSchema.safeParse({
      sampleId: 1,
      ipfsCid: "QmXgGPq5BPT1ahX4b1GnXQpG5rXm9a9a9a9a9a9a9a9a",
      title: "Test",
      uploader: "NOT_A_VALID_STELLAR_ADDRESS_12345678901234567890",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Invalid Stellar address")).toBe(true);
    }
  });

  it("rejects empty title", () => {
    const result = metadataSchema.safeParse({
      sampleId: 1,
      ipfsCid: "QmXgGPq5BPT1ahX4b1GnXQpG5rXm9a9a9a9a9a9a9a9a",
      title: "",
      uploader: VALID_STELLAR,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid IPFS CID", () => {
    const result = metadataSchema.safeParse({
      sampleId: 1,
      ipfsCid: "not-a-cid",
      title: "Test",
      uploader: VALID_STELLAR,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Invalid IPFS CID")).toBe(true);
    }
  });

  it("rejects negative leasePrice", () => {
    const result = metadataSchema.safeParse({
      sampleId: 1,
      ipfsCid: "QmXgGPq5BPT1ahX4b1GnXQpG5rXm9a9a9a9a9a9a9a9a",
      title: "Test",
      uploader: VALID_STELLAR,
      leasePrice: -1,
    });
    expect(result.success).toBe(false);
  });

  it("returns all errors, not just the first", () => {
    const result = metadataSchema.safeParse({
      sampleId: -1,
      ipfsCid: "bad",
      title: "",
      uploader: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});
