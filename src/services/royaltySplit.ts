const TOTAL_BASIS_POINTS = 10000;

export class SplitValidationError extends Error {}

export interface SplitRecipient {
  recipient: string;
  basisPoints: number;
}

export interface LineItem {
  recipient: string;
  amount: bigint;
}

/**
 * Validates that a set of recipients forms a legal split: at least one
 * recipient, no duplicates, each basisPoints in (0, 10000], and the whole
 * set summing to exactly 10000.
 */
export function assertValidSplit(recipients: SplitRecipient[]): void {
  if (recipients.length === 0) {
    throw new SplitValidationError("a split must have at least one recipient");
  }

  const seen = new Set<string>();
  let sum = 0;
  for (const r of recipients) {
    if (seen.has(r.recipient)) {
      throw new SplitValidationError(`duplicate recipient in split: ${r.recipient}`);
    }
    seen.add(r.recipient);

    if (!Number.isInteger(r.basisPoints) || r.basisPoints <= 0 || r.basisPoints > TOTAL_BASIS_POINTS) {
      throw new SplitValidationError(
        `basisPoints must be an integer between 1 and ${TOTAL_BASIS_POINTS}, got ${r.basisPoints} for ${r.recipient}`,
      );
    }
    sum += r.basisPoints;
  }

  if (sum !== TOTAL_BASIS_POINTS) {
    throw new SplitValidationError(`split basis points must sum to ${TOTAL_BASIS_POINTS}, got ${sum}`);
  }
}

/**
 * Splits `totalAmount` (stroops, or any integer smallest-unit amount)
 * across recipients by basis points, using the largest-remainder method
 * so the line items always sum to exactly totalAmount — no stroop is lost
 * or minted, and the leftover from rounding is spread across whichever
 * recipients' shares rounded down the hardest, rather than dumped
 * entirely on one recipient.
 *
 * Each recipient's raw share is totalAmount * basisPoints / 10000. That's
 * computed as one bigint multiply-then-divide (scaled = totalAmount *
 * basisPoints, floor = scaled / 10000) instead of converting to a float
 * anywhere, so there's no floating-point precision loss regardless of how
 * large totalAmount gets.
 */
export function computeLineItems(totalAmount: bigint, recipients: SplitRecipient[]): LineItem[] {
  if (totalAmount <= 0n) {
    throw new SplitValidationError(`totalAmount must be positive, got ${totalAmount}`);
  }
  assertValidSplit(recipients);

  const totalBps = BigInt(TOTAL_BASIS_POINTS);

  const shares = recipients.map((r, index) => {
    const scaled = totalAmount * BigInt(r.basisPoints);
    return {
      index,
      floor: scaled / totalBps,
      remainder: scaled % totalBps,
    };
  });

  const allocated = shares.reduce((sum, s) => sum + s.floor, 0n);
  let shortfall = totalAmount - allocated;

  // Largest-remainder method: whoever's division lost the most goes first
  // in line for the leftover stroops. Ties broken by original order so
  // the result is deterministic given the same input.
  const byRemainderDesc = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  const amounts = new Map(shares.map((s) => [s.index, s.floor]));
  for (const s of byRemainderDesc) {
    if (shortfall <= 0n) break;
    amounts.set(s.index, (amounts.get(s.index) as bigint) + 1n);
    shortfall -= 1n;
  }

  return recipients.map((r, index) => ({ recipient: r.recipient, amount: amounts.get(index) as bigint }));
}
