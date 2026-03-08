import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessCourse, canAccessSection } from "../modules/courses/access.js";
import { emitNotificationAction } from "../services/notifications.js";

const router = Router();
router.use(requireAuth);

async function ensureTasksTables() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS CourseTask (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL,
      sectionId INTEGER NOT NULL,
      instructorId INTEGER NOT NULL,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      fileUrl TEXT,
      allowStudentResubmit INTEGER NOT NULL DEFAULT 1,
      dueAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE CourseTask ADD COLUMN allowStudentResubmit INTEGER NOT NULL DEFAULT 1`,
    );
  } catch {
    // column already exists
  }

  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS TaskSubmission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      answerText TEXT,
      fileUrl TEXT,
      grade REAL,
      feedback TEXT,
      gradedBy INTEGER,
      gradedAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(taskId, studentId)
    )`,
  );
}

router.get("/course/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const kind = String(req.query.kind || "ASSIGNMENT").toUpperCase();
  if (!["ASSIGNMENT", "ACTIVITY"].includes(kind)) {
    return res.status(400).json({ message: "Invalid kind" });
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return res.status(404).json({ message: "Course not found" });

  let allowedSectionIds: number[] = [];
  let studentId: number | null = null;

  if (req.auth!.role === "INSTRUCTOR") {
    if (!(await canAccessCourse(req.auth!.userId, courseId))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const sectionRows = (await prisma.$queryRawUnsafe(
      `SELECT sectionId FROM BlockInstructor WHERE instructorId = ?`,
      req.auth!.userId,
    )) as Array<{ sectionId: number }>;
    allowedSectionIds = sectionRows.map((r) => r.sectionId);
  } else if (req.auth!.role === "STUDENT") {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        courseId_studentId: { courseId, studentId: req.auth!.userId },
      },
    });
    if (!enrollment || enrollment.status !== "APPROVED" || !enrollment.sectionId) {
      return res.status(403).json({ message: "Not enrolled" });
    }
    allowedSectionIds = [enrollment.sectionId];
    studentId = req.auth!.userId;
  } else {
    return res.json([]);
  }

  await ensureTasksTables();
  const placeholders =
    allowedSectionIds.map(() => "CAST(? AS TEXT)").join(", ") || "'-1'";
  const tasks = (await prisma.$queryRawUnsafe(
    `SELECT t.id, t.courseId, t.sectionId, t.kind, t.mode, t.title, t.description, t.fileUrl, t.allowStudentResubmit,
            CAST(t.dueAt AS TEXT) as dueAt,
            CAST(t.createdAt AS TEXT) as createdAt,
            s.name as sectionName
     FROM CourseTask t
     JOIN Section s ON CAST(s.id AS TEXT) = CAST(t.sectionId AS TEXT)
     WHERE CAST(t.courseId AS TEXT) = CAST(? AS TEXT) AND t.kind = ? AND CAST(t.sectionId AS TEXT) IN (${placeholders})
     ORDER BY t.createdAt DESC, t.id DESC`,
    courseId,
    kind,
    ...allowedSectionIds,
  )) as Array<any>;

  const taskIds = tasks.map((t) => t.id);
  if (!taskIds.length) return res.json([]);

  const subPlaceholders = taskIds.map(() => "?").join(", ");
  const submissions = (await prisma.$queryRawUnsafe(
    `SELECT ts.id, ts.taskId, ts.studentId, ts.answerText, ts.fileUrl, ts.grade, ts.feedback, ts.gradedBy,
            CAST(ts.gradedAt AS TEXT) as gradedAt,
            CAST(ts.createdAt AS TEXT) as createdAt,
            CAST(ts.updatedAt AS TEXT) as updatedAt,
            u.fullName as studentName, u.email as studentEmail
     FROM TaskSubmission ts
     JOIN User u ON u.id = ts.studentId
     WHERE ts.taskId IN (${subPlaceholders})`,
    ...taskIds,
  )) as Array<any>;

  const byTask = new Map<number, any[]>();
  for (const s of submissions) {
    const list = byTask.get(s.taskId) || [];
    list.push(s);
    byTask.set(s.taskId, list);
  }

  const data = tasks.map((t) => {
    const taskSubs = byTask.get(t.id) || [];
    const gradedCount = taskSubs.filter((x) => x.grade !== null && x.grade !== undefined).length;
    return {
      ...t,
      submissionCount: taskSubs.length,
      gradedCount,
      mySubmission: studentId ? taskSubs.find((x) => x.studentId === studentId) || null : null,
      submissions: req.auth!.role === "INSTRUCTOR" ? taskSubs : undefined,
    };
  });

  res.json(data);
});

