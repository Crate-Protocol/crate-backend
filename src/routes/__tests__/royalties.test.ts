import { describe, it, expect } from "vitest";
import { z } from "zod";
import { StrKey, Keypair } from "@stellar/stellar-sdk";

// Mirrors the schema in ../royalties.ts — kept in sync manually the same
// way samples.test.ts mirrors metadataSchema from ../samples.ts.
const recipientSchema = z.object({
  recipient: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "Invalid Stellar address"),
  basisPoints: z.number().int().min(1).max(10000),
});

const configureSplitSchema = z.object({
  recipients: z.array(recipientSchema).min(1).max(20),
  effectiveFrom: z.coerce.date().optional(),
});

const RECIPIENT_A = Keypair.random().publicKey();
const RECIPIENT_B = Keypair.random().publicKey();

describe("configureSplitSchema validation", () => {
  it("accepts a valid two-recipient split", () => {
    const result = configureSplitSchema.safeParse({
      recipients: [
        { recipient: RECIPIENT_A, basisPoints: 6000 },
        { recipient: RECIPIENT_B, basisPoints: 4000 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional effectiveFrom as an ISO date string", () => {
    const result = configureSplitSchema.safeParse({
      recipients: [{ recipient: RECIPIENT_A, basisPoints: 10000 }],
      effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty recipients array", () => {
    const result = configureSplitSchema.safeParse({ recipients: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 recipients", () => {
    const recipients = Array.from({ length: 21 }, () => ({
      recipient: Keypair.random().publicKey(),
      basisPoints: 1,
    }));
    const result = configureSplitSchema.safeParse({ recipients });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid Stellar address", () => {
    const result = configureSplitSchema.safeParse({
      recipients: [{ recipient: "not-a-stellar-address", basisPoints: 10000 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Invalid Stellar address")).toBe(true);
    }
  });

  it("rejects basisPoints of 0", () => {
    const result = configureSplitSchema.safeParse({
      recipients: [{ recipient: RECIPIENT_A, basisPoints: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects basisPoints over 10000", () => {
    const result = configureSplitSchema.safeParse({
      recipients: [{ recipient: RECIPIENT_A, basisPoints: 10001 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer basisPoints", () => {
    const result = configureSplitSchema.safeParse({
      recipients: [{ recipient: RECIPIENT_A, basisPoints: 50.5 }],
    });
    expect(result.success).toBe(false);
  });

  // Note: the schema itself doesn't check that basisPoints sum to 10000 or
  // that recipients are unique — those are cross-field/cross-row invariants
  // enforced by assertValidSplit() in services/royaltySplit.ts, which is
  // covered directly in services/__tests__/royaltySplit.test.ts.
});
