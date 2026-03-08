import { Router } from "express";
import authRoutes from "./auth.js";
import courseRoutes from "./courses.js";
import quizRoutes from "./quizzes.js";
import storageRoutes from "./storage.js";
import notificationRoutes from "./notifications.js";
import taskRoutes from "./tasks.js";
import gradeComputationRoutes from "./grade-computation.js";
import termRoutes from "./terms.js";
import adminSettingsRoutes from "./admin-settings.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => res.json({ ok: true }));
apiRouter.use("/auth", authRoutes);
apiRouter.use("/courses", courseRoutes);
apiRouter.use("/quizzes", quizRoutes);
apiRouter.use("/tasks", taskRoutes);
apiRouter.use("/grade-computation", gradeComputationRoutes);
apiRouter.use("/terms", termRoutes);
apiRouter.use("/admin", adminSettingsRoutes);
apiRouter.use("/storage", storageRoutes);
apiRouter.use("/notifications", notificationRoutes);
