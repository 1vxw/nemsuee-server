import { Router } from "express";
import { AUTH_COOKIE_NAME, requireAuth, requireRole } from "../middleware/auth.js";
import {
  accountStatusSchema,
  decisionSchema,
  forgotPasswordSchema,
  loginSchema,
  promoteSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../modules/auth/schemas.js";
import { signToken } from "../modules/auth/tokens.js";
import {
  getAccountActivationStatus,
  getInstructorApplications,
  getUserProfile,
  loginUser,
  promoteUserToAdmin,
  requestPasswordReset,
  registerUser,
  resendVerificationEmail,
  resetPasswordWithToken,
  reviewInstructorApplication,
  verifyEmailByToken,
} from "../modules/auth/auth.service.js";

const router = Router();

function getCookieOptions(req: any) {
  const host = String(req.hostname || "").toLowerCase();
  const isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local");
  const secure = !isLocalHost;
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const user = await registerUser(parsed.data);
    return res.status(201).json(user);
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const payload = await loginUser(parsed.data);
    res.cookie(AUTH_COOKIE_NAME, payload.token, getCookieOptions(req));
    return res.json({ user: payload.user });
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/verify-email", async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const result = await verifyEmailByToken(parsed.data.token);
    return res.json(result);
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/resend-verification", async (req, res) => {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const result = await resendVerificationEmail(parsed.data.email);
    return res.json(result);
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/account-status", async (req, res) => {
  const parsed = accountStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const result = await getAccountActivationStatus(parsed.data.email);
    return res.json(result);
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const result = await requestPasswordReset(parsed.data.email);
    return res.json(result);
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const result = await resetPasswordWithToken(
      parsed.data.token,
      parsed.data.password,
    );
    return res.json(result);
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/guest", async (req, res) => {
  try {
    const token = signToken({ userId: 0, role: "GUEST" });
    res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions(req));
    return res.json({
      user: {
        id: 0,
        fullName: "Guest",
        email: "guest@nemsu.edu",
        role: "GUEST",
        studentId: null,
      },
    });
  } catch (err) {
    return res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...getCookieOptions(req),
    maxAge: undefined,
  });
  res.status(204).send();
});

router.post("/promote-admin", async (req, res) => {
  const parsed = promoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const result = await promoteUserToAdmin(
      parsed.data.email,
      parsed.data.bootstrapKey,
    );
    res.json(result);
  } catch (err) {
    res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

router.get(
  "/instructor-applications",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    const rows = await getInstructorApplications();
    res.json(rows);
  },
);

router.patch(
  "/instructor-applications/:userId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    try {
      const result = await reviewInstructorApplication(
        userId,
        parsed.data.status,
        req.auth!.userId,
        parsed.data.note,
      );
      res.json(result);
    } catch (err) {
      res
        .status((err as any).status || 500)
        .json({ message: (err as Error).message });
    }
  },
);

router.get("/me", requireAuth, async (req, res) => {
  try {
    if (req.auth?.role === "GUEST") {
      return res.json({
        id: 0,
        fullName: "Guest",
        email: "guest@nemsu.edu",
        role: "GUEST",
        studentId: null,
      });
    }
    const user = await getUserProfile(req.auth!.userId);
    res.json(user);
  } catch (err) {
    res
      .status((err as any).status || 500)
      .json({ message: (err as Error).message });
  }
});

export default router;
