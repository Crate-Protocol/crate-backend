import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { withTimeout } from "../../utils/timeout.js";
import * as stellarService from "../../services/stellar.js";
import * as ipfsService from "../../services/ipfs.js";
import { analyticsRouter } from "../analytics.js";
import { ipfsRouter } from "../ipfs.js";
import type { Request, Response } from "express";

// Mock the services
vi.mock("../../services/stellar.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../services/stellar.js")>();
  return {
    ...original,
    getEarningsHistory: vi.fn(),
    getAccountBalance: vi.fn(),
  };
});

vi.mock("../../services/ipfs.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../services/ipfs.js")>();
  return {
    ...original,
    uploadToIPFS: vi.fn(),
  };
});

describe("Timeout Utility & Route Integration", () => {
  describe("withTimeout utility", () => {
    it("resolves when the promise resolves within the limit", async () => {
      const fn = async () => "success";
      const res = await withTimeout(fn, 100);
      expect(res).toBe("success");
    });

    it("rejects with TimeoutError when the promise takes too long", async () => {
      const fn = () => new Promise((resolve) => setTimeout(resolve, 200));
      await expect(withTimeout(fn, 50)).rejects.toThrow("TimeoutError");
    });
  });

  describe("Analytics routes timeout", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let statusMock: any;
    let jsonMock: any;

    beforeEach(() => {
      statusMock = vi.fn().mockReturnThis();
      jsonMock = vi.fn().mockReturnThis();
      mockRes = {
        status: statusMock,
        json: jsonMock,
      };
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    it("returns 503 on /earnings/:address timeout", async () => {
      mockReq = { params: { address: "GB3KJPLGUZMRM3SBNI644UGB6N4T3PZEXQLEJNX24K4YBNMQTRQL6BQA" } };
      
      // Setup mock to hang indefinitely
      vi.mocked(stellarService.getEarningsHistory).mockImplementation(
        () => new Promise(() => {})
      );

      // Trigger route handler directly
      const stack = analyticsRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/earnings/:address"
      )?.route?.stack;
      const handler = (stack?.[stack.length - 1] as any).handle;

      const p = handler(mockReq as Request, mockRes as Response);

      // Fast-forward timers to trigger the timeout
      vi.advanceTimersByTime(11_000);
      await p;

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        ok: false,
        error: "Service unavailable: request timed out",
      });
    });

    it("returns 503 on /balance/:address timeout", async () => {
      mockReq = { params: { address: "GB3KJPLGUZMRM3SBNI644UGB6N4T3PZEXQLEJNX24K4YBNMQTRQL6BQA" } };
      
      // Setup mock to hang indefinitely
      vi.mocked(stellarService.getAccountBalance).mockImplementation(
        () => new Promise(() => {})
      );

      const stack = analyticsRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/balance/:address"
      )?.route?.stack;
      const handler = (stack?.[stack.length - 1] as any).handle;

      const p = handler(mockReq as Request, mockRes as Response);

      vi.advanceTimersByTime(11_000);
      await p;

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        ok: false,
        error: "Service unavailable: request timed out",
      });
    });
  });

  describe("IPFS upload route timeout", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let statusMock: any;
    let jsonMock: any;

    beforeEach(() => {
      statusMock = vi.fn().mockReturnThis();
      jsonMock = vi.fn().mockReturnThis();
      mockRes = {
        status: statusMock,
        json: jsonMock,
      };
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    it("returns 503 on /upload timeout", async () => {
      mockReq = {
        file: {
          buffer: Buffer.from("test audio data"),
          originalname: "test.mp3",
          mimetype: "audio/mpeg",
          fieldname: "file",
          encoding: "7bit",
          size: 15,
          destination: "",
          filename: "",
          path: "",
          stream: null as any,
        },
      };

      vi.mocked(ipfsService.uploadToIPFS).mockImplementation(
        () => new Promise(() => {})
      );

      const stack = ipfsRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/upload"
      )?.route?.stack;
      const handler = (stack?.[stack.length - 1] as any).handle;

      const p = handler(mockReq as Request, mockRes as Response);

      vi.advanceTimersByTime(31_000);
      await p;

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        ok: false,
        error: "Service unavailable: request timed out",
      });
    });
  });
});
