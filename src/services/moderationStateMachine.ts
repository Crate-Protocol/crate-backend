export type ModerationStatus = "active" | "flagged" | "under_review" | "taken_down";

export const MODERATION_STATUSES: ModerationStatus[] = [
  "active",
  "flagged",
  "under_review",
  "taken_down",
];

// taken_down is terminal — no route back out of it in this workflow.
const ALLOWED_TRANSITIONS: Record<ModerationStatus, ModerationStatus[]> = {
  active:       ["flagged", "taken_down"],
  flagged:      ["under_review", "active", "taken_down"],
  under_review: ["active", "taken_down"],
  taken_down:   [],
};

export function canTransition(from: ModerationStatus, to: ModerationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
