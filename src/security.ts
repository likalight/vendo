/** Admin auth for dashboard/treasury APIs and simple per-IP rate limiting for public endpoints. */
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

const PUBLIC_READ = new Set(["/vendo/api/config", "/vendo/api/businesses", "/vendo/api/insights", "/vendo/api/sales"]);

function tokenOk(given: string | undefined, expected: string | undefined) {
  if (!expected || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Protects everything under /vendo/api except a few read-only endpoints used by the public proof page. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.VENDO_ADMIN_TOKEN;
  if (!expected) {
    if (process.env.VENDO_OFFLINE === "1" || process.env.NODE_ENV !== "production") return next();
    return res.status(503).json({ errors: ["Set VENDO_ADMIN_TOKEN before running in production"] });
  }
  if (req.method === "GET" && PUBLIC_READ.has(req.baseUrl + req.path)) return next();
  const given = req.header("x-vendo-admin") ?? (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (tokenOk(given, expected)) return next();
  res.status(401).json({ errors: ["Admin token required"] });
}

/** Assist spends a buyer wallet, so running tasks needs the Assist token (or admin token). */
export function requireAssist(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.VENDO_ASSIST_TOKEN || process.env.VENDO_ADMIN_TOKEN;
  if (!expected && (process.env.VENDO_OFFLINE === "1" || process.env.NODE_ENV !== "production")) return next();
  const given = req.header("x-vendo-assist") ?? req.header("x-vendo-admin");
  if (tokenOk(given, process.env.VENDO_ASSIST_TOKEN) || tokenOk(given, process.env.VENDO_ADMIN_TOKEN)) return next();
  res.status(401).json({ errors: ["Assist token required"] });
}

const buckets = new Map<string, { tokens: number; at: number }>();
export function rateLimit(perMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl || req.path.split("/").slice(0, 3).join("/")}:${perMinute}`;
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    if (b.tokens < 1) { res.setHeader("retry-after", "10"); return res.status(429).json({ errors: ["Too many requests"] }); }
    b.tokens -= 1; buckets.set(key, b);
    if (buckets.size > 50_000) buckets.clear();
    next();
  };
}
