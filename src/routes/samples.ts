/**
 * routes/samples.ts
 * ──────────────────
 * Sample metadata routes (backed by an in-memory cache + Horizon queries).
 * In production, replace the cache with a Postgres/Redis layer.
 */

import { Router, Request, Response } from "express";
import { getCidUrl } from "../services/ipfs.js";

const router = Router();

// ─── In-memory cache (replace with DB in production) ─────────────────────────

interface SampleMeta {
  id: string;
  title: string;
  ipfsCid: string;
  ipfsUrl: string;
  priceXlm: number;
  genre: string;
  bpm: number;
  uploader: string;
  salesCount: number;
  active: boolean;
  createdAt: string;
}

const sampleCache = new Map<string, SampleMeta>();

// Seed with a few demo entries
const DEMO: SampleMeta[] = [
  {
    id: "1",
    title: "Midnight Trap Vol.1",
    ipfsCid: "QmYwAPJzv5CZsnAzt8auV39s1XR1gjbn3dp5e2B84Q5D7J",
    ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmYwAPJzv5CZsnAzt8auV39s1XR1gjbn3dp5e2B84Q5D7J",
    priceXlm: 12,
    genre: "Trap",
    bpm: 140,
    uploader: "GBVKN4YTR3BFNCBQ5KWZOXJGTYUOOVKV7HBQPFZ5N7M5YZQE6RPDWKL",
    salesCount: 42,
    active: true,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: "2",
    title: "Lo-Fi Study Session",
    ipfsCid: "QmZbH4KgmzQT3N8F7XvYj9Dk2Pb5BQRS8HNnLxT1MNPQ",
    ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmZbH4KgmzQT3N8F7XvYj9Dk2Pb5BQRS8HNnLxT1MNPQ",
    priceXlm: 8,
    genre: "Lo-Fi",
    bpm: 85,
    uploader: "GBLQ7VN5LXQVX5QQFPWSF7BZJFKBM5KXQJXMCZN3JFPFDJQMKBHZQBT",
    salesCount: 128,
    active: true,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
  },
  {
    id: "3",
    title: "808 Summer",
    ipfsCid: "QmT3N8vYj9Dk2Pb5BQRS8HNnLxT1MNPQH4KgmzQZbP3F7",
    ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmT3N8vYj9Dk2Pb5BQRS8HNnLxT1MNPQH4KgmzQZbP3F7",
    priceXlm: 15,
    genre: "Hip-Hop",
    bpm: 92,
    uploader: "GBLQ7VN5LXQVX5QQFPWSF7BZJFKBM5KXQJXMCZN3JFPFDJQMKBHZQBT",
    salesCount: 67,
    active: true,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

DEMO.forEach((s) => sampleCache.set(s.id, s));

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /samples
 * Query params: genre, search, limit, offset, sort
 */
router.get("/", (req: Request, res: Response) => {
  const { genre, search, limit = "20", offset = "0", sort = "popular" } = req.query;

  let samples = Array.from(sampleCache.values()).filter((s) => s.active);

  if (genre && genre !== "All") {
    samples = samples.filter((s) => s.genre === genre);
  }

  if (search) {
    const q = (search as string).toLowerCase();
    samples = samples.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.genre.toLowerCase().includes(q)
    );
  }

  // Sort
  if (sort === "popular") {
    samples.sort((a, b) => b.salesCount - a.salesCount);
  } else if (sort === "price_asc") {
    samples.sort((a, b) => a.priceXlm - b.priceXlm);
  } else if (sort === "price_desc") {
    samples.sort((a, b) => b.priceXlm - a.priceXlm);
  } else if (sort === "newest") {
    samples.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  const total = samples.length;
  const page = samples.slice(
    parseInt(offset as string),
    parseInt(offset as string) + parseInt(limit as string)
  );

  res.json({ samples: page, total, limit: parseInt(limit as string), offset: parseInt(offset as string) });
});

/**
 * GET /samples/:id
 */
router.get("/:id", (req: Request, res: Response) => {
  const sample = sampleCache.get(req.params.id);
  if (!sample) {
    res.status(404).json({ error: "Sample not found" });
    return;
  }
  res.json(sample);
});

/**
 * POST /samples/metadata
 * Body: { id, title, ipfsCid, priceXlm, genre, bpm, uploader }
 * Called by the frontend after a successful on-chain upload_sample tx.
 */
router.post("/metadata", (req: Request, res: Response) => {
  const { id, title, ipfsCid, priceXlm, genre, bpm, uploader } = req.body as {
    id: string;
    title: string;
    ipfsCid: string;
    priceXlm: number;
    genre: string;
    bpm: number;
    uploader: string;
  };

  if (!id || !title || !ipfsCid || !uploader) {
    res.status(400).json({ error: "Missing required fields: id, title, ipfsCid, uploader" });
    return;
  }

  const sample: SampleMeta = {
    id: String(id),
    title,
    ipfsCid,
    ipfsUrl: getCidUrl(ipfsCid),
    priceXlm: Number(priceXlm),
    genre: genre ?? "Other",
    bpm: Number(bpm) ?? 0,
    uploader,
    salesCount: 0,
    active: true,
    createdAt: new Date().toISOString(),
  };

  sampleCache.set(sample.id, sample);
  res.status(201).json(sample);
});

export default router;
