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
