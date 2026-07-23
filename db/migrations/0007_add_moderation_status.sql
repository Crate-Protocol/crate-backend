ALTER TABLE samples
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (moderation_status IN ('active', 'flagged', 'under_review', 'taken_down'));

CREATE INDEX IF NOT EXISTS idx_samples_moderation_status ON samples (moderation_status);
