import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  ensureSettingsStorage,
  getAdminSettings,
  patchAdminSettings,
  revokeApiKey,
  rotateApiKey,
  sanitizeAdminSettingsForResponse,
  saveAdminSettings,
} from "../services/adminSettings.js";

const router = Router();
router.use(requireAuth);

router.get("/settings/public", async (_req, res) => {
  const settings = await getAdminSettings();
  return res.json({
    settings: {
      active_period: settings.active_period,
      hide_lms_sis_features: Boolean(settings.hide_lms_sis_features),
    },
  });
});

router.get("/settings", requireRole("ADMIN"), async (_req, res) => {
  await ensureSettingsStorage();
  const settings = await getAdminSettings();
  res.json({ settings: sanitizeAdminSettingsForResponse(settings) });
});

router.patch("/settings", requireRole("ADMIN"), async (req, res) => {
  await ensureSettingsStorage();
  const incoming =
    req.body?.settings && typeof req.body.settings === "object"
      ? req.body.settings
      : req.body && typeof req.body === "object"
        ? req.body
        : null;

  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ message: "settings object is required" });
  }

  const settings = await patchAdminSettings(incoming as Record<string, unknown>);
  res.json({ settings: sanitizeAdminSettingsForResponse(settings) });
});

router.patch("/settings/security", requireRole("ADMIN"), async (req, res) => {
  await ensureSettingsStorage();
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled boolean is required" });
  }

  const settings = await getAdminSettings({ forceFresh: true });
  settings.api_security = {
    ...settings.api_security,
    enabled,
  };
  const saved = await saveAdminSettings(settings);
  res.json({ settings: sanitizeAdminSettingsForResponse(saved) });
});

router.post("/settings/security/api-key/rotate", requireRole("ADMIN"), async (_req, res) => {
  await ensureSettingsStorage();
  const rotated = await rotateApiKey();
  const settings = await getAdminSettings({ forceFresh: true });
  res.json({
    apiKey: rotated.key,
    rotatedAt: rotated.rotatedAt,
    settings: sanitizeAdminSettingsForResponse(settings),
  });
});

router.post("/settings/security/api-key/revoke", requireRole("ADMIN"), async (_req, res) => {
  await ensureSettingsStorage();
  const settings = await revokeApiKey();
  res.json({ settings: sanitizeAdminSettingsForResponse(settings) });
});

export default router;
