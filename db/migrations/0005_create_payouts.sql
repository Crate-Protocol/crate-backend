-- Payout ledger. A "payout" is one sale event resolved against the split
-- version effective at sale time; its "line items" are the per-recipient
-- amounts owed. sale_event_id is UNIQUE so re-processing the same sale
-- (an at-least-once event indexer replaying a delivery, see #20) can't
-- create a duplicate payout — the second attempt is a no-op that returns
-- the existing row instead.
--
-- sale_event_id is a plain TEXT identifier rather than a foreign key into
-- a contract_events table, because that table doesn't exist yet — #20,
-- the Soroban event indexer this reconciliation depends on, is still
-- open. Once it lands, sale_event_id can become a real FK; until then
-- it's an opaque external id supplied by whatever calls createPayout().

CREATE TABLE IF NOT EXISTS payouts (
  id SERIAL PRIMARY KEY,
  sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  sale_event_id TEXT NOT NULL UNIQUE,
  split_version INTEGER NOT NULL CHECK (split_version > 0),
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'computed' CHECK (status IN ('computed', 'submitted', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_sample ON payouts (sample_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts (status);

CREATE TRIGGER payouts_updated_at
BEFORE UPDATE ON payouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payout_line_items (
  id SERIAL PRIMARY KEY,
  payout_id INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  recipient CHAR(56) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  stellar_tx_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payout_id, recipient)
);

CREATE INDEX IF NOT EXISTS idx_payout_line_items_payout ON payout_line_items (payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_line_items_recipient ON payout_line_items (recipient);
