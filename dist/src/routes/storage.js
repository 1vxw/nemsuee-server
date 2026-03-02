import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { buildGoogleConnectUrl, getAuthorizedDriveClient, getGoogleOAuthClient, storeGoogleTokens } from "../services/googleDrive.js";
const router = Router();
function getFrontendUrl() {
    return process.env.FRONTEND_URL || "http://localhost:5173";
}
function signState(userId) {
    return jwt.sign({ userId, type: "google-link" }, process.env.JWT_SECRET || "", { expiresIn: "10m" });
}
function parseState(state) {
    const decoded = jwt.verify(state, process.env.JWT_SECRET || "");
    if (decoded.type !== "google-link")
        throw new Error("invalid state");
    return decoded.userId;
}
router.get("/google/connect-url", requireAuth, async (req, res) => {
    try {
        const url = buildGoogleConnectUrl(signState(req.auth.userId));
        res.json({ url });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
router.get("/google/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
        return res.redirect(`${getFrontendUrl()}?drive=error`);
    }
    try {
        const userId = parseState(state);
        await storeGoogleTokens(userId, code);
        return res.redirect(`${getFrontendUrl()}?drive=connected`);
    }
    catch {
        return res.redirect(`${getFrontendUrl()}?drive=error`);
    }
});
router.get("/google/status", requireAuth, async (req, res) => {
    const connection = await prisma.googleDriveConnection.findUnique({ where: { userId: req.auth.userId } });
    res.json({ linked: !!connection, googleEmail: connection?.googleEmail || null });
});
router.get("/google/files", requireAuth, async (req, res) => {
    const linked = await getAuthorizedDriveClient(req.auth.userId);
    if (!linked)
        return res.status(404).json({ message: "Google Drive not linked" });
    const result = await linked.drive.files.list({
        pageSize: 20,
        fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
        q: "trashed=false"
    });
    return res.json(result.data.files || []);
});
const uploadSchema = z.object({
    name: z.string().min(1),
    content: z.string().min(1),
    mimeType: z.string().min(1).optional()
});
router.post("/google/upload", requireAuth, async (req, res) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const linked = await getAuthorizedDriveClient(req.auth.userId);
    if (!linked)
        return res.status(404).json({ message: "Google Drive not linked" });
    const created = await linked.drive.files.create({
        requestBody: { name: parsed.data.name },
        media: {
            mimeType: parsed.data.mimeType || "text/plain",
            body: Buffer.from(parsed.data.content, "utf8")
        },
        fields: "id,name,webViewLink"
    });
    res.status(201).json(created.data);
});
router.delete("/google/disconnect", requireAuth, async (req, res) => {
    const connection = await prisma.googleDriveConnection.findUnique({ where: { userId: req.auth.userId } });
    if (!connection)
        return res.status(204).send();
    try {
        const client = getGoogleOAuthClient();
        if (connection.accessToken)
            await client.revokeToken(connection.accessToken);
    }
    catch {
        // Ignore revoke failures; local unlink still proceeds.
    }
    await prisma.googleDriveConnection.delete({ where: { userId: req.auth.userId } });
    res.status(204).send();
});
export default router;
