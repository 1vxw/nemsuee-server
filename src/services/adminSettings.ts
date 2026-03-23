import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";

type JsonObject = Record<string, unknown>;

export type ApiSecurityConfig = {
  enabled: boolean;
  key_hash: string | null;
  key_preview: string | null;
  key_last_rotated_at: string | null;
};

export type AdminSettings = JsonObject & {
  active_year: string;
  active_period: string;
  name: string;
  address: string;
  online_enrollment: string;
  campus: string;
  tpes_enabled: string;
  tpes_active_year: string;
  tpes_active_sem: string;
  hide_lms_sis_features: boolean;
  api_security: ApiSecurityConfig;
};

export const defaultSettings: AdminSettings = {
  active_year: "2025",
  active_period: "2",
  name: "North Eastern Mindanao State University",
  address: "tandag City, Surigao del Sur",
  online_enrollment:
    '{"enabled":false,"end_date":"2026-02-02","second_year":"2026-01-10","third_year":"2026-01-11","fourth_year":"2026-01-12","ifirst_year":"2026-01-12","isecond_year":"2026-01-12","ithird_year":"2026-01-12","ifourth_year":"2026-01-12","freshmen_enabled":true,"gs_enabled":true,"is_regular":false,"year_enabled":[],"iregular_enabled":[]}',
  campus: "cantilan",
  tpes_enabled: "1",
  tpes_active_year: "2025",
  tpes_active_sem: "1",
  hide_lms_sis_features: false,
  api_security: {
    enabled: false,
    key_hash: null,
    key_preview: null,
    key_last_rotated_at: null,
  },
};

let ensuredStorage: Promise<void> | null = null;
let cachedSettings: { expiresAt: number; value: AdminSettings } | null = null;

function getCacheTtlMs() {
  const raw = Number(process.env.ADMIN_SETTINGS_CACHE_TTL_MS || 30_000);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : 30_000;
}

function normalizeApiSecurity(value: unknown): ApiSecurityConfig {
  const payload = value && typeof value === "object" ? (value as JsonObject) : {};
  return {
    enabled: Boolean(payload.enabled),
    key_hash:
      typeof payload.key_hash === "string" && payload.key_hash.trim().length
        ? payload.key_hash
        : null,
    key_preview:
      typeof payload.key_preview === "string" && payload.key_preview.trim().length
        ? payload.key_preview
        : null,
    key_last_rotated_at:
      typeof payload.key_last_rotated_at === "string" &&
      payload.key_last_rotated_at.trim().length
        ? payload.key_last_rotated_at
        : null,
  };
}

function normalizeAdminSettings(value: unknown): AdminSettings {
  const payload = value && typeof value === "object" ? (value as JsonObject) : {};
  const merged = {
    ...defaultSettings,
    ...payload,
  } as AdminSettings;
  return {
    ...merged,
    hide_lms_sis_features: Boolean(merged.hide_lms_sis_features),
    active_period: String(merged.active_period || defaultSettings.active_period),
    api_security: normalizeApiSecurity((payload as JsonObject).api_security),
  };
}

function mergeSettings(current: AdminSettings, incoming: JsonObject): AdminSettings {
  const hasIncomingSecurity =
    typeof incoming.api_security === "object" && incoming.api_security !== null;
  const incomingSecurity = hasIncomingSecurity
    ? normalizeApiSecurity(incoming.api_security)
    : null;
  const merged = {
    ...current,
    ...incoming,
    hide_lms_sis_features: Boolean(
      incoming.hide_lms_sis_features ?? current.hide_lms_sis_features,
    ),
    api_security: hasIncomingSecurity
      ? {
          ...current.api_security,
          ...incomingSecurity,
          key_hash:
            incomingSecurity!.key_hash !== null
              ? incomingSecurity!.key_hash
              : current.api_security.key_hash,
          key_preview:
            incomingSecurity!.key_preview !== null
              ? incomingSecurity!.key_preview
              : current.api_security.key_preview,
          key_last_rotated_at:
            incomingSecurity!.key_last_rotated_at !== null
              ? incomingSecurity!.key_last_rotated_at
              : current.api_security.key_last_rotated_at,
        }
      : current.api_security,
  } as AdminSettings;
  return normalizeAdminSettings(merged);
}

