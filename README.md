<div align="center">

<img src="public/crate-logo.svg" width="100" height="100" alt="Crate Logo" />

# Crate · Backend

### Node.js/Express API — IPFS proxy, analytics, and Stellar event streaming.

[![License](https://img.shields.io/badge/License-MIT-facc15?style=flat-square&labelColor=000)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-20+-facc15?style=flat-square&labelColor=000&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-facc15?style=flat-square&labelColor=000&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Stellar](https://img.shields.io/badge/Stellar-Horizon-facc15?style=flat-square&labelColor=000&logo=stellar&logoColor=white)](https://stellar.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-facc15?style=flat-square&labelColor=000&logo=docker&logoColor=white)](Dockerfile)

[Overview](#overview) · [API Reference](#api-reference) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Contributing](#contributing)

</div>

---

## Currently Building

| Feature | Status | Branch |
|---|---|---|
| IPFS upload proxy (Pinata) | ✅ Done | `main` |
| Stellar Horizon event streaming | ✅ Done | `main` |
| Sample metadata indexing | 🔄 In Progress | `feat/metadata-index` |
| PostgreSQL for persistence | 📋 Planned | — |
| WebSocket real-time sale feed | 📋 Planned | — |

---

## Overview

The Crate backend handles everything the Soroban smart contract doesn't — file storage, discovery, and analytics. The contract handles **payments and licensing**. The backend handles **search, IPFS, and data aggregation**.

> _The backend is intentionally lightweight. Crate's trust model is the contract. The backend is a performance layer on top of it._

---

## What it does

- **IPFS proxy** — routes audio uploads to Pinata so the frontend never exposes the API key
- **Analytics** — aggregates producer earnings, platform volume, and trending beats by indexing Horizon events
- **Sample metadata** — caches off-chain data (title, genre, BPM) for fast marketplace search
- **Preview clips** — serves 30-second preview cuts from the IPFS gateway

---

## API Reference

### Samples

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/samples` | List samples with filters (`?genre=trap&bpm=140`) |
| `GET` | `/api/samples/:id` | Get single sample metadata |
| `POST` | `/api/samples/metadata` | Save off-chain metadata after on-chain upload |

### IPFS

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/ipfs/upload` | Upload audio file → returns `{ cid, gatewayUrl }` |
| `GET` | `/api/ipfs/:cid/preview` | Serve 30-second preview clip |

### Analytics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/stats` | Platform totals: samples, volume, producers |
| `GET` | `/api/analytics/earnings/:address` | Producer transaction history |
| `GET` | `/api/analytics/trending` | Top samples by purchase count |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 Express API                      │
│         CORS · Helmet · Rate limiting            │
└──────────┬─────────────────────┬────────────────┘
           │                     │
    ┌──────▼──────┐       ┌──────▼──────┐
    │   /samples  │       │   /ipfs     │
    │  /analytics │       │  /preview   │
    └──────┬──────┘       └──────┬──────┘
           │                     │
    ┌──────▼──────┐       ┌──────▼──────┐
    │   Horizon   │       │   Pinata    │
    │   (Stellar) │       │   (IPFS)    │
    └─────────────┘       └─────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 20, TypeScript 5 |
| **Framework** | Express 4 |
| **Stellar** | `@stellar/stellar-sdk` — Horizon queries + events |
| **Storage** | IPFS via Pinata API |
| **Upload** | Multer — multipart/form-data |
| **Container** | Docker multi-stage build |

---

## Quick Start

### Prerequisites

- Node.js 20+
- A [Pinata](https://pinata.cloud) account (free tier works)

```bash
# Clone
git clone https://github.com/Crate-Protocol/crate-backend.git
cd crate-backend

# Install
npm install

# Configure
cp .env.example .env

# Start
npm run dev
```

API runs at **http://localhost:3001**

### Environment Variables

```env
PORT=3001

# Stellar
STELLAR_NETWORK=TESTNET
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=CA7DGEWWS3VH5J2I4I7FFEB5UHK2MJSYWDKDQKXQM7GDNLI2IRATDTLG

# IPFS
PINATA_JWT=your_pinata_jwt
PINATA_GATEWAY=https://gateway.pinata.cloud

# CORS
ALLOWED_ORIGINS=http://localhost:5173,https://crate.fm
```

### Docker

```bash
docker build -t crate-backend .
docker run -p 3001:3001 --env-file .env crate-backend
```

### Event Indexer

A separate long-running worker that polls Soroban `getEvents` for the
contract's `uploaded`/`licensed` events and persists them to Postgres —
that's what `total_sales` and `GET /api/analytics/stats` are actually backed
by, not a live contract call or client-submitted values. Run it as its own
process, alongside the API rather than inside it:

```bash
npm run db:migrate       # applies db/migrations/, including the indexer's tables
npm run dev:indexer      # or: npm run build && npm run start:indexer
```

See `.env.example` for tuning (poll interval, backfill depth, page size).

---

## Project Structure

```
src/
├── index.ts               # Express app — middleware + routes
├── indexer/                # Standalone Soroban event indexer worker
│   ├── index.ts           # Entrypoint (npm run dev:indexer / start:indexer)
│   ├── worker.ts          # Backfill + poll loop
│   ├── sorobanEvents.ts   # getEvents/getLatestLedger RPC calls
│   └── eventDecoder.ts    # Raw event → DecodedEvent
├── routes/
│   ├── samples.ts         # Sample CRUD + metadata
│   ├── ipfs.ts            # Pinata upload proxy
│   └── analytics.ts       # Stats + earnings + trending
├── services/
│   ├── stellar.ts         # Horizon queries, account balance, event SSE
│   └── ipfs.ts            # Pinata file upload service
├── db/
│   ├── sampleRepository.ts     # samples table
│   └── indexerRepository.ts    # contract_events / indexer_cursor / platform_stats
└── middleware/
    └── cors.ts            # CORS config
```

---

## Contributing

```bash
# Fork → clone → branch
git checkout -b feat/your-feature

# Make changes, then open a PR
```

---

## Ecosystem

| Repo | Description |
|---|---|
| [crate-frontend](https://github.com/Crate-Protocol/crate-frontend) | React 18 + TypeScript web app |
| [crate-contracts](https://github.com/Crate-Protocol/crate-contracts) | Soroban smart contracts (Rust) |
| [crate-mobile](https://github.com/Crate-Protocol/crate-mobile) | React Native mobile app |

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
  <img src="public/crate-logo.svg" width="40" alt="Crate" />
  <br/>
  <sub>Built on Stellar · Open Source · Non-custodial</sub>
  <br/><br/>

  [![Stars](https://img.shields.io/github/stars/Crate-Protocol/crate-backend?style=flat-square&labelColor=000&color=facc15)](https://github.com/Crate-Protocol/crate-backend/stargazers)
  [![Forks](https://img.shields.io/github/forks/Crate-Protocol/crate-backend?style=flat-square&labelColor=000&color=facc15)](https://github.com/Crate-Protocol/crate-backend/network/members)
  [![Issues](https://img.shields.io/github/issues/Crate-Protocol/crate-backend?style=flat-square&labelColor=000&color=facc15)](https://github.com/Crate-Protocol/crate-backend/issues)
</div>
