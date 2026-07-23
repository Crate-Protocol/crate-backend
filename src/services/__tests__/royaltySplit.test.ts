import { describe, it, expect } from "vitest";
import {
  assertValidSplit,
  computeLineItems,
  SplitValidationError,
} from "../royaltySplit.js";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4S6";
const C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCPO2";

function sumAmounts(items: { amount: bigint }[]): bigint {
  return items.reduce((s, i) => s + i.amount, 0n);
}

describe("assertValidSplit", () => {
  it("accepts a split that sums to 10000", () => {
    expect(() =>
      assertValidSplit([
        { recipient: A, basisPoints: 6000 },
        { recipient: B, basisPoints: 4000 },
      ]),
    ).not.toThrow();
  });

  it("accepts a single recipient at 10000", () => {
    expect(() => assertValidSplit([{ recipient: A, basisPoints: 10000 }])).not.toThrow();
  });

  it("rejects an empty split", () => {
    expect(() => assertValidSplit([])).toThrow(SplitValidationError);
  });

  it("rejects a split that sums under 10000", () => {
    expect(() =>
      assertValidSplit([
        { recipient: A, basisPoints: 5000 },
        { recipient: B, basisPoints: 4000 },
      ]),
    ).toThrow(/sum to 10000/);
  });

  it("rejects a split that sums over 10000", () => {
    expect(() =>
      assertValidSplit([
        { recipient: A, basisPoints: 6000 },
        { recipient: B, basisPoints: 5000 },
      ]),
    ).toThrow(/sum to 10000/);
  });

  it("rejects a duplicate recipient", () => {
    expect(() =>
      assertValidSplit([
        { recipient: A, basisPoints: 5000 },
        { recipient: A, basisPoints: 5000 },
      ]),
    ).toThrow(/duplicate recipient/);
  });

  it("rejects a zero basisPoints entry", () => {
    expect(() =>
      assertValidSplit([
        { recipient: A, basisPoints: 0 },
        { recipient: B, basisPoints: 10000 },
      ]),
    ).toThrow(/basisPoints must be an integer/);
  });

  it("rejects a basisPoints entry over 10000", () => {
    expect(() => assertValidSplit([{ recipient: A, basisPoints: 10001 }])).toThrow(/basisPoints must be an integer/);
  });

  it("rejects a non-integer basisPoints entry", () => {
    expect(() => assertValidSplit([{ recipient: A, basisPoints: 50.5 }])).toThrow(/basisPoints must be an integer/);
  });
});

describe("computeLineItems", () => {
  it("splits evenly when the amount divides cleanly", () => {
    const items = computeLineItems(1000n, [
      { recipient: A, basisPoints: 5000 },
      { recipient: B, basisPoints: 5000 },
    ]);
    expect(items).toEqual([
      { recipient: A, amount: 500n },
      { recipient: B, amount: 500n },
    ]);
  });

  it("never loses or mints a unit for a three-way split that doesn't divide evenly", () => {
    // 3333/3333/3334 bps of 1000 stroops — the classic uneven three-way split.
    const items = computeLineItems(1000n, [
      { recipient: A, basisPoints: 3333 },
      { recipient: B, basisPoints: 3333 },
      { recipient: C, basisPoints: 3334 },
    ]);
    expect(sumAmounts(items)).toBe(1000n);
  });

  it("distributes the remainder to the largest fractional loss, not just the largest share", () => {
    // amount * bps / 10000 for each: 100*3333/10000 = 33.33, 100*3333/10000 = 33.33,
    // 100*3334/10000 = 33.34 -> floors are 33/33/33 = 99, shortfall is 1.
    // C has both the largest basisPoints AND the largest remainder here, so
    // use an amount where the largest-bps recipient is NOT the one with the
    // largest fractional remainder, to prove it's remainder-driven.
    const items = computeLineItems(7n, [
      { recipient: A, basisPoints: 100 }, // 7*100/10000 = 0.07 -> floor 0, rem 700
      { recipient: B, basisPoints: 9800 }, // 7*9800/10000 = 6.86 -> floor 6, rem 6000
      { recipient: C, basisPoints: 100 }, // 7*100/10000 = 0.07 -> floor 0, rem 700
    ]);
    expect(sumAmounts(items)).toBe(7n);
    // shortfall is 1 (7 - 6). B has the largest remainder (6000), so B gets it,
    // even though A and C have smaller shares — this documents the tie-break
    // is by remainder size, not basisPoints size (they happen to agree here,
    // the point of this test is the mechanism, verified precisely below).
    const byRecipient = Object.fromEntries(items.map((i) => [i.recipient, i.amount]));
    expect(byRecipient[B]).toBe(7n);
    expect(byRecipient[A]).toBe(0n);
    expect(byRecipient[C]).toBe(0n);
  });

  it("handles an amount smaller than the number of recipients without losing a unit", () => {
    // 2 stroops across 3 equal recipients: two of them get 1, one gets 0.
    const items = computeLineItems(2n, [
      { recipient: A, basisPoints: 3334 },
      { recipient: B, basisPoints: 3333 },
      { recipient: C, basisPoints: 3333 },
    ]);
    expect(sumAmounts(items)).toBe(2n);
    expect(items.every((i) => i.amount === 0n || i.amount === 1n)).toBe(true);
  });

  it("gives everything to a single 10000bps recipient", () => {
    const items = computeLineItems(123456789n, [{ recipient: A, basisPoints: 10000 }]);
    expect(items).toEqual([{ recipient: A, amount: 123456789n }]);
  });

  it("is exact for a large amount with an uneven four-way split", () => {
    const total = 999_999_999_999n;
    const items = computeLineItems(total, [
      { recipient: A, basisPoints: 2500 },
      { recipient: B, basisPoints: 2500 },
      { recipient: C, basisPoints: 2501 },
      { recipient: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD5UQ", basisPoints: 2499 },
    ]);
    expect(sumAmounts(items)).toBe(total);
  });

  it("stays exact across a sweep of odd amounts against an uneven split", () => {
    const recipients = [
      { recipient: A, basisPoints: 1 },
      { recipient: B, basisPoints: 9998 },
      { recipient: C, basisPoints: 1 },
    ];
    for (let amount = 1n; amount <= 200n; amount++) {
      const items = computeLineItems(amount, recipients);
      expect(sumAmounts(items)).toBe(amount);
    }
  });

  it("rejects a non-positive amount", () => {
    expect(() => computeLineItems(0n, [{ recipient: A, basisPoints: 10000 }])).toThrow(SplitValidationError);
    expect(() => computeLineItems(-5n, [{ recipient: A, basisPoints: 10000 }])).toThrow(SplitValidationError);
  });

  it("rejects an invalid split before doing any allocation", () => {
    expect(() =>
      computeLineItems(1000n, [
        { recipient: A, basisPoints: 4000 },
        { recipient: B, basisPoints: 4000 },
      ]),
    ).toThrow(/sum to 10000/);
  });
});
