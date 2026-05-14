import { prisma } from "../db.js";

export type NotificationRole =
  | "STUDENT"
  | "INSTRUCTOR"
  | "GUEST"
  | "ADMIN"
  | "REGISTRAR"
  | "DEAN";
export type NotificationVisibility =
  | "PERSONAL"
  | "GLOBAL_STUDENTS"
  | "COURSE_INSTRUCTORS"
  | "GLOBAL_ALL";

export async function ensureNotificationsTable() {
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
  recipientRole?: NotificationRole | null;
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

export async function emitNotificationAction(input: {
  actionType: string;
  message: string;
  actorUserId: number;
  actorRole: NotificationRole;
  courseId?: number;
  sectionId?: number;
  visibility?: NotificationVisibility;
  targetUserId?: number;
}) {
  const visibility = input.visibility || "PERSONAL";
  await ensureNotificationsTable();

  await addNotification({
    actionType: input.actionType,
    message: input.message,
    actorUserId: input.actorUserId,
    recipientUserId: input.actorUserId,
    recipientRole: input.actorRole,
    courseId: input.courseId,
    sectionId: input.sectionId,
  });

  if (input.targetUserId && input.targetUserId !== input.actorUserId) {
    const target = await prisma.user.findUnique({
      where: { id: input.targetUserId },
      select: { role: true },
    });
    if (target) {
      await addNotification({
        actionType: input.actionType,
        message: input.message,
        actorUserId: input.actorUserId,
        recipientUserId: input.targetUserId,
        recipientRole: target.role as NotificationRole,
        courseId: input.courseId,
        sectionId: input.sectionId,
      });
    }
  }

  if (visibility === "GLOBAL_STUDENTS" || visibility === "GLOBAL_ALL") {
    if (input.courseId) {
      // Broadcast to enrolled students in a specific course
      const rows: Array<{ studentId: number }> = await prisma.enrollment.findMany({
        where: {
          courseId: input.courseId,
          status: "APPROVED",
          ...(input.sectionId ? { sectionId: input.sectionId } : {}),
        },
        select: { studentId: true },
      });
      const studentIds: number[] = Array.from(new Set(rows.map((r) => r.studentId)));
      for (const studentId of studentIds) {
        if (studentId === input.actorUserId) continue;
        await addNotification({
          actionType: input.actionType,
          message: input.message,
          actorUserId: input.actorUserId,
          recipientUserId: studentId,
          recipientRole: "STUDENT",
          courseId: input.courseId,
          sectionId: input.sectionId,
        });
      }
    } else {
      // Create a public notification for ALL students (role-based)
      await addNotification({
        actionType: input.actionType,
        message: input.message,
        actorUserId: input.actorUserId,
        recipientUserId: null,
        recipientRole: "STUDENT",
        courseId: null,
        sectionId: null,
      });
    }
  }

  if (visibility === "COURSE_INSTRUCTORS" || visibility === "GLOBAL_ALL") {
    if (input.courseId) {
      // Broadcast to instructors of a specific course
      const instructorRows = (await prisma.$queryRawUnsafe(
        `SELECT DISTINCT bi.instructorId
         FROM BlockInstructor bi
         JOIN Section s ON s.id = bi.sectionId
         WHERE s.courseId = ?`,
        input.courseId,
      )) as Array<{ instructorId: number }>;
      const instructorIds = Array.from(new Set(instructorRows.map((r) => r.instructorId)));
      for (const instructorId of instructorIds) {
        if (instructorId === input.actorUserId) continue;
        await addNotification({
          actionType: input.actionType,
          message: input.message,
          actorUserId: input.actorUserId,
          recipientUserId: instructorId,
          recipientRole: "INSTRUCTOR",
          courseId: input.courseId,
          sectionId: input.sectionId,
        });
      }
    } else if (visibility === "GLOBAL_ALL") {
      // Create a public notification for ALL instructors (role-based)
      await addNotification({
        actionType: input.actionType,
        message: input.message,
        actorUserId: input.actorUserId,
        recipientUserId: null,
        recipientRole: "INSTRUCTOR",
        courseId: null,
        sectionId: null,
      });
    }
  }

  if (visibility === "GLOBAL_ALL" && !input.courseId) {
    const allRoles: NotificationRole[] = ["ADMIN", "REGISTRAR", "DEAN", "GUEST"];
    for (const role of allRoles) {
      await addNotification({
        actionType: input.actionType,
        message: input.message,
        actorUserId: input.actorUserId,
        recipientUserId: null,
        recipientRole: role,
        courseId: null,
        sectionId: null,
      });
    }
  }
}