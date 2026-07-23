import { describe, it, expect } from "vitest";
import { canTransition, MODERATION_STATUSES } from "../moderationStateMachine.js";
import type { ModerationStatus } from "../moderationStateMachine.js";

describe("canTransition", () => {
  it("allows a flag to move an active sample to flagged", () => {
    expect(canTransition("active", "flagged")).toBe(true);
  });

  it("allows an admin to claim a flagged sample for review", () => {
    expect(canTransition("flagged", "under_review")).toBe(true);
  });

  it("allows takedown directly from active, flagged, or under_review", () => {
    expect(canTransition("active", "taken_down")).toBe(true);
    expect(canTransition("flagged", "taken_down")).toBe(true);
    expect(canTransition("under_review", "taken_down")).toBe(true);
  });

  it("allows dismissing a flagged or under-review sample back to active", () => {
    expect(canTransition("flagged", "active")).toBe(true);
    expect(canTransition("under_review", "active")).toBe(true);
  });

  it("never allows a transition out of taken_down", () => {
    for (const to of MODERATION_STATUSES) {
      expect(canTransition("taken_down", to)).toBe(false);
    }
  });

  it("does not allow re-flagging an already flagged or under-review sample", () => {
    expect(canTransition("flagged", "flagged")).toBe(false);
    expect(canTransition("under_review", "flagged")).toBe(false);
  });

  it("does not allow active to jump straight to under_review", () => {
    expect(canTransition("active", "under_review")).toBe(false);
  });
});

// Keeps the transition table honest against the type — a status added to the
// union without a matching table entry would throw at import time instead of
// silently falling through.
describe("ALLOWED_TRANSITIONS coverage", () => {
  it("has an entry for every known status", () => {
    const statuses: ModerationStatus[] = [...MODERATION_STATUSES];
    for (const s of statuses) {
      expect(() => canTransition(s, s)).not.toThrow();
    }
  });
});
