import { google } from "googleapis";
import { prisma } from "../db.js";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function hasServiceAccountConfig() {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export function getGoogleDriveMode(): "service_account" | "oauth" {
  const explicit = (process.env.GOOGLE_DRIVE_MODE || "").trim().toLowerCase();
  if (explicit === "oauth") return "oauth";
  if (explicit === "service_account") return "service_account";
  return hasServiceAccountConfig() ? "service_account" : "oauth";
}

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    requireEnv("GOOGLE_REDIRECT_URI"),
  );
}

export function buildGoogleConnectUrl(state: string) {
  if (getGoogleDriveMode() === "service_account") {
    throw new Error("Google OAuth linking is disabled in service account mode");
  }
  const client = getGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  });
}

export async function storeGoogleTokens(userId: number, code: string) {
  if (getGoogleDriveMode() === "service_account") {
    throw new Error("OAuth token storage is disabled in service account mode");
  }
  const client = getGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();

  await prisma.googleDriveConnection.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || undefined,
      expiryDate:
        typeof tokens.expiry_date === "number"
          ? BigInt(tokens.expiry_date)
          : null,
      googleEmail: me.data.email || null,
    },
    create: {
      userId,
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || null,
      expiryDate:
        typeof tokens.expiry_date === "number"
          ? BigInt(tokens.expiry_date)
          : null,
      googleEmail: me.data.email || null,
    },
  });

  await ensureUserPersonalFolder(userId);
}

export async function getAuthorizedDriveClient(userId: number) {
  if (getGoogleDriveMode() === "service_account") {
    const auth = new google.auth.GoogleAuth({
      keyFile: requireEnv("GOOGLE_APPLICATION_CREDENTIALS"),
      scopes: [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    });
    const drive = google.drive({ version: "v3", auth });
    return { drive, connection: null as any, mode: "service_account" as const };
  }

  const connection = await prisma.googleDriveConnection.findUnique({
    where: { userId },
  });
  if (!connection) return null;

  const client = getGoogleOAuthClient();
  client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken || undefined,
    expiry_date: connection.expiryDate
      ? Number(connection.expiryDate)
      : undefined,
  });

  client.on("tokens", async (tokens) => {
    await prisma.googleDriveConnection.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token || connection.accessToken,
        refreshToken: tokens.refresh_token || connection.refreshToken || null,
        expiryDate:
          typeof tokens.expiry_date === "number"
            ? BigInt(tokens.expiry_date)
            : connection.expiryDate,
      },
    });
  });

  const drive = google.drive({ version: "v3", auth: client });
  const raw = (await prisma.$queryRawUnsafe(
    `SELECT personalFolderId FROM GoogleDriveConnection WHERE userId = ? LIMIT 1`,
    userId,
  )) as Array<{ personalFolderId: string | null }>;
  const personalFolderId = raw[0]?.personalFolderId || null;
  return { drive, connection, mode: "oauth" as const, personalFolderId };
}

export async function ensureUserPersonalFolder(userId: number) {
  if (getGoogleDriveMode() !== "oauth") return null;

  const linked = await getAuthorizedDriveClient(userId);
  if (!linked) return null;

  if (linked.personalFolderId) return linked.personalFolderId;

  const existing = await linked.drive.files.list({
    pageSize: 1,
    fields: "files(id,name)",
    q: "name='Personal Files' and mimeType='application/vnd.google-apps.folder' and trashed=false",
  });

  const folderId = existing.data.files?.[0]?.id;
  if (folderId) {
    await prisma.$executeRawUnsafe(
      `UPDATE GoogleDriveConnection SET personalFolderId = ? WHERE userId = ?`,
      folderId,
      userId,
    );
    return folderId;
  }

  const created = await linked.drive.files.create({
    requestBody: {
      name: "Personal Files",
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id,name",
  });

  const createdId = created.data.id || null;
  if (createdId) {
    await prisma.$executeRawUnsafe(
      `UPDATE GoogleDriveConnection SET personalFolderId = ? WHERE userId = ?`,
      createdId,
      userId,
    );
  }

  return createdId;
}
