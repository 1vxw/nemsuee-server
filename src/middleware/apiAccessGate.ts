import type { NextFunction, Request, Response } from "express";
import { getAdminSettings, verifyApiKey } from "../services/adminSettings.js";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function pickFirstHeader(value: string | string[] | undefined) {
  if (!value) return "";
  return Array.isArray(value) ? String(value[0] || "").trim() : value.trim();
}

function isTrustedWebRequest(req: Request, trustedOrigins: Set<string>) {
  if (!trustedOrigins.size) return false;
  const origin = pickFirstHeader(req.headers.origin as string | string[] | undefined);
  return Boolean(origin && trustedOrigins.has(normalizeOrigin(origin)));
}

function readApiKey(req: Request) {
  const direct = pickFirstHeader(req.headers["x-api-key"] as string | string[] | undefined);
  if (direct) return direct;
  const authorization = pickFirstHeader(
    req.headers.authorization as string | string[] | undefined,
  );
  if (!authorization) return "";
  if (authorization.startsWith("ApiKey ")) return authorization.slice(7).trim();
  return "";
}

export function createApiAccessGate(rawOrigins: string[]) {
  const trustedOrigins = new Set(
    rawOrigins.map((origin) => normalizeOrigin(origin)).filter(Boolean),
  );

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") return next();
    const settings = await getAdminSettings();
    const security = settings.api_security;

    if (!security.enabled) return next();
    if (isTrustedWebRequest(req, trustedOrigins)) return next();

    const key = readApiKey(req);
    if (key && security.key_hash && verifyApiKey(key, security.key_hash)) return next();

    return res.status(403).json({
      message: "Forbidden: request must originate from trusted website or include a valid API key.",
    });
  };
}
