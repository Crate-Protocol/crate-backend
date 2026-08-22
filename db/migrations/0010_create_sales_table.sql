-- Sales table: one row per on-chain purchase_license event.
-- Gives the backend a proper record of every sale with buyer, seller,
-- tier, and amount — data that the contract_events table stores only
-- as raw JSONB payload.

CREATE TABLE IF NOT EXISTS sales (
  id            SERIAL PRIMARY KEY,
  tx_hash       VARCHAR(64) NOT NULL UNIQUE,
  sample_id     BIGINT NOT NULL REFERENCES samples(chain_id),
  buyer         VARCHAR(56) NOT NULL,
  seller        VARCHAR(56) NOT NULL,
  tier          SMALLINT NOT NULL,  -- 0=lease, 1=premium, 2=exclusive
  amount        BIGINT NOT NULL,    -- in stroops
  token         VARCHAR(56) NOT NULL,
  ledger        BIGINT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_seller ON sales(seller);
CREATE INDEX IF NOT EXISTS idx_sales_buyer ON sales(buyer);
CREATE INDEX IF NOT EXISTS idx_sales_sample ON sales(sample_id);
CREATE INDEX IF NOT EXISTS idx_sales_occurred ON sales(occurred_at DESC);
