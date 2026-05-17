# sampled-backend

Node.js + Express + TypeScript API server for the Sampled marketplace.

## Stack

- **Node.js 22** + TypeScript
- **Express** 4 — HTTP server
- **@stellar/stellar-sdk** — Horizon queries, event streaming
- **multer** — file upload handling
- **Pinata** — IPFS upload proxy

## API Routes

### Samples
```
GET  /samples              — List samples (query: genre, search, sort, limit, offset)
GET  /samples/:id          — Get single sample metadata
POST /samples/metadata     — Register a newly uploaded sample (call after on-chain tx)
```

### IPFS Upload
```
POST /upload               — Upload audio file to IPFS via Pinata (multipart/form-data)
GET  /upload/health        — Check Pinata connectivity
```

### Analytics
```
GET  /analytics/stats                    — Platform stats (contract balance, tx count)
GET  /analytics/earnings/:address        — Producer earnings and recent txs
GET  /analytics/transactions             — Recent contract transactions
```

### Health
```
GET  /health               — Service health check
```

## Setup

```bash
npm install
cp .env.example .env
# Fill in PINATA_JWT, STELLAR_NETWORK, CONTRACT_ID
npm run dev
```

## Docker

```bash
docker build -t sampled-backend .
docker run -p 3001:3001 --env-file .env sampled-backend
```

## Environment Variables

```
PORT=3001
PINATA_JWT=your_pinata_jwt
PINATA_GATEWAY=https://gateway.pinata.cloud
STELLAR_NETWORK=testnet
CONTRACT_ID=CA7DGEWWS3VH5J2I4I7FFEB5UHK2MJSYWDKDQKXQM7GDNLI2IRATDTLG
ALLOWED_ORIGINS=http://localhost:5173
```
