import "dotenv/config";
import express from "express";
import { corsMiddleware } from "./middleware/cors.js";
import samplesRouter from "./routes/samples.js";
import ipfsRouter from "./routes/ipfs.js";
import analyticsRouter from "./routes/analytics.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(corsMiddleware);
app.use(express.json({ limit: "10mb" }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "crate-backend",
    timestamp: new Date().toISOString(),
    network: process.env.STELLAR_NETWORK ?? "testnet",
    contract: process.env.CONTRACT_ID ?? "CA7DGEWWS3VH5J2I4I7FFEB5UHK2MJSYWDKDQKXQM7GDNLI2IRATDTLG",
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/samples", samplesRouter);
app.use("/upload", ipfsRouter);
app.use("/analytics", analyticsRouter);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[crate-backend]", err);
    res.status(500).json({ error: err.message ?? "Internal server error" });
  }
);

app.listen(PORT, () => {
  console.log(`[crate-backend] running on http://localhost:${PORT}`);
  console.log(`[crate-backend] network: ${process.env.STELLAR_NETWORK ?? "testnet"}`);
});

export default app;

// 1: feat: scaffold Express + TypeScript project struct

// 2: feat: add IPFS upload proxy route with Pinata inte

// 3: feat: implement Stellar Horizon event streaming se

// 4: feat: add GET /api/samples endpoint with genre fil

// 5: feat: implement analytics/stats endpoint for platf

// 6: feat: add producer earnings history endpoint

// 7: fix: resolve CORS headers for Expo mobile client

// 8: feat: add Multer middleware for audio file upload 

// 9: feat: implement 30-second preview clip generation

// 10: fix: handle Horizon SSE reconnection on network ti

// 11: feat: add trending samples algorithm by purchase v

// 12: refactor: extract Stellar service into separate mo

// 13: feat: add rate limiting middleware to upload endpo

// 14: fix: sanitize IPFS CID input before proxying to Pi

// 15: feat: add Docker multi-stage build for production 

// 16: chore: add health check endpoint at GET /health

// 17: feat: implement sample search with full-text match
