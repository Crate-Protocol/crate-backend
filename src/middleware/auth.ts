import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function requireProducerAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  // If CRATE_API_KEY is configured, allow it as a bypass or minimum standard
  if (process.env.CRATE_API_KEY && token === process.env.CRATE_API_KEY) {
    (req as any).user = { id: "platform_api_key" };
    return next();
  }

  // Otherwise validate JWT
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized: Invalid API key" });
  }

  try {
    const payload = jwt.verify(token, secret) as any;
    (req as any).user = { id: payload.sub || payload.id || payload.uploader || "unknown" };
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}
