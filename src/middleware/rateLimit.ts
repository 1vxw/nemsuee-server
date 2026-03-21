import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  skip?: (req: Request) => boolean;
  keyGenerator?: (req: Request) => string;
};

type Bucket = { count: number; resetAt: number; lastSeen: number };

const bucketsByName = new Map<string, Map<string, Bucket>>();

function getClientIp(req: Request) {
  const ip = (req.ip || "").trim();
  return ip || "unknown";
}

export function createRateLimiter(options: RateLimitOptions) {
  const {
    name,
    windowMs,
    max,
    skip = (req) => req.method.toUpperCase() === "OPTIONS",
    keyGenerator = (req) => getClientIp(req),
  } = options;

  if (!bucketsByName.has(name)) bucketsByName.set(name, new Map());
  const store = bucketsByName.get(name)!;

  // Best-effort cleanup: keep memory bounded.
  const maxEntries = 20_000;
  const gcBatch = 200;

  function maybeGc(now: number) {
    if (store.size <= maxEntries) return;
    let scanned = 0;
    for (const [key, bucket] of store.entries()) {
      // Remove entries idle for > 4 windows.
      if (now - bucket.lastSeen > windowMs * 4) store.delete(key);
      scanned += 1;
      if (scanned >= gcBatch) break;
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    if (skip(req)) return next();

    const key = keyGenerator(req);
    const now = Date.now();
    const existing = store.get(key);

    if (!existing || now >= existing.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs, lastSeen: now });
      res.setHeader("RateLimit-Limit", String(max));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, max - 1)));
      res.setHeader("RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));
      maybeGc(now);
      return next();
    }

    existing.lastSeen = now;
    existing.count += 1;

    const remaining = Math.max(0, max - existing.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(existing.resetAt / 1000)));

    if (existing.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        message: "Too many requests. Please try again later.",
      });
    }

    maybeGc(now);
    return next();
  };
}

