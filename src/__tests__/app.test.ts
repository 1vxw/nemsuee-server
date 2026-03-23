import request from "supertest";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../db.js", () => ({
  prisma: prismaMock,
}));

import { app } from "../app.js";
import { invalidateAdminSettingsCache } from "../services/adminSettings.js";

describe("API", () => {
  let apiSecurityPayload: { api_security: { enabled: boolean; key_hash: string | null } } = {
    api_security: { enabled: false, key_hash: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-secret";
    invalidateAdminSettingsCache();
    prismaMock.$queryRawUnsafe.mockImplementation((query: string) => {
      if (String(query).includes("SELECT id FROM AppSettings")) return [{ id: 1 }];
      if (String(query).includes("SELECT payload FROM AppSettings")) {
        return [
          {
            payload: JSON.stringify(apiSecurityPayload),
          },
        ];
      }
      return [];
    });
    apiSecurityPayload = {
      api_security: { enabled: false, key_hash: null },
    };
  });

  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /api/auth/register validates payload", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "A",
      email: "invalid",
      password: "123",
      role: "STUDENT",
    });

    expect(res.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("POST /api/auth/login returns 401 for unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/login").send({
      email: "nouser@test.com",
      password: "password",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("blocks requests when API gate is enabled and request is untrusted", async () => {
    const hash = createHash("sha256").update("test-key").digest("hex");
    apiSecurityPayload = {
      api_security: { enabled: true, key_hash: hash },
    };
    const res = await request(app).post("/api/auth/register").send({
      fullName: "A",
      email: "invalid",
      password: "123",
      role: "STUDENT",
    });
    expect(res.status).toBe(403);
  });

  it("allows trusted-origin requests when API gate is enabled", async () => {
    const hash = createHash("sha256").update("test-key").digest("hex");
    apiSecurityPayload = {
      api_security: { enabled: true, key_hash: hash },
    };
    const res = await request(app)
      .post("/api/auth/register")
      .set("origin", "http://localhost:5173")
      .send({
        fullName: "A",
        email: "invalid",
        password: "123",
        role: "STUDENT",
      });
    expect(res.status).toBe(400);
  });

  it("allows valid API key when API gate is enabled", async () => {
    const hash = createHash("sha256").update("test-key").digest("hex");
    apiSecurityPayload = {
      api_security: { enabled: true, key_hash: hash },
    };
    const res = await request(app)
      .post("/api/auth/register")
      .set("x-api-key", "test-key")
      .send({
        fullName: "A",
        email: "invalid",
        password: "123",
        role: "STUDENT",
      });
    expect(res.status).toBe(400);
  });
});
