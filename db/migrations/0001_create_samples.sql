CREATE TABLE IF NOT EXISTS samples (
  id SERIAL PRIMARY KEY,
  chain_id BIGINT UNIQUE NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  ipfs_cid TEXT NOT NULL CHECK (ipfs_cid ~ '^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{56})$'),
  uploader CHAR(56) NOT NULL,
  genre TEXT CHECK (char_length(genre) <= 50),
  bpm SMALLINT CHECK (bpm BETWEEN 1 AND 400),
  lease_price BIGINT CHECK (lease_price >= 0),
  premium_price BIGINT CHECK (premium_price >= 0),
  exclusive_price BIGINT CHECK (exclusive_price >= 0),
  is_exclusive BOOLEAN NOT NULL DEFAULT false,
  total_sales INTEGER NOT NULL DEFAULT 0 CHECK (total_sales >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_samples_uploader ON samples (uploader);
CREATE INDEX IF NOT EXISTS idx_samples_genre ON samples (genre);
CREATE INDEX IF NOT EXISTS idx_samples_chain_id ON samples (chain_id);
