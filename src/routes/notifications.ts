import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessCourse } from "../modules/courses/access.js";

const router = Router();
router.use(requireAuth);

const createActionSchema = z.object({
  actionType: z.string().trim().min(2).max(80),
  message: z.string().trim().min(1).max(1000),
  courseId: z.number().int().positive().optional(),
  sectionId: z.number().int().positive().optional(),
  visibility: z
    .enum(["PERSONAL", "GLOBAL_STUDENTS", "COURSE_INSTRUCTORS", "GLOBAL_ALL"])
    .default("PERSONAL"),
  targetUserId: z.number().int().positive().optional(),
});

async function ensureNotificationsTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS NotificationEvent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actionType TEXT NOT NULL,
      message TEXT NOT NULL,
      actorUserId INTEGER NOT NULL,
      recipientUserId INTEGER,
      recipientRole TEXT,
      courseId INTEGER,
      sectionId INTEGER,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

async function addNotification(input: {
  actionType: string;
  message: string;
  actorUserId: number;
  recipientUserId?: number | null;
  recipientRole?:
    | "STUDENT"
    | "INSTRUCTOR"
    | "ADMIN"
    | "REGISTRAR"
    | "DEAN"
    | null;
  courseId?: number | null;
  sectionId?: number | null;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO NotificationEvent (
      actionType, message, actorUserId, recipientUserId, recipientRole, courseId, sectionId
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.actionType,
    input.message,
    input.actorUserId,
    input.recipientUserId ?? null,
    input.recipientRole ?? null,
    input.courseId ?? null,
    input.sectionId ?? null,
  );
}

router.post("/actions", async (req, res) => {
  const parsed = createActionSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const actorUserId = req.auth!.userId;
  const actorRole = req.auth!.role;
  const data = parsed.data;

  if (data.courseId) {
    const allowed =
      actorRole === "ADMIN" || (await canAccessCourse(actorUserId, data.courseId));
    if (!allowed) return res.status(403).json({ message: "Forbidden" });
  }

  await ensureNotificationsTable();

  // Every action is always recorded to actor's personal notifications.
  await addNotification({
    actionType: data.actionType,
    message: data.message,
    actorUserId,
    recipientUserId: actorUserId,
    recipientRole: actorRole,
    courseId: data.courseId,
    sectionId: data.sectionId,
  });

  // Optional explicit personal target.
  if (data.targetUserId && data.targetUserId !== actorUserId) {
    const target = await prisma.user.findUnique({
      where: { id: data.targetUserId },
      select: { role: true },
    });
    if (target) {
      await addNotification({
        actionType: data.actionType,
        message: data.message,
        actorUserId,
        recipientUserId: data.targetUserId,
        recipientRole: target.role as
          | "STUDENT"
          | "INSTRUCTOR"
          | "ADMIN"
          | "REGISTRAR"
          | "DEAN",
        courseId: data.courseId,
        sectionId: data.sectionId,
      });
    }
  }

  // Global/broadcast handling.
  if (data.visibility === "GLOBAL_STUDENTS" || data.visibility === "GLOBAL_ALL") {
    // Broadcast to students only when action is related to a course.
    if (data.courseId) {
      const rows: Array<{ studentId: number }> = await prisma.enrollment.findMany({
        where: { courseId: data.courseId, status: "APPROVED" },
        select: { studentId: true },
      });
      const studentIds: number[] = Array.from(new Set(rows.map((r) => r.studentId)));
      for (const studentId of studentIds) {
        if (studentId === actorUserId) continue;
        await addNotification({
          actionType: data.actionType,
          message: data.message,
          actorUserId,
          recipientUserId: studentId,
          recipientRole: "STUDENT",
          courseId: data.courseId,
          sectionId: data.sectionId,
        });
      }
    }
  }

  if (data.visibility === "COURSE_INSTRUCTORS" || data.visibility === "GLOBAL_ALL") {
    if (data.courseId) {
      const instructorRows = (await prisma.$queryRawUnsafe(
        `SELECT DISTINCT bi.instructorId
         FROM BlockInstructor bi
         JOIN Section s ON s.id = bi.sectionId
         WHERE s.courseId = ?`,
        data.courseId,
      )) as Array<{ instructorId: number }>;
      const instructorIds = Array.from(
        new Set(instructorRows.map((r) => r.instructorId)),
      );
      for (const instructorId of instructorIds) {
        if (instructorId === actorUserId) continue;
        await addNotification({
          actionType: data.actionType,
          message: data.message,
          actorUserId,
          recipientUserId: instructorId,
          recipientRole: "INSTRUCTOR",
          courseId: data.courseId,
          sectionId: data.sectionId,
        });
      }
    }
  }

  const inserted = (await prisma.$queryRawUnsafe(
    `SELECT id, actionType, message, actorUserId, recipientUserId, recipientRole, courseId, sectionId, isRead, createdAt
     FROM NotificationEvent
     WHERE recipientUserId = ?
     ORDER BY id DESC
     LIMIT 1`,
    actorUserId,
  )) as Array<Record<string, unknown>>;

  return res.status(201).json(inserted[0] || null);
});

router.get("/me", async (req, res) => {
  await ensureNotificationsTable();
  const userId = req.auth!.userId;
  const role = req.auth!.role;

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, actionType, message, actorUserId, recipientUserId, recipientRole, courseId, sectionId, isRead, createdAt
     FROM NotificationEvent
     WHERE recipientUserId = ?
        OR (recipientUserId IS NULL AND recipientRole = ?)
     ORDER BY datetime(createdAt) DESC, id DESC
     LIMIT 200`,
    userId,
    role,
  )) as Array<Record<string, unknown>>;

  return res.json(rows);
});

router.patch("/read-all", async (req, res) => {
  await ensureNotificationsTable();
  const userId = req.auth!.userId;
  const role = req.auth!.role;

  await prisma.$executeRawUnsafe(
    `UPDATE NotificationEvent
     SET isRead = 1
     WHERE recipientUserId = ?
        OR (recipientUserId IS NULL AND recipientRole = ?)`,
    userId,
    role,
  );

  return res.json({ ok: true, isRead: true });
});

router.delete("/clear", async (req, res) => {
  await ensureNotificationsTable();
  const userId = req.auth!.userId;

  await prisma.$executeRawUnsafe(
    `DELETE FROM NotificationEvent
     WHERE recipientUserId = ?`,
    userId,
  );

  return res.json({ ok: true });
});

router.patch("/:id/read", async (req, res) => {
  await ensureNotificationsTable();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

  const row = (await prisma.$queryRawUnsafe(
    `SELECT id, recipientUserId FROM NotificationEvent WHERE id = ? LIMIT 1`,
    id,
  )) as Array<{ id: number; recipientUserId: number | null }>;
  if (!row[0]) return res.status(404).json({ message: "Notification not found" });
  if (row[0].recipientUserId && row[0].recipientUserId !== req.auth!.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE NotificationEvent SET isRead = 1 WHERE id = ?`,
    id,
  );
  return res.json({ id, isRead: true });
});

export default router;
