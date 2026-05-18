import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { samplesRouter }   from "./routes/samples";
import { ipfsRouter }      from "./routes/ipfs";
import { analyticsRouter } from "./routes/analytics";

const app  = express();
const PORT = process.env.PORT ?? 3001;

app.use(helmet());
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",") }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));
app.use("/api/samples",   samplesRouter);
app.use("/api/ipfs",      ipfsRouter);
app.use("/api/analytics", analyticsRouter);

// Global error handler — must be registered after all routes
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[error]", msg);
  res.status(500).json({ ok: false, error: msg });
});

app.listen(PORT, () => console.log(`Crate API running on :${PORT}`));
export default app;
