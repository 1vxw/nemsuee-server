import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { apiRouter } from "./routes/index.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { createApiAccessGate } from "./middleware/apiAccessGate.js";

export const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.toLowerCase();
}

const envOrigins = (
  process.env.ALLOWED_ORIGINS ||
  process.env.FRONTEND_URL ||
  ""
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const devOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
      ];
const allowedOrigins = Array.from(
  new Set([...envOrigins, ...devOrigins].map((v) => normalizeOrigin(v))),
);
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && !allowedOrigins.length) {
  throw new Error(
    "ALLOWED_ORIGINS (or FRONTEND_URL) must be configured in production.",
  );
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(normalizeOrigin(origin)))
        return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }),
);
app.use(helmet());
app.use(
  morgan("dev", {
    skip: (req, res) => {
      const path = req.path || "";
      if (path === "/robots.txt" || path === "/sitemap.xml") return true;
      if (!path.startsWith("/api") && res.statusCode === 404) return true;
      return false;
    },
  }),
);
app.use(express.json({ limit: "25mb" }));

const apiLimiter = createRateLimiter({
  name: "api",
  windowMs: 10 * 60 * 1000,
  max: 1200,
});
const authLimiter = createRateLimiter({
  name: "auth",
  windowMs: 10 * 60 * 1000,
  max: 120,
});
const loginLimiter = createRateLimiter({
  name: "auth_login",
  windowMs: 10 * 60 * 1000,
  max: 30,
});
const registerLimiter = createRateLimiter({
  name: "auth_register",
  windowMs: 60 * 60 * 1000,
  max: 15,
});
const promoteAdminLimiter = createRateLimiter({
  name: "auth_promote_admin",
  windowMs: 60 * 60 * 1000,
  max: 5,
});
const accountStatusLimiter = createRateLimiter({
  name: "auth_account_status",
  windowMs: 10 * 60 * 1000,
  max: 20,
});

app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/auth/promote-admin", promoteAdminLimiter);
app.use("/api/auth/account-status", accountStatusLimiter);

// Optional: avoid 404 spam for common crawler endpoints.
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});
app.get("/sitemap.xml", (_req, res) => {
  res
    .type("application/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
    );
});
app.use((req, res, next) => {
  if (!unsafeMethods.has(req.method.toUpperCase())) return next();
  const origin = req.headers.origin as string | undefined;
  if (!origin) return next();
  if (allowedOrigins.includes(normalizeOrigin(origin)))
    return next();
  return res.status(403).json({ message: "CSRF blocked: untrusted origin." });
});

app.use("/api", createApiAccessGate(allowedOrigins), apiRouter);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if ((err as any)?.type === "entity.too.large") {
      return res
        .status(413)
        .json({ message: "Uploaded file is too large. Max payload is 25MB." });
    }
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  },
);
