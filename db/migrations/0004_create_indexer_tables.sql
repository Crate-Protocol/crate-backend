-- Supports the Soroban event indexer worker (issue #20). Run this in
-- alongside the existing schema described in the README.

-- Tracks how far the indexer has gotten for a given contract, so a restart
-- resumes from where it left off instead of re-scanning from genesis.
CREATE TABLE IF NOT EXISTS indexer_cursor (
  contract_id TEXT PRIMARY KEY,
  last_ledger INTEGER NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per contract event actually applied. The UNIQUE constraint is what
-- makes applying an event idempotent: a replayed event (RPC redelivers a
-- ledger range we've already processed, or the worker restarts mid-batch)
-- hits ON CONFLICT DO NOTHING instead of being counted twice.
--
-- event_index is not something the RPC response provides directly (its own
-- per-event id format isn't part of the documented client API) — it's
-- assigned locally as the event's position among events sharing the same
-- (ledger, tx_hash) within a single getEvents response, which is stable and
-- reproducible on replay since the RPC returns events in execution order.
CREATE TABLE IF NOT EXISTS contract_events (
  id               BIGSERIAL PRIMARY KEY,
  contract_id      TEXT NOT NULL,
  ledger           INTEGER NOT NULL,
  tx_hash          TEXT NOT NULL,
  event_index      INTEGER NOT NULL,
  event_type       TEXT NOT NULL,
  sample_id        BIGINT NOT NULL,
  payload          JSONB NOT NULL,
  ledger_closed_at TIMESTAMPTZ NOT NULL,
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ledger, tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_contract_events_sample_id  ON contract_events (sample_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_event_type ON contract_events (event_type);
CREATE INDEX IF NOT EXISTS idx_contract_events_contract_id ON contract_events (contract_id);

-- Mirrors the on-chain contract's own Producer(Address) flag (see
-- upload_sample in crate-contracts): a producer only counts toward
-- total_producers once, the first time we see an "uploaded" event from
-- their address.
CREATE TABLE IF NOT EXISTS known_producers (
  address       TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Denormalized aggregate, updated transactionally alongside contract_events
-- as each event is applied — the same total_samples/total_volume/
-- total_producers triple the contract's own get_stats() returns, computed
-- from indexed history instead of a live contract call on every request.
CREATE TABLE IF NOT EXISTS platform_stats (
  contract_id     TEXT PRIMARY KEY,
  total_samples   INTEGER NOT NULL DEFAULT 0,
  total_volume    BIGINT NOT NULL DEFAULT 0,
  total_producers INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
