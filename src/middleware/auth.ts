import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../types/auth.js";
import { prisma } from "../db.js";

export const AUTH_COOKIE_NAME = "nemsuee_auth";

function getCookieToken(req: Request) {
  const raw = req.headers.cookie || "";
  const chunks = raw.split(";").map((p) => p.trim());
  const match = chunks.find((p) => p.startsWith(`${AUTH_COOKIE_NAME}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(AUTH_COOKIE_NAME.length + 1));
}

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = bearer || getCookieToken(req);

  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ message: "JWT secret is not configured" });
    const decoded = jwt.verify(token, secret) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });
    if (!user) return res.status(401).json({ message: "Invalid token" });
    req.auth = { userId: decoded.userId, role: user.role as JwtPayload["role"] };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

type AppRole = "STUDENT" | "INSTRUCTOR" | "ADMIN" | "REGISTRAR" | "DEAN";

function roleMatches(requiredRole: AppRole, actualRole?: string) {
  if (!actualRole) return false;
  if (requiredRole === "ADMIN") {
    return actualRole === "ADMIN" || actualRole === "REGISTRAR";
  }
  return actualRole === requiredRole;
}

export function requireRole(role: AppRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roleMatches(role, req.auth?.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export function requireAnyRole(roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const matched = roles.some((role) => roleMatches(role, req.auth?.role));
    if (!matched) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}
