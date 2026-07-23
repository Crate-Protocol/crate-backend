import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { requireProducerAuth, requireAdminAuth } from "../auth.js";

const JWT_SECRET = "test-secret";
const ADMIN_ADDR = "GADMIN1234567890123456789012345678901234567890123456789";
const USER_ADDR  = "GUSER1234567890123456789012345678901234567890123456789A";

function mockReqRes(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as unknown as Request;
  const statusMock = (code: number) => {
    res.statusCode = code;
    return res;
  };
  const jsonMock = (body: unknown) => {
    res.body = body;
    return res;
  };
  const res: any = { status: statusMock, json: jsonMock, statusCode: undefined, body: undefined };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next: next as any, wasNextCalled: () => nextCalled };
}

describe("requireProducerAuth / requireAdminAuth", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.CRATE_API_KEY = "platform-key-123";
    process.env.ADMIN_ADDRESSES = ADMIN_ADDR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("requireProducerAuth", () => {
    it("rejects a missing authorization header", () => {
      const { req, res, next, wasNextCalled } = mockReqRes(undefined);
      requireProducerAuth(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(401);
    });

    it("accepts the platform API key", () => {
      const { req, res, next, wasNextCalled } = mockReqRes("Bearer platform-key-123");
      requireProducerAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);
      expect((req as any).user.id).toBe("platform_api_key");
    });

    it("accepts a valid JWT and carries the subject through", () => {
      const token = jwt.sign({ sub: USER_ADDR }, JWT_SECRET);
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      requireProducerAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);
      expect((req as any).user.id).toBe(USER_ADDR);
    });

    it("rejects an invalid JWT", () => {
      const { req, res, next, wasNextCalled } = mockReqRes("Bearer not-a-real-token");
      requireProducerAuth(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(401);
    });
  });

  describe("requireAdminAuth", () => {
    it("rejects a missing authorization header with 401, not 403", () => {
      const { req, res, next, wasNextCalled } = mockReqRes(undefined);
      requireAdminAuth(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(401);
    });

    it("accepts the platform API key as admin", () => {
      const { req, res, next, wasNextCalled } = mockReqRes("Bearer platform-key-123");
      requireAdminAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);
    });

    it("accepts a JWT carrying an admin role claim", () => {
      const token = jwt.sign({ sub: USER_ADDR, role: "admin" }, JWT_SECRET);
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      requireAdminAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);
    });

    it("accepts a JWT whose subject is listed in ADMIN_ADDRESSES", () => {
      const token = jwt.sign({ sub: ADMIN_ADDR }, JWT_SECRET);
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      requireAdminAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);
    });

    it("rejects an authenticated non-admin with 403", () => {
      const token = jwt.sign({ sub: USER_ADDR }, JWT_SECRET);
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      requireAdminAuth(req, res, next);
      expect(wasNextCalled()).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });
});
