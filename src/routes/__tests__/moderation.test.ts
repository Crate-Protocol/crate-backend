import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../db/moderationRepository.js", () => ({
  createFlag: vi.fn(),
  getModerationQueue: vi.fn(),
  markUnderReview: vi.fn(),
  confirmTakedown: vi.fn(),
  dismissFlags: vi.fn(),
}));
vi.mock("../../services/ipfs.js", () => ({
  unpinFromIPFS: vi.fn(),
}));

import { moderationRouter } from "../moderation.js";
import * as moderationRepo from "../../db/moderationRepository.js";
import * as ipfsService from "../../services/ipfs.js";

function getHandler(path: string, method: "get" | "post") {
  const layer = moderationRouter.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  const stack = layer?.route?.stack;
  return (stack?.[stack.length - 1] as any).handle;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

const SAMPLE_CHAIN_ID = 42n;
const ADMIN_ID = "GADMIN1234567890123456789012345678901234567890123456789";

const fakeSample = {
  id: 1,
  chain_id: SAMPLE_CHAIN_ID,
  title: "T",
  ipfs_cid: "QmXgGPq5BPT1ahX4b1GnXQpG5rXm9a9a9a9a9a9a9a9a",
  uploader: "GA",
  genre: null,
  bpm: null,
  lease_price: null,
  premium_price: null,
  exclusive_price: null,
  is_exclusive: false,
  total_sales: 0,
  created_at: new Date(),
  updated_at: new Date(),
  moderation_status: "flagged" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /flags", () => {
  const handler = getHandler("/flags", "post");

  it("rejects an invalid body", async () => {
    const req = { body: { sampleId: -1, reason: "" } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("404s when the sample doesn't exist", async () => {
    vi.mocked(moderationRepo.createFlag).mockResolvedValue(null);
    const req = { body: { sampleId: "999", reason: "copyright" } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("creates a flag and returns it", async () => {
    const flag = { id: 1, sample_chain_id: SAMPLE_CHAIN_ID, reporter: null, reason: "copyright", status: "open" as const, resolution_note: null, reviewed_by: null, created_at: new Date(), reviewed_at: null };
    vi.mocked(moderationRepo.createFlag).mockResolvedValue({ flag, sample: fakeSample });
    const req = { body: { sampleId: "42", reason: "copyright" } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: flag });
  });
});

describe("POST /:id/review", () => {
  const handler = getHandler("/:id/review", "post");

  it("rejects an invalid id", async () => {
    const req = { params: { id: "not-a-number" }, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("409s when the sample isn't flagged", async () => {
    vi.mocked(moderationRepo.markUnderReview).mockResolvedValue(null);
    const req = { params: { id: "42" }, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("marks the sample under review", async () => {
    vi.mocked(moderationRepo.markUnderReview).mockResolvedValue({ ...fakeSample, moderation_status: "under_review" });
    const req = { params: { id: "42" }, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: expect.objectContaining({ moderation_status: "under_review" }) });
  });
});

describe("POST /:id/takedown", () => {
  const handler = getHandler("/:id/takedown", "post");

  it("409s when the sample can't be found or is already taken down", async () => {
    vi.mocked(moderationRepo.confirmTakedown).mockResolvedValue(null);
    const req = { params: { id: "42" }, body: {}, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("unpins the CID confirmTakedown actually returned, not a separately fetched one", async () => {
    // A CID that differs from fakeSample's own — proves the unpin call uses
    // confirmTakedown's UPDATE...RETURNING result, not some other snapshot,
    // which is what closes the race the reviewer flagged.
    const liveCid = "QmLiveCidAtTakedownTimeXXXXXXXXXXXXXXXXXXXXXX";
    vi.mocked(moderationRepo.confirmTakedown).mockResolvedValue({
      sample: { ...fakeSample, ipfs_cid: liveCid, moderation_status: "taken_down" },
      flagsResolved: 2,
    });
    vi.mocked(ipfsService.unpinFromIPFS).mockResolvedValue(undefined);

    const req = { params: { id: "42" }, body: { note: "confirmed infringement" }, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);

    expect(ipfsService.unpinFromIPFS).toHaveBeenCalledWith(liveCid);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, flagsResolved: 2, unpinned: true }),
    );
  });

  it("still confirms takedown in the DB even if the unpin call fails", async () => {
    vi.mocked(moderationRepo.confirmTakedown).mockResolvedValue({
      sample: { ...fakeSample, moderation_status: "taken_down" },
      flagsResolved: 1,
    });
    vi.mocked(ipfsService.unpinFromIPFS).mockRejectedValue(new Error("pinata down"));

    const req = { params: { id: "42" }, body: {}, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, unpinned: false }),
    );
  });
});

describe("POST /:id/dismiss", () => {
  const handler = getHandler("/:id/dismiss", "post");

  it("409s when the sample isn't flagged or under review", async () => {
    vi.mocked(moderationRepo.dismissFlags).mockResolvedValue(null);
    const req = { params: { id: "42" }, body: {}, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("dismisses open flags and returns the sample", async () => {
    vi.mocked(moderationRepo.dismissFlags).mockResolvedValue({
      sample: { ...fakeSample, moderation_status: "active" },
      flagsResolved: 1,
    });
    const req = { params: { id: "42" }, body: { note: "not infringing" }, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, flagsResolved: 1 }),
    );
  });
});

describe("GET /queue", () => {
  const handler = getHandler("/queue", "get");

  it("rejects a bad status filter", async () => {
    const req = { query: { status: "banana" }, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns the queue with pagination metadata", async () => {
    vi.mocked(moderationRepo.getModerationQueue).mockResolvedValue({
      data: [{ sample: fakeSample, openFlags: [] }],
      total: 1,
    });
    const req = { query: {}, user: { id: ADMIN_ID } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, total: 1, limit: 20, offset: 0 }),
    );
  });
});