router.post("/course/:courseId/sections/:sectionId", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const sectionId = Number(req.params.sectionId);
  const {
    kind,
    mode,
    title,
    description,
    fileUrl,
    dueAt,
    allowStudentResubmit,
  } = req.body || {};

  if (!["ASSIGNMENT", "ACTIVITY"].includes(String(kind))) {
    return res.status(400).json({ message: "Invalid kind" });
  }
  if (!["MANUAL", "FILE"].includes(String(mode))) {
    return res.status(400).json({ message: "Invalid mode" });
  }
  if (!String(title || "").trim()) {
    return res.status(400).json({ message: "Title is required" });
  }
  if (!(await canAccessSection(req.auth!.userId, sectionId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!section || section.courseId !== courseId) {
    return res.status(400).json({ message: "Invalid section" });
  }

  await ensureTasksTables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO CourseTask (courseId, sectionId, instructorId, kind, mode, title, description, fileUrl, allowStudentResubmit, dueAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    courseId,
    sectionId,
    req.auth!.userId,
    String(kind),
    String(mode),
    String(title).trim(),
    description ? String(description) : null,
    fileUrl ? String(fileUrl) : null,
    allowStudentResubmit === false ? 0 : 1,
    dueAt ? String(dueAt) : null,
  );

  const created = (await prisma.$queryRawUnsafe(
    `SELECT t.id, t.courseId, t.sectionId, t.kind, t.mode, t.title, t.description, t.fileUrl, t.allowStudentResubmit,
            CAST(t.dueAt AS TEXT) as dueAt,
            CAST(t.createdAt AS TEXT) as createdAt,
            s.name as sectionName
     FROM CourseTask t
     JOIN Section s ON CAST(s.id AS TEXT) = CAST(t.sectionId AS TEXT)
     WHERE CAST(t.id AS TEXT) = CAST(last_insert_rowid() AS TEXT)`,
  )) as Array<any>;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  await emitNotificationAction({
    actionType: kind === "ASSIGNMENT" ? "ASSIGNMENT_CREATED" : "ACTIVITY_CREATED",
    message: `Posted ${String(kind).toLowerCase()} "${String(title).trim()}" in "${course?.title || "Course"} / ${created[0]?.sectionName || `Block ${sectionId}`}".`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId,
    sectionId,
    visibility: "GLOBAL_STUDENTS",
  });

  res.status(201).json(created[0]);
});

router.get("/:taskId", async (req, res) => {
  const taskId = Number(req.params.taskId);
  await ensureTasksTables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT t.id, t.courseId, t.sectionId, t.instructorId, t.kind, t.mode, t.title, t.description, t.fileUrl, t.allowStudentResubmit,
            CAST(t.dueAt AS TEXT) as dueAt,
            CAST(t.createdAt AS TEXT) as createdAt,
            s.name as sectionName
     FROM CourseTask t
     JOIN Section s ON s.id = t.sectionId
     WHERE t.id = ?`,
    taskId,
  )) as Array<any>;
  const task = rows[0];
  if (!task) return res.status(404).json({ message: "Task not found" });

  if (req.auth!.role === "INSTRUCTOR") {
    if (!(await canAccessSection(req.auth!.userId, task.sectionId))) {
      return res.status(403).json({ message: "Forbidden" });
    }
  } else if (req.auth!.role === "STUDENT") {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        courseId_studentId: { courseId: task.courseId, studentId: req.auth!.userId },
      },
    });
    if (!enrollment || enrollment.status !== "APPROVED" || enrollment.sectionId !== task.sectionId) {
      return res.status(403).json({ message: "Task not available for your block" });
    }
  }
  res.json(task);
});

router.patch("/:taskId", requireRole("INSTRUCTOR"), async (req, res) => {
  const taskId = Number(req.params.taskId);
  const { title, description, dueAt, mode, fileUrl, allowStudentResubmit } = req.body || {};
  await ensureTasksTables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, sectionId FROM CourseTask WHERE id = ?`,
    taskId,
  )) as Array<any>;
  const task = rows[0];
  if (!task) return res.status(404).json({ message: "Task not found" });
  if (!(await canAccessSection(req.auth!.userId, task.sectionId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE CourseTask
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         dueAt = COALESCE(?, dueAt),
         mode = COALESCE(?, mode),
         allowStudentResubmit = COALESCE(?, allowStudentResubmit),
         fileUrl = CASE WHEN ? IS NULL THEN fileUrl ELSE ? END
     WHERE id = ?`,
    title ? String(title).trim() : null,
    description !== undefined ? String(description) : null,
    dueAt !== undefined ? (dueAt ? String(dueAt) : null) : null,
    mode && ["MANUAL", "FILE"].includes(String(mode)) ? String(mode) : null,
    allowStudentResubmit === undefined ? null : allowStudentResubmit ? 1 : 0,
    fileUrl !== undefined ? String(fileUrl) : null,
    fileUrl !== undefined ? String(fileUrl) : null,
    taskId,
  );
  const updated = (await prisma.$queryRawUnsafe(
    `SELECT t.id, t.courseId, t.sectionId, t.instructorId, t.kind, t.mode, t.title, t.description, t.fileUrl, t.allowStudentResubmit,
            CAST(t.dueAt AS TEXT) as dueAt,
            CAST(t.createdAt AS TEXT) as createdAt,
            s.name as sectionName
     FROM CourseTask t
     JOIN Section s ON s.id = t.sectionId
     WHERE t.id = ?`,
    taskId,
  )) as Array<any>;
  res.json(updated[0]);
});

router.delete("/:taskId", requireRole("INSTRUCTOR"), async (req, res) => {
  const taskId = Number(req.params.taskId);
  await ensureTasksTables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, sectionId FROM CourseTask WHERE id = ?`,
    taskId,
  )) as Array<any>;
  const task = rows[0];
  if (!task) return res.status(404).json({ message: "Task not found" });
  if (!(await canAccessSection(req.auth!.userId, task.sectionId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await prisma.$executeRawUnsafe(`DELETE FROM TaskSubmission WHERE taskId = ?`, taskId);
  await prisma.$executeRawUnsafe(`DELETE FROM CourseTask WHERE id = ?`, taskId);
  res.status(204).send();
});

router.post("/:taskId/submissions", requireRole("STUDENT"), async (req, res) => {
  const taskId = Number(req.params.taskId);
  const { answerText, fileUrl } = req.body || {};

  await ensureTasksTables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT t.id, t.courseId, t.sectionId, t.kind, t.title, t.allowStudentResubmit FROM CourseTask t WHERE t.id = ?`,
    taskId,
  )) as Array<any>;
  const task = rows[0];
  if (!task) return res.status(404).json({ message: "Task not found" });

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: { courseId: task.courseId, studentId: req.auth!.userId },
    },
  });
  if (!enrollment || enrollment.status !== "APPROVED" || enrollment.sectionId !== task.sectionId) {
    return res.status(403).json({ message: "Task not available for your block" });
  }

  const existing = (await prisma.$queryRawUnsafe(
    `SELECT id, grade FROM TaskSubmission WHERE taskId = ? AND studentId = ?`,
    taskId,
    req.auth!.userId,
  )) as Array<{ id: number; grade: number | null }>;
  if (
    existing.length &&
    existing[0].grade !== null &&
    existing[0].grade !== undefined
  ) {
    return res.status(403).json({
      message: "Resubmission is disabled because this submission is already graded.",
    });
  }
  if (existing.length && Number(task.allowStudentResubmit ?? 1) !== 1) {
    return res.status(403).json({ message: "Resubmission is disabled by instructor." });
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO TaskSubmission (taskId, studentId, answerText, fileUrl, updatedAt)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(taskId, studentId)
     DO UPDATE SET answerText=excluded.answerText, fileUrl=excluded.fileUrl, updatedAt=CURRENT_TIMESTAMP`,
    taskId,
    req.auth!.userId,
    answerText ? String(answerText) : null,
    fileUrl ? String(fileUrl) : null,
  );

  const submitted = (await prisma.$queryRawUnsafe(
    `SELECT ts.id, ts.taskId, ts.studentId, ts.answerText, ts.fileUrl, ts.grade, ts.feedback, ts.gradedBy,
            CAST(ts.gradedAt AS TEXT) as gradedAt,
            CAST(ts.createdAt AS TEXT) as createdAt,
            CAST(ts.updatedAt AS TEXT) as updatedAt
     FROM TaskSubmission ts
     WHERE ts.taskId = ? AND ts.studentId = ?`,
    taskId,
    req.auth!.userId,
  )) as Array<any>;

  await emitNotificationAction({
    actionType: "TASK_SUBMITTED",
    message: `Submitted ${String(task.kind).toLowerCase()} "${task.title}".`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId: task.courseId,
    sectionId: task.sectionId,
    visibility: "PERSONAL",
  });

  res.status(201).json(submitted[0]);
});

router.delete("/:taskId/submissions/me", requireRole("STUDENT"), async (req, res) => {
  const taskId = Number(req.params.taskId);
  await ensureTasksTables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, courseId, sectionId, title, kind, allowStudentResubmit, CAST(dueAt AS TEXT) as dueAt
     FROM CourseTask WHERE id = ?`,
    taskId,
  )) as Array<any>;
  const task = rows[0];
  if (!task) return res.status(404).json({ message: "Task not found" });

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: { courseId: task.courseId, studentId: req.auth!.userId },
    },
  });
  if (!enrollment || enrollment.status !== "APPROVED" || enrollment.sectionId !== task.sectionId) {
    return res.status(403).json({ message: "Task not available for your block" });
  }
  if (task.dueAt && new Date(String(task.dueAt)).getTime() < Date.now()) {
    return res.status(403).json({ message: "Submission is closed after deadline." });
  }
  const existing = (await prisma.$queryRawUnsafe(
    `SELECT grade FROM TaskSubmission WHERE taskId = ? AND studentId = ?`,
    taskId,
    req.auth!.userId,
  )) as Array<{ grade: number | null }>;
  if (
    existing.length &&
    existing[0].grade !== null &&
    existing[0].grade !== undefined
  ) {
    return res.status(403).json({
      message: "Cannot delete submission because it is already graded.",
    });
  }
  if (Number(task.allowStudentResubmit ?? 1) !== 1) {
    return res.status(403).json({ message: "Resubmission is disabled by instructor." });
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM TaskSubmission WHERE taskId = ? AND studentId = ?`,
    taskId,
    req.auth!.userId,
  );
  res.status(204).send();
});

router.get("/:taskId/submissions", requireRole("INSTRUCTOR"), async (req, res) => {
  const taskId = Number(req.params.taskId);
  await ensureTasksTables();
  const taskRows = (await prisma.$queryRawUnsafe(
    `SELECT id, sectionId FROM CourseTask WHERE id = ?`,
    taskId,
  )) as Array<any>;
  const task = taskRows[0];
  if (!task) return res.status(404).json({ message: "Task not found" });
  if (!(await canAccessSection(req.auth!.userId, task.sectionId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT ts.*, u.fullName as studentName, u.email as studentEmail
     FROM TaskSubmission ts
     JOIN User u ON u.id = ts.studentId
     WHERE ts.taskId = ?
     ORDER BY datetime(ts.updatedAt) DESC`,
    taskId,
  )) as Array<any>;
  res.json(rows);
});

router.patch("/submissions/:submissionId/grade", requireRole("INSTRUCTOR"), async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  const { grade, feedback } = req.body || {};

  await ensureTasksTables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT ts.id, ts.studentId, ts.taskId, t.courseId, t.sectionId, t.title, t.kind
     FROM TaskSubmission ts
     JOIN CourseTask t ON t.id = ts.taskId
     WHERE ts.id = ?`,
    submissionId,
  )) as Array<any>;
  const target = rows[0];
  if (!target) return res.status(404).json({ message: "Submission not found" });
  if (!(await canAccessSection(req.auth!.userId, target.sectionId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE TaskSubmission
     SET grade = ?, feedback = ?, gradedBy = ?, gradedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    Number(grade),
    feedback ? String(feedback) : null,
    req.auth!.userId,
    submissionId,
  );

  const updated = (await prisma.$queryRawUnsafe(
    `SELECT id, taskId, studentId, answerText, fileUrl, grade, feedback, gradedBy,
            CAST(gradedAt AS TEXT) as gradedAt,
            CAST(createdAt AS TEXT) as createdAt,
            CAST(updatedAt AS TEXT) as updatedAt
     FROM TaskSubmission WHERE id = ?`,
    submissionId,
  )) as Array<any>;

  await emitNotificationAction({
    actionType: "TASK_GRADED",
    message: `Your ${String(target.kind).toLowerCase()} "${target.title}" was graded: ${Number(grade)}.`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId: target.courseId,
    sectionId: target.sectionId,
    visibility: "PERSONAL",
    targetUserId: target.studentId,
  });

  res.json(updated[0]);
});

export default router;