export function sanitizeAdminSettingsForResponse(settings: AdminSettings) {
  return {
    ...settings,
    api_security: {
      enabled: Boolean(settings.api_security.enabled),
      has_key: Boolean(settings.api_security.key_hash),
      key_preview: settings.api_security.key_preview,
      key_last_rotated_at: settings.api_security.key_last_rotated_at,
    },
  };
}

export async function ensureSettingsStorage() {
  if (!ensuredStorage) {
    ensuredStorage = (async () => {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS AppSettings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      );

      const existing = (await prisma.$queryRawUnsafe(
        `SELECT id FROM AppSettings WHERE scope = 'admin' LIMIT 1`,
      )) as Array<{ id: number }>;

      if (!existing[0]) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO AppSettings (scope, payload) VALUES ('admin', ?)`,
          JSON.stringify(defaultSettings),
        );
      }
    })();
  }

  await ensuredStorage;
}

async function readSettingsFromStorage() {
  await ensureSettingsStorage();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT payload FROM AppSettings WHERE scope = 'admin' LIMIT 1`,
  )) as Array<{ payload: string }>;

  try {
    return normalizeAdminSettings(JSON.parse(rows[0]?.payload || "{}"));
  } catch {
    return normalizeAdminSettings(defaultSettings);
  }
}

export function invalidateAdminSettingsCache() {
  cachedSettings = null;
}

export async function getAdminSettings(options?: { forceFresh?: boolean }) {
  const forceFresh = Boolean(options?.forceFresh);
  if (!forceFresh && cachedSettings && cachedSettings.expiresAt > Date.now()) {
    return cachedSettings.value;
  }
  const settings = await readSettingsFromStorage();
  cachedSettings = {
    value: settings,
    expiresAt: Date.now() + getCacheTtlMs(),
  };
  return settings;
}

export async function saveAdminSettings(settings: AdminSettings) {
  await ensureSettingsStorage();
  const normalized = normalizeAdminSettings(settings);
  await prisma.$executeRawUnsafe(
    `UPDATE AppSettings SET payload = ?, updatedAt = CURRENT_TIMESTAMP WHERE scope = 'admin'`,
    JSON.stringify(normalized),
  );
  cachedSettings = {
    value: normalized,
    expiresAt: Date.now() + getCacheTtlMs(),
  };
  return normalized;
}

export async function patchAdminSettings(incoming: JsonObject) {
  const current = await getAdminSettings({ forceFresh: true });
  const merged = mergeSettings(current, incoming);
  return saveAdminSettings(merged);
}

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function maskApiKey(value: string) {
  const start = value.slice(0, 10);
  const end = value.slice(-6);
  return `${start}...${end}`;
}

export function createApiKey() {
  return `nemsu_live_${randomBytes(24).toString("base64url")}`;
}

export function verifyApiKey(rawKey: string, expectedHash: string) {
  if (!rawKey || !expectedHash) return false;
  const supplied = Buffer.from(hashApiKey(rawKey));
  const expected = Buffer.from(expectedHash);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export async function rotateApiKey() {
  const newKey = createApiKey();
  const now = new Date().toISOString();
  const settings = await getAdminSettings({ forceFresh: true });
  settings.api_security = {
    ...settings.api_security,
    enabled: true,
    key_hash: hashApiKey(newKey),
    key_preview: maskApiKey(newKey),
    key_last_rotated_at: now,
  };
  await saveAdminSettings(settings);
  return { key: newKey, rotatedAt: now };
}

export async function revokeApiKey() {
  const settings = await getAdminSettings({ forceFresh: true });
  settings.api_security = {
    ...settings.api_security,
    key_hash: null,
    key_preview: null,
    key_last_rotated_at: new Date().toISOString(),
  };
  await saveAdminSettings(settings);
  return settings;
}
