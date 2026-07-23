import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthUser {
  id: string;
  role?: string;
}

type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; error: string };

function authenticate(req: Request): AuthResult {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid authorization header" };
  }

  const token = authHeader.split(" ")[1];

  // If CRATE_API_KEY is configured, allow it as a bypass or minimum standard
  if (process.env.CRATE_API_KEY && token === process.env.CRATE_API_KEY) {
    return { ok: true, user: { id: "platform_api_key", role: "admin" } };
  }

  // Otherwise validate JWT
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return { ok: false, status: 401, error: "Unauthorized: Invalid API key" };
  }

  try {
    const payload = jwt.verify(token, secret) as any;
    return {
      ok: true,
      user: {
        id: payload.sub || payload.id || payload.uploader || "unknown",
        role: payload.role,
      },
    };
  } catch (err) {
    return { ok: false, status: 401, error: "Invalid token" };
  }
}

export function requireProducerAuth(req: Request, res: Response, next: NextFunction) {
  const result = authenticate(req);
  if (!result.ok) {
    return res.status(result.status).json({ ok: false, error: result.error });
  }
  (req as any).user = result.user;
  next();
}

// Admin status comes from either a "role": "admin" claim on the JWT, or the
// account being listed in ADMIN_ADDRESSES — the platform API key counts as
// admin too, since it's already the highest trust level this API has.
function isAdmin(user: AuthUser): boolean {
  if (user.role === "admin") return true;
  const adminAddresses = (process.env.ADMIN_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return adminAddresses.includes(user.id);
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const result = authenticate(req);
  if (!result.ok) {
    return res.status(result.status).json({ ok: false, error: result.error });
  }
  if (!isAdmin(result.user)) {
    return res.status(403).json({ ok: false, error: "Admin access required" });
  }
  (req as any).user = result.user;
  next();
}
