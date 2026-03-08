import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import {
  buildGoogleConnectUrl,
  ensureUserPersonalFolder,
  getAuthorizedDriveClient,
  getGoogleDriveMode,
  getGoogleOAuthClient,
  storeGoogleTokens,
} from "../services/googleDrive.js";
import {
  getFrontendUrl,
  shouldMakeUploadedFilesPublic,
} from "./storage/config.js";
import { parseState, signState } from "./storage/state.js";

const router = Router();

async function getUniqueUploadName(
  drive: any,
  folderId: string | null,
  desiredName: string,
) {
  const trimmed = desiredName.trim();
  const dotIdx = trimmed.lastIndexOf(".");
  const hasExt = dotIdx > 0 && dotIdx < trimmed.length - 1;
  const base = hasExt ? trimmed.slice(0, dotIdx) : trimmed;
  const ext = hasExt ? trimmed.slice(dotIdx) : "";

  const list = await drive.files.list({
    pageSize: 200,
    fields: "files(name)",
    q: folderId ? `'${folderId}' in parents and trashed=false` : "trashed=false",
  });
  const existing = new Set(
    (list.data.files || [])
      .map((f: any) => String(f?.name || "").toLowerCase())
      .filter(Boolean),
  );
  if (!existing.has(trimmed.toLowerCase())) return trimmed;

  let counter = 1;
  while (counter <= 5000) {
    const candidate = `${base} (${counter})${ext}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
    counter += 1;
  }
  return `${base}-${Date.now()}${ext}`;
}

router.get("/google/connect-url", requireAuth, async (req, res) => {
  try {
    if (getGoogleDriveMode() === "service_account") {
      return res.status(400).json({
        message:
          "Google Drive is configured via service account. Linking is not required.",
      });
    }
    const url = buildGoogleConnectUrl(signState(req.auth!.userId));
    res.json({ url });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

router.get("/google/callback", async (req, res) => {
  if (getGoogleDriveMode() === "service_account") {
    return res.redirect(`${getFrontendUrl()}?drive=connected`);
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    return res.redirect(`${getFrontendUrl()}?drive=error`);
  }

  try {
    const userId = parseState(state);
    await storeGoogleTokens(userId, code);
    return res.redirect(`${getFrontendUrl()}?drive=connected`);
  } catch {
    return res.redirect(`${getFrontendUrl()}?drive=error`);
  }
});

router.get("/google/status", requireAuth, async (req, res) => {
  if (getGoogleDriveMode() === "service_account") {
    return res.json({
      linked: true,
      mode: "service_account",
      googleEmail: null,
    });
  }

  const connection = await prisma.googleDriveConnection.findUnique({
    where: { userId: req.auth!.userId },
  });
  res.json({
    linked: !!connection,
    mode: "oauth",
    googleEmail: connection?.googleEmail || null,
  });
});

router.get("/google/files", requireAuth, async (req, res) => {
  const linked = await getAuthorizedDriveClient(req.auth!.userId);
  if (!linked)
    return res.status(404).json({ message: "Google Drive not linked" });
  const folderId =
    linked.mode === "oauth"
      ? await ensureUserPersonalFolder(req.auth!.userId)
      : process.env.GOOGLE_DRIVE_FOLDER_ID || null;

  const result = await linked.drive.files.list({
    pageSize: 20,
    fields:
      "files(id,name,mimeType,webViewLink,webContentLink,modifiedTime,size)",
    q: folderId
      ? `'${folderId}' in parents and trashed=false`
      : "trashed=false",
  });

  return res.json(result.data.files || []);
});

const uploadSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1).optional(),
  contentBase64: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
});

router.post(
  "/google/upload",
  requireAuth,
  async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const linked = await getAuthorizedDriveClient(req.auth!.userId);
  if (!linked)
    return res.status(404).json({ message: "Google Drive not linked" });
  const folderId =
    linked.mode === "oauth"
      ? await ensureUserPersonalFolder(req.auth!.userId)
      : process.env.GOOGLE_DRIVE_FOLDER_ID || null;

  try {
    const safeName = await getUniqueUploadName(
      linked.drive,
      folderId,
      parsed.data.name,
    );
    const created = await linked.drive.files.create({
      requestBody: {
        name: safeName,
        parents: folderId ? [folderId] : undefined,
      },
      media: {
        mimeType: parsed.data.mimeType || "text/plain",
        body: Readable.from(
          parsed.data.contentBase64
            ? Buffer.from(parsed.data.contentBase64, "base64")
            : Buffer.from(parsed.data.content || "", "utf8"),
        ),
      },
      fields: "id,name,webViewLink,webContentLink,mimeType,modifiedTime,size",
    });

    if (created.data.id && shouldMakeUploadedFilesPublic()) {
      await linked.drive.permissions.create({
        fileId: created.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
          allowFileDiscovery: false,
        },
      });
    }

    res.status(201).json(created.data);
  } catch (err: any) {
    const driveMessage = String(
      err?.response?.data?.error?.message ||
        err?.cause?.message ||
        err?.message ||
        "",
    );

    if (driveMessage.includes("Service Accounts do not have storage quota")) {
      return res.status(403).json({
        message:
          "Service account uploads require a Shared Drive or OAuth-linked personal Google account.",
      });
    }

    throw err;
  }
},
);

router.delete(
  "/google/files/:id",
  requireAuth,
  requireAnyRole(["INSTRUCTOR", "ADMIN", "REGISTRAR", "DEAN"]),
  async (req, res) => {
    const fileId = String(req.params.id || "").trim();
    if (!fileId) return res.status(400).json({ message: "Invalid file id" });

    const linked = await getAuthorizedDriveClient(req.auth!.userId);
    if (!linked) {
      return res.status(404).json({ message: "Google Drive not linked" });
    }

    await linked.drive.files.delete({ fileId });
    res.status(204).send();
  },
);

router.delete("/google/disconnect", requireAuth, async (req, res) => {
  if (getGoogleDriveMode() === "service_account") {
    return res.status(204).send();
  }

  const connection = await prisma.googleDriveConnection.findUnique({
    where: { userId: req.auth!.userId },
  });
  if (!connection) return res.status(204).send();

  try {
    const client = getGoogleOAuthClient();
    if (connection.accessToken)
      await client.revokeToken(connection.accessToken);
  } catch {
    // Ignore revoke failures; local unlink still proceeds.
  }

  await prisma.googleDriveConnection.delete({
    where: { userId: req.auth!.userId },
  });
  res.status(204).send();
});

export default router;
