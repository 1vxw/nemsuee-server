import { google } from "googleapis";
import { prisma } from "../db.js";
const SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly"
];
function requireEnv(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`${name} is not configured`);
    return value;
}
export function getGoogleOAuthClient() {
    return new google.auth.OAuth2(requireEnv("GOOGLE_CLIENT_ID"), requireEnv("GOOGLE_CLIENT_SECRET"), requireEnv("GOOGLE_REDIRECT_URI"));
}
export function buildGoogleConnectUrl(state) {
    const client = getGoogleOAuthClient();
    return client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        state,
        prompt: "consent"
    });
}
export async function storeGoogleTokens(userId, code) {
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
            expiryDate: typeof tokens.expiry_date === "number" ? BigInt(tokens.expiry_date) : null,
            googleEmail: me.data.email || null
        },
        create: {
            userId,
            accessToken: tokens.access_token || "",
            refreshToken: tokens.refresh_token || null,
            expiryDate: typeof tokens.expiry_date === "number" ? BigInt(tokens.expiry_date) : null,
            googleEmail: me.data.email || null
        }
    });
}
export async function getAuthorizedDriveClient(userId) {
    const connection = await prisma.googleDriveConnection.findUnique({ where: { userId } });
    if (!connection)
        return null;
    const client = getGoogleOAuthClient();
    client.setCredentials({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken || undefined,
        expiry_date: connection.expiryDate ? Number(connection.expiryDate) : undefined
    });
    client.on("tokens", async (tokens) => {
        await prisma.googleDriveConnection.update({
            where: { userId },
            data: {
                accessToken: tokens.access_token || connection.accessToken,
                refreshToken: tokens.refresh_token || connection.refreshToken || null,
                expiryDate: typeof tokens.expiry_date === "number" ? BigInt(tokens.expiry_date) : connection.expiryDate
            }
        });
    });
    const drive = google.drive({ version: "v3", auth: client });
    return { drive, connection };
}
