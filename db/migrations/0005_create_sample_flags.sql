CREATE TABLE IF NOT EXISTS sample_flags (
  id SERIAL PRIMARY KEY,
  sample_chain_id BIGINT NOT NULL REFERENCES samples (chain_id) ON DELETE CASCADE,
  reporter TEXT,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  resolution_note TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sample_flags_sample_chain_id ON sample_flags (sample_chain_id);
CREATE INDEX IF NOT EXISTS idx_sample_flags_status ON sample_flags (status);
