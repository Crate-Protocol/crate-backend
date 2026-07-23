-- Versioned royalty split configuration per sample. A "version" is an
-- immutable, all-or-nothing set of (recipient, basis_points) rows that sum
-- to 10000. Configuring a new split never updates existing rows — it
-- inserts a new version effective from its creation time (or a supplied
-- future time), so historical payouts, which record the split_version
-- they were computed against, are never altered by a later config change.
--
-- The "basis points for a (sample_id, version) must sum to exactly 10000"
-- invariant is enforced in the application layer (src/db/royaltySplitRepository.ts),
-- not here — Postgres CHECK constraints can't reference other rows, and a
-- constraint trigger felt like more moving parts than this needs given
-- there's exactly one write path (createSplitVersion) and it inserts the
-- whole version inside one transaction.

CREATE TABLE IF NOT EXISTS royalty_splits (
  id SERIAL PRIMARY KEY,
  sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  recipient CHAR(56) NOT NULL,
  basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sample_id, version, recipient)
);

CREATE INDEX IF NOT EXISTS idx_royalty_splits_sample_version ON royalty_splits (sample_id, version);

-- Resolves "which version applies to a sale at time T" — greatest
-- effective_from <= T for the sample.
CREATE INDEX IF NOT EXISTS idx_royalty_splits_effective ON royalty_splits (sample_id, effective_from DESC);
