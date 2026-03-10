import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../db.js";

const router = Router();
router.use(requireAuth);

const defaultSettings = {
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
};

async function ensureSettingsStorage() {
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
}

router.get("/settings/public", async (_req, res) => {
  await ensureSettingsStorage();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT payload FROM AppSettings WHERE scope = 'admin' LIMIT 1`,
  )) as Array<{ payload: string }>;
  let settings = defaultSettings;
  try {
    if (rows[0]?.payload) settings = JSON.parse(rows[0].payload);
  } catch {
    settings = defaultSettings;
  }
  return res.json({
    settings: {
      active_period: settings.active_period,
      hide_lms_sis_features: Boolean(
        (settings as Record<string, unknown>).hide_lms_sis_features,
      ),
    },
  });
});

router.get("/settings", requireRole("ADMIN"), async (_req, res) => {
  await ensureSettingsStorage();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT payload FROM AppSettings WHERE scope = 'admin' LIMIT 1`,
  )) as Array<{ payload: string }>;
  let settings = defaultSettings;
  try {
    if (rows[0]?.payload) settings = JSON.parse(rows[0].payload);
  } catch {
    settings = defaultSettings;
  }
  res.json({ settings });
});

router.patch("/settings", requireRole("ADMIN"), async (req, res) => {
  await ensureSettingsStorage();
  const settings =
    req.body?.settings && typeof req.body.settings === "object"
      ? req.body.settings
      : req.body && typeof req.body === "object"
        ? req.body
        : null;
  if (!settings || typeof settings !== "object") {
    return res.status(400).json({ message: "settings object is required" });
  }
  await prisma.$executeRawUnsafe(
    `UPDATE AppSettings SET payload = ?, updatedAt = CURRENT_TIMESTAMP WHERE scope = 'admin'`,
    JSON.stringify(settings),
  );
  res.json({ settings });
});

export default router;
