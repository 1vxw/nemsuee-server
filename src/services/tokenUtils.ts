import crypto from "node:crypto";

export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

