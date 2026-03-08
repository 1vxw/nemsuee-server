import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { emitNotificationAction } from "../services/notifications.js";
import { canAccessCourse, canAccessSection } from "../modules/courses/access.js";
import {
  quizSchema,
  quizUpdateSchema,
  submitSchema,
} from "./quizzes/schemas.js";

const router = Router();
router.use(requireAuth);

async function ensureQuizV2Tables() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS LessonQuiz (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lessonId INTEGER NOT NULL,
      courseId INTEGER NOT NULL,
      sectionId INTEGER NOT NULL,
      instructorId INTEGER NOT NULL,
      title TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'MANUAL',
      quizType TEXT,
      externalUrl TEXT,
      isOpen INTEGER NOT NULL DEFAULT 1,
      timeLimitMinutes INTEGER,
      maxAttempts INTEGER,
      shuffleQuestions INTEGER NOT NULL DEFAULT 0,
      showResultsImmediately INTEGER NOT NULL DEFAULT 1,
      showScoreInStudentScores INTEGER NOT NULL DEFAULT 1,
      passingPercentage INTEGER NOT NULL DEFAULT 60,
      accessCode TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN isOpen INTEGER NOT NULL DEFAULT 1`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN timeLimitMinutes INTEGER`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN maxAttempts INTEGER`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN shuffleQuestions INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN showResultsImmediately INTEGER NOT NULL DEFAULT 1`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN showScoreInStudentScores INTEGER NOT NULL DEFAULT 1`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN passingPercentage INTEGER NOT NULL DEFAULT 60`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE LessonQuiz ADD COLUMN accessCode TEXT`);
  } catch {}
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS LessonQuizQuestion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quizId INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      optionA TEXT,
      optionB TEXT,
      optionC TEXT,
      optionD TEXT,
      correctAnswer TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS LessonQuizSubmission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quizId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      score REAL,
      total REAL,
      payload TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

router.get("/course/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return res.status(404).json({ message: "Course not found" });

  if (req.auth!.role === "INSTRUCTOR") {
    if (!(await canAccessCourse(req.auth!.userId, courseId))) {
      return res.status(403).json({ message: "Forbidden" });
    }
  } else if (req.auth!.role === "STUDENT") {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        courseId_studentId: { courseId, studentId: req.auth!.userId },
      },
    });
    if (!enrollment || enrollment.status !== "APPROVED") {
      return res.status(403).json({ message: "Not enrolled" });
    }
  } else {
    return res.json([]);
  }

  await ensureQuizV2Tables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT q.id, q.lessonId, q.courseId, q.sectionId, q.title, q.mode, q.quizType, q.externalUrl,
            q.isOpen, q.timeLimitMinutes, q.maxAttempts, q.shuffleQuestions, q.showResultsImmediately, q.showScoreInStudentScores, q.passingPercentage, q.accessCode,
            q.createdAt,
            qq.id as questionId, qq.prompt, qq.optionA, qq.optionB, qq.optionC, qq.optionD, qq.correctAnswer
     FROM LessonQuiz q
     LEFT JOIN LessonQuizQuestion qq ON qq.quizId = q.id
     WHERE q.courseId = ?
     ORDER BY q.id DESC, qq.id ASC`,
    courseId,
  )) as Array<any>;

  const map = new Map<number, any>();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        lessonId: row.lessonId,
        courseId: row.courseId,
        sectionId: row.sectionId,
        title: row.title,
        mode: row.mode,
        quizType: row.quizType,
        externalUrl: row.externalUrl,
        isOpen: Boolean(row.isOpen),
        timeLimitMinutes: row.timeLimitMinutes,
        maxAttempts: row.maxAttempts,
        shuffleQuestions: Boolean(row.shuffleQuestions),
        showResultsImmediately: Boolean(row.showResultsImmediately),
        showScoreInStudentScores: Boolean(row.showScoreInStudentScores),
        passingPercentage: row.passingPercentage,
        accessCode: row.accessCode,
        createdAt: row.createdAt,
        questions: [],
      });
    }
    if (row.questionId) {
      map.get(row.id).questions.push({
        id: row.questionId,
        prompt: row.prompt,
        optionA: row.optionA,
        optionB: row.optionB,
        optionC: row.optionC,
        optionD: row.optionD,
        correctAnswer: row.correctAnswer,
      });
    }
  }
  return res.json(Array.from(map.values()));
});

router.post("/lessons/:lessonId", requireRole("INSTRUCTOR"), async (req, res) => {
  const lessonId = Number(req.params.lessonId);
  const {
    title,
    mode,
    quizType,
    externalUrl,
    isOpen,
    timeLimitMinutes,
    maxAttempts,
    shuffleQuestions,
    showResultsImmediately,
    showScoreInStudentScores,
    passingPercentage,
    accessCode,
    questions,
  } = (req.body || {}) as {
    title?: string;
    mode?: "MANUAL" | "URL";
    quizType?: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IDENTIFICATION";
    externalUrl?: string;
    isOpen?: boolean;
    timeLimitMinutes?: number;
    maxAttempts?: number;
    shuffleQuestions?: boolean;
    showResultsImmediately?: boolean;
    showScoreInStudentScores?: boolean;
    passingPercentage?: number;
    accessCode?: string;
    questions?: Array<{
      prompt: string;
      optionA?: string;
      optionB?: string;
      optionC?: string;
      optionD?: string;
      correctAnswer?: string;
    }>;
  };
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { course: true, section: true },
  });
  if (!lesson || !(await canAccessSection(req.auth!.userId, lesson.sectionId))) {
    return res.status(404).json({ message: "Lesson not found" });
  }
  if (!title?.trim()) {
    return res.status(400).json({ message: "title is required" });
  }
  if (!mode || !["MANUAL", "URL"].includes(mode)) {
    return res.status(400).json({ message: "Invalid mode" });
  }
  if (mode === "URL" && !externalUrl?.trim()) {
    return res.status(400).json({ message: "externalUrl is required for URL mode" });
  }
  if (mode === "MANUAL") {
    if (!quizType || !["MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION"].includes(quizType)) {
      return res.status(400).json({ message: "Invalid quizType" });
    }
    if (!questions?.length) {
      return res.status(400).json({ message: "At least one question is required" });
    }
  }

  await ensureQuizV2Tables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO LessonQuiz (
       lessonId, courseId, sectionId, instructorId, title, mode, quizType, externalUrl,
       isOpen, timeLimitMinutes, maxAttempts, shuffleQuestions, showResultsImmediately, showScoreInStudentScores, passingPercentage, accessCode
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lesson.id,
    lesson.courseId,
    lesson.sectionId,
    req.auth!.userId,
    title.trim(),
    mode,
    mode === "MANUAL" ? quizType : null,
    mode === "URL" ? externalUrl!.trim() : null,
    isOpen === false ? 0 : 1,
    typeof timeLimitMinutes === "number" ? Math.max(1, Math.floor(timeLimitMinutes)) : null,
    typeof maxAttempts === "number" ? Math.max(1, Math.floor(maxAttempts)) : null,
    shuffleQuestions ? 1 : 0,
    showResultsImmediately === false ? 0 : 1,
    showScoreInStudentScores === false ? 0 : 1,
    typeof passingPercentage === "number"
      ? Math.max(1, Math.min(100, Math.floor(passingPercentage)))
      : 60,
    accessCode ? String(accessCode) : null,
  );
  const createdRows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM LessonQuiz WHERE rowid = last_insert_rowid()`,
  )) as Array<any>;
  const created = createdRows[0];

  if (mode === "MANUAL") {
    for (const q of questions || []) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO LessonQuizQuestion (quizId, prompt, optionA, optionB, optionC, optionD, correctAnswer)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        created.id,
        String(q.prompt || "").trim(),
        q.optionA || null,
        q.optionB || null,
        q.optionC || null,
        q.optionD || null,
        q.correctAnswer || null,
      );
    }
  }
  await emitNotificationAction({
    actionType: "QUIZ_CREATED",
    message: `Posted quiz "${title.trim()}" in "${lesson.course.title} / ${lesson.section.name}".`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId: lesson.courseId,
    sectionId: lesson.sectionId,
    visibility: "GLOBAL_STUDENTS",
  });
  return res.status(201).json(created);
});

router.patch("/:id/settings", requireRole("INSTRUCTOR"), async (req, res) => {
  const quizId = Number(req.params.id);
  const {
    title,
    isOpen,
    timeLimitMinutes,
    maxAttempts,
    shuffleQuestions,
    showResultsImmediately,
    showScoreInStudentScores,
    passingPercentage,
    accessCode,
    externalUrl,
  } = req.body || {};

  await ensureQuizV2Tables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, sectionId FROM LessonQuiz WHERE id = ?`,
    quizId,
  )) as Array<{ id: number; sectionId: number }>;
  const quiz = rows[0];
  if (!quiz || !(await canAccessSection(req.auth!.userId, quiz.sectionId))) {
    return res.status(404).json({ message: "Quiz not found" });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE LessonQuiz
     SET title = COALESCE(?, title),
         isOpen = COALESCE(?, isOpen),
         timeLimitMinutes = ?,
         maxAttempts = ?,
         shuffleQuestions = COALESCE(?, shuffleQuestions),
         showResultsImmediately = COALESCE(?, showResultsImmediately),
         showScoreInStudentScores = COALESCE(?, showScoreInStudentScores),
         passingPercentage = COALESCE(?, passingPercentage),
         accessCode = ?,
         externalUrl = COALESCE(?, externalUrl)
     WHERE id = ?`,
    title ? String(title).trim() : null,
    typeof isOpen === "boolean" ? (isOpen ? 1 : 0) : null,
    typeof timeLimitMinutes === "number" ? Math.max(1, Math.floor(timeLimitMinutes)) : null,
    typeof maxAttempts === "number" ? Math.max(1, Math.floor(maxAttempts)) : null,
    typeof shuffleQuestions === "boolean" ? (shuffleQuestions ? 1 : 0) : null,
    typeof showResultsImmediately === "boolean" ? (showResultsImmediately ? 1 : 0) : null,
    typeof showScoreInStudentScores === "boolean" ? (showScoreInStudentScores ? 1 : 0) : null,
    typeof passingPercentage === "number"
      ? Math.max(1, Math.min(100, Math.floor(passingPercentage)))
      : null,
    accessCode !== undefined ? (accessCode ? String(accessCode) : null) : null,
    externalUrl ? String(externalUrl) : null,
    quizId,
  );

  const updated = (await prisma.$queryRawUnsafe(
    `SELECT * FROM LessonQuiz WHERE id = ?`,
    quizId,
  )) as Array<any>;
  return res.json(updated[0]);
});

router.delete("/:id/questions/:questionId", requireRole("INSTRUCTOR"), async (req, res) => {
  const quizId = Number(req.params.id);
  const questionId = Number(req.params.questionId);
  await ensureQuizV2Tables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT q.sectionId FROM LessonQuiz q WHERE q.id = ?`,
    quizId,
  )) as Array<{ sectionId: number }>;
  const quiz = rows[0];
  if (!quiz || !(await canAccessSection(req.auth!.userId, quiz.sectionId))) {
    return res.status(404).json({ message: "Quiz not found" });
  }
  await prisma.$executeRawUnsafe(
    `DELETE FROM LessonQuizQuestion WHERE id = ? AND quizId = ?`,
    questionId,
    quizId,
  );
  return res.status(204).send();
});

router.post("/:id/submit-v2", requireRole("STUDENT"), async (req, res) => {
  const quizId = Number(req.params.id);
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  await ensureQuizV2Tables();
  const quizRows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM LessonQuiz WHERE id = ?`,
    quizId,
  )) as Array<any>;
  const quiz = quizRows[0];
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: { courseId: quiz.courseId, studentId: req.auth!.userId },
    },
  });
  if (!enrollment || enrollment.status !== "APPROVED" || enrollment.sectionId !== quiz.sectionId) {
    return res.status(403).json({ message: "Quiz not available for your block" });
  }
  if (!Boolean(quiz.isOpen)) {
    return res.status(403).json({ message: "Quiz is closed by instructor" });
  }
  if (quiz.accessCode && String(req.body?.accessCode || "").trim() !== String(quiz.accessCode).trim()) {
    return res.status(403).json({ message: "Invalid quiz access code" });
  }
  const attemptRows = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as c FROM LessonQuizSubmission WHERE quizId = ? AND studentId = ?`,
    quizId,
    req.auth!.userId,
  )) as Array<{ c: number }>;
  const currentAttempts = Number(attemptRows[0]?.c || 0);
  if (quiz.maxAttempts && currentAttempts >= Number(quiz.maxAttempts)) {
    return res.status(403).json({ message: "Maximum attempts reached" });
  }
  if (quiz.mode === "URL") {
    return res.json({ redirected: true, externalUrl: quiz.externalUrl });
  }

  const questions = (await prisma.$queryRawUnsafe(
    `SELECT * FROM LessonQuizQuestion WHERE quizId = ? ORDER BY id ASC`,
    quizId,
  )) as Array<any>;
  let score = 0;
  const total = questions.length;
  const answerMap = new Map<number, string>();
  for (const a of answers) {
    answerMap.set(Number(a.questionId), String(a.answer || "").trim());
  }
  for (const q of questions) {
    const got = (answerMap.get(q.id) || "").trim().toLowerCase();
    const correct = String(q.correctAnswer || "").trim().toLowerCase();
    if (got && correct && got === correct) score += 1;
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO LessonQuizSubmission (quizId, studentId, score, total, payload)
     VALUES (?, ?, ?, ?, ?)`,
    quizId,
    req.auth!.userId,
    score,
    total,
    JSON.stringify(answers || []),
  );
  return res.json({
    score,
    total,
    percentage: Math.round((score / Math.max(total, 1)) * 100),
  });
});

router.get("/:id/score", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return res.status(400).json({ message: "Invalid quiz id" });
  }

  await ensureQuizV2Tables();
  const v2Rows = (await prisma.$queryRawUnsafe(
    `SELECT id, courseId, sectionId, title, isOpen, maxAttempts
     FROM LessonQuiz
     WHERE id = ?`,
    quizId,
  )) as Array<any>;
  const v2 = v2Rows[0];

  if (v2) {
    if (req.auth!.role === "INSTRUCTOR") {
      if (!(await canAccessSection(req.auth!.userId, v2.sectionId))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const statsRows = (await prisma.$queryRawUnsafe(
        `SELECT
           COUNT(*) as totalSubmissions,
           COUNT(DISTINCT studentId) as uniqueStudents,
           ROUND(AVG(CASE WHEN total > 0 THEN (score * 100.0 / total) END), 2) as averagePercentage,
           MAX(CASE WHEN total > 0 THEN (score * 100.0 / total) END) as bestPercentage,
           MIN(CASE WHEN total > 0 THEN (score * 100.0 / total) END) as lowestPercentage
         FROM LessonQuizSubmission
         WHERE quizId = ?`,
        quizId,
      )) as Array<any>;
      return res.json({
        quizId,
        title: v2.title,
        status: v2.isOpen ? "PUBLISHED" : "CLOSED",
        maxAttempts: v2.maxAttempts,
        ...statsRows[0],
      });
    }

    if (req.auth!.role === "STUDENT") {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          courseId_studentId: {
            courseId: v2.courseId,
            studentId: req.auth!.userId,
          },
        },
      });
      if (
        !enrollment ||
        enrollment.status !== "APPROVED" ||
        enrollment.sectionId !== v2.sectionId
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const rows = (await prisma.$queryRawUnsafe(
        `SELECT
           COUNT(*) as attemptsUsed,
           MAX(CASE WHEN total > 0 THEN (score * 100.0 / total) END) as bestPercentage,
           ROUND(AVG(CASE WHEN total > 0 THEN (score * 100.0 / total) END), 2) as averagePercentage
         FROM LessonQuizSubmission
         WHERE quizId = ? AND studentId = ?`,
        quizId,
        req.auth!.userId,
      )) as Array<any>;
      const me = rows[0] || {};
      const attemptsUsed = Number(me.attemptsUsed || 0);
      const maxAttempts =
        typeof v2.maxAttempts === "number" ? Number(v2.maxAttempts) : null;
      const canAttempt =
        Boolean(v2.isOpen) &&
        (maxAttempts === null || attemptsUsed < Number(maxAttempts));
      const blockedReason = !Boolean(v2.isOpen)
        ? "QUIZ_CLOSED"
        : maxAttempts !== null && attemptsUsed >= maxAttempts
          ? "MAX_ATTEMPTS_REACHED"
          : null;

      return res.json({
        quizId,
        title: v2.title,
        attemptsUsed,
        maxAttempts,
        canAttempt,
        blockedReason,
        bestPercentage: me.bestPercentage,
        averagePercentage: me.averagePercentage,
      });
    }

    return res.status(403).json({ message: "Forbidden" });
  }

  const legacy = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { lesson: true },
  });
  if (!legacy) return res.status(404).json({ message: "Quiz not found" });

  if (req.auth!.role === "INSTRUCTOR") {
    const course = await prisma.course.findUnique({
      where: { id: legacy.lesson.courseId },
    });
    if (!course || course.instructorId !== req.auth!.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const rows = await prisma.attempt.findMany({
      where: { quizId },
      select: { score: true, total: true },
    });
    const percentages = rows.map((r) =>
      r.total > 0 ? (r.score * 100) / r.total : 0,
    );
    const averagePercentage = percentages.length
      ? Number(
          (percentages.reduce((sum, p) => sum + p, 0) / percentages.length).toFixed(2),
        )
      : null;
    return res.json({
      quizId,
      title: legacy.lesson.title,
      status: "PUBLISHED",
      maxAttempts: null,
      totalSubmissions: rows.length,
      uniqueStudents: rows.length,
      averagePercentage,
      bestPercentage: percentages.length ? Math.max(...percentages) : null,
      lowestPercentage: percentages.length ? Math.min(...percentages) : null,
    });
  }

  if (req.auth!.role === "STUDENT") {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        courseId_studentId: {
          courseId: legacy.lesson.courseId,
          studentId: req.auth!.userId,
        },
      },
    });
    if (
      !enrollment ||
      enrollment.status !== "APPROVED" ||
      enrollment.sectionId !== legacy.lesson.sectionId
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const rows = await prisma.attempt.findMany({
      where: { quizId, studentId: req.auth!.userId },
      select: { score: true, total: true },
    });
    const percentages = rows.map((r) =>
      r.total > 0 ? (r.score * 100) / r.total : 0,
    );
    return res.json({
      quizId,
      title: legacy.lesson.title,
      attemptsUsed: rows.length,
      maxAttempts: null,
      canAttempt: true,
      blockedReason: null,
      bestPercentage: percentages.length ? Math.max(...percentages) : null,
      averagePercentage: percentages.length
        ? Number(
            (percentages.reduce((sum, p) => sum + p, 0) / percentages.length).toFixed(2),
          )
        : null,
    });
  }

  return res.status(403).json({ message: "Forbidden" });
});

router.get("/:id/results/me", requireRole("STUDENT"), async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return res.status(400).json({ message: "Invalid quiz id" });
  }
  await ensureQuizV2Tables();
  const quizRows = (await prisma.$queryRawUnsafe(
    `SELECT q.*, l.title as lessonTitle, s.name as sectionName, c.title as courseTitle
     FROM LessonQuiz q
     JOIN Lesson l ON l.id = q.lessonId
     JOIN Section s ON s.id = q.sectionId
     JOIN Course c ON c.id = q.courseId
     WHERE q.id = ?`,
    quizId,
  )) as Array<any>;
  const quiz = quizRows[0];
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: { courseId: quiz.courseId, studentId: req.auth!.userId },
    },
  });
  if (!enrollment || enrollment.status !== "APPROVED" || enrollment.sectionId !== quiz.sectionId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const submissionRows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM LessonQuizSubmission
     WHERE quizId = ? AND studentId = ?
     ORDER BY createdAt DESC
     LIMIT 1`,
    quizId,
    req.auth!.userId,
  )) as Array<any>;
  const latest = submissionRows[0];
  if (!latest) {
    return res.status(404).json({ message: "No submission found for this quiz" });
  }

  let parsedPayload: Array<{ questionId: number; answer?: string }> = [];
  try {
    parsedPayload = JSON.parse(String(latest.payload || "[]"));
  } catch {}
  const answerMap = new Map<number, string>();
  for (const a of parsedPayload) {
    answerMap.set(Number(a.questionId), String(a.answer || ""));
  }

  const questionRows = (await prisma.$queryRawUnsafe(
    `SELECT id, prompt, optionA, optionB, optionC, optionD, correctAnswer
     FROM LessonQuizQuestion
     WHERE quizId = ?
     ORDER BY id ASC`,
    quizId,
  )) as Array<any>;

  const canViewAnswerKey = Boolean(quiz.showResultsImmediately);
  const questions = questionRows.map((q) => {
    const studentAnswer = String(answerMap.get(Number(q.id)) || "");
    const correctAnswer = String(q.correctAnswer || "");
    const isCorrect =
      studentAnswer.trim().toLowerCase() &&
      correctAnswer.trim().toLowerCase() &&
      studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
    return {
      id: q.id,
      prompt: q.prompt,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      studentAnswer,
      isCorrect: canViewAnswerKey ? Boolean(isCorrect) : null,
      correctAnswer: canViewAnswerKey ? correctAnswer : null,
    };
  });

  return res.json({
    attemptId: latest.id,
    submittedAt: latest.createdAt,
     score: Number(latest.score || 0),
    total: Number(latest.total || 0),
    quiz: {
      id: quiz.id,
      title: quiz.title,
      lessonId: quiz.lessonId,
      lessonTitle: quiz.lessonTitle,
      sectionId: quiz.sectionId,
      sectionName: quiz.sectionName,
      courseId: quiz.courseId,
      courseTitle: quiz.courseTitle,
      showResultsImmediately: Boolean(quiz.showResultsImmediately),
      showScoreInStudentScores: Boolean(quiz.showScoreInStudentScores ?? 1),
      passingPercentage: quiz.passingPercentage ?? 60,
      canViewAnswerKey,
    },
    questions,
  });
});

router.get("/:id/analytics", requireRole("INSTRUCTOR"), async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return res.status(400).json({ message: "Invalid quiz id" });
  }

  await ensureQuizV2Tables();
  const quizRows = (await prisma.$queryRawUnsafe(
    `SELECT id, courseId, sectionId, title, mode, quizType, isOpen, timeLimitMinutes, maxAttempts, createdAt
     FROM LessonQuiz
     WHERE id = ?`,
    quizId,
  )) as Array<any>;
  const quiz = quizRows[0];

  if (quiz) {
    if (!(await canAccessSection(req.auth!.userId, quiz.sectionId))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const summaryRows = (await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) as totalSubmissions,
         COUNT(DISTINCT studentId) as uniqueStudents,
         ROUND(AVG(CASE WHEN total > 0 THEN (score * 100.0 / total) END), 2) as averagePercentage,
         MAX(CASE WHEN total > 0 THEN (score * 100.0 / total) END) as highestPercentage,
         MIN(CASE WHEN total > 0 THEN (score * 100.0 / total) END) as lowestPercentage
       FROM LessonQuizSubmission
       WHERE quizId = ?`,
      quizId,
    )) as Array<any>;

    const questionRows = (await prisma.$queryRawUnsafe(
      `SELECT id, prompt FROM LessonQuizQuestion WHERE quizId = ? ORDER BY id ASC`,
      quizId,
    )) as Array<{ id: number; prompt: string }>;

    const submissionsRows = (await prisma.$queryRawUnsafe(
      `SELECT s.id, s.studentId, u.fullName, s.score, s.total, s.createdAt
       FROM LessonQuizSubmission s
       JOIN User u ON u.id = s.studentId
       WHERE s.quizId = ?
       ORDER BY s.createdAt DESC
       LIMIT 100`,
      quizId,
    )) as Array<any>;

    const questionAnalytics = questionRows.map((q) => ({
      questionId: q.id,
      prompt: q.prompt,
      correctRate: null as number | null,
      totalAnswers: 0,
    }));

    return res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        mode: quiz.mode,
        quizType: quiz.quizType,
        isOpen: Boolean(quiz.isOpen),
        timeLimitMinutes: quiz.timeLimitMinutes,
        maxAttempts: quiz.maxAttempts,
        createdAt: quiz.createdAt,
      },
      summary: summaryRows[0] || {
        totalSubmissions: 0,
        uniqueStudents: 0,
        averagePercentage: null,
        highestPercentage: null,
        lowestPercentage: null,
      },
      submissions: submissionsRows,
      questions: questionAnalytics,
    });
  }

  const legacy = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      lesson: { include: { course: true } },
      attempts: {
        include: { student: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      questions: true,
    },
  });
  if (!legacy) return res.status(404).json({ message: "Quiz not found" });
  if (legacy.lesson.course.instructorId !== req.auth!.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const percentages = legacy.attempts.map((a) =>
    a.total > 0 ? (a.score * 100) / a.total : 0,
  );
  return res.json({
    quiz: {
      id: legacy.id,
      title: legacy.lesson.title,
      mode: "MANUAL",
      quizType: "MULTIPLE_CHOICE",
      isOpen: true,
      timeLimitMinutes: null,
      maxAttempts: null,
      createdAt: legacy.createdAt,
    },
    summary: {
      totalSubmissions: legacy.attempts.length,
      uniqueStudents: legacy.attempts.length,
      averagePercentage: percentages.length
        ? Number(
            (percentages.reduce((sum, p) => sum + p, 0) / percentages.length).toFixed(2),
          )
        : null,
      highestPercentage: percentages.length ? Math.max(...percentages) : null,
      lowestPercentage: percentages.length ? Math.min(...percentages) : null,
    },
    submissions: legacy.attempts.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      fullName: a.student.fullName,
      score: a.score,
      total: a.total,
      createdAt: a.createdAt,
    })),
    questions: legacy.questions.map((q) => ({
      questionId: q.id,
      prompt: q.prompt,
      correctRate: null,
      totalAnswers: 0,
    })),
  });
});

router.get("/course/:courseId/analytics", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId) || courseId <= 0) {
    return res.status(400).json({ message: "Invalid course id" });
  }
  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await ensureQuizV2Tables();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT
       q.id,
       q.title,
       q.lessonId,
       q.sectionId,
       q.isOpen,
       q.timeLimitMinutes,
       q.maxAttempts,
       COUNT(s.id) as submissions,
       COUNT(DISTINCT s.studentId) as uniqueStudents,
       ROUND(AVG(CASE WHEN s.total > 0 THEN (s.score * 100.0 / s.total) END), 2) as averagePercentage,
       MAX(CASE WHEN s.total > 0 THEN (s.score * 100.0 / s.total) END) as highestPercentage,
       MIN(CASE WHEN s.total > 0 THEN (s.score * 100.0 / s.total) END) as lowestPercentage
     FROM LessonQuiz q
     LEFT JOIN LessonQuizSubmission s ON s.quizId = q.id
     WHERE q.courseId = ?
     GROUP BY q.id
     ORDER BY q.createdAt DESC`,
    courseId,
  )) as Array<any>;

  const totals = rows.reduce(
    (acc, r) => {
      acc.totalQuizzes += 1;
      acc.totalSubmissions += Number(r.submissions || 0);
      if (r.averagePercentage !== null && r.averagePercentage !== undefined) {
        acc.sumAverages += Number(r.averagePercentage);
        acc.withAverage += 1;
      }
      return acc;
    },
    { totalQuizzes: 0, totalSubmissions: 0, sumAverages: 0, withAverage: 0 },
  );

  return res.json({
    summary: {
      totalQuizzes: totals.totalQuizzes,
      totalSubmissions: totals.totalSubmissions,
      courseAveragePercentage:
        totals.withAverage > 0
          ? Number((totals.sumAverages / totals.withAverage).toFixed(2))
          : null,
    },
    quizzes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      lessonId: r.lessonId,
      sectionId: r.sectionId,
      isOpen: Boolean(r.isOpen),
      timeLimitMinutes: r.timeLimitMinutes,
      maxAttempts: r.maxAttempts,
      submissions: Number(r.submissions || 0),
      uniqueStudents: Number(r.uniqueStudents || 0),
      averagePercentage: r.averagePercentage,
      highestPercentage: r.highestPercentage,
      lowestPercentage: r.lowestPercentage,
    })),
  });
});

router.post("/", requireRole("INSTRUCTOR"), async (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const lesson = await prisma.lesson.findUnique({
    where: { id: parsed.data.lessonId },
    include: { course: true, quiz: true },
  });
  if (!lesson || lesson.course.instructorId !== req.auth!.userId)
    return res.status(404).json({ message: "Lesson not found" });
  if (lesson.quiz)
    return res
      .status(409)
      .json({ message: "Quiz already exists for this lesson" });

  const quiz = await prisma.quiz.create({
    data: {
      lessonId: parsed.data.lessonId,
      questions: { create: parsed.data.questions },
    },
    include: { questions: true },
  });
  await emitNotificationAction({
    actionType: "QUIZ_CREATED",
    message: `Created ${parsed.data.quizType === "TRUE_FALSE" ? "True/False" : "Multiple Choice"} quiz for "${lesson.title}" in "${lesson.course.title}".`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId: lesson.courseId,
    sectionId: lesson.sectionId,
    visibility: "GLOBAL_STUDENTS",
  });

  res.status(201).json(quiz);
});

router.put("/:id", requireRole("INSTRUCTOR"), async (req, res) => {
  const quizId = Number(req.params.id);
  const parsed = quizUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { lesson: { include: { course: true } } },
  });
  if (!quiz || quiz.lesson.course.instructorId !== req.auth!.userId) {
    return res.status(404).json({ message: "Quiz not found" });
  }

  const updated = await prisma.quiz.update({
    where: { id: quizId },
    data: {
      questions: {
        deleteMany: {},
        create: parsed.data.questions,
      },
    },
    include: { questions: true },
  });
  await emitNotificationAction({
    actionType: "QUIZ_UPDATED",
    message: `Updated quiz for "${quiz.lesson.title}" in "${quiz.lesson.course.title}".`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId: quiz.lesson.courseId,
    sectionId: quiz.lesson.sectionId,
    visibility: "GLOBAL_STUDENTS",
  });

  res.json(updated);
});

router.delete("/:id", requireRole("INSTRUCTOR"), async (req, res) => {
  const quizId = Number(req.params.id);

  await ensureQuizV2Tables();
  const v2Rows = (await prisma.$queryRawUnsafe(
    `SELECT id, courseId, sectionId, title FROM LessonQuiz WHERE id = ?`,
    quizId,
  )) as Array<{ id: number; courseId: number; sectionId: number; title: string }>;
  const v2 = v2Rows[0];
  if (v2) {
    if (!(await canAccessSection(req.auth!.userId, v2.sectionId))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM LessonQuizQuestion WHERE quizId = ?`, quizId);
    await prisma.$executeRawUnsafe(`DELETE FROM LessonQuiz WHERE id = ?`, quizId);
    await emitNotificationAction({
      actionType: "QUIZ_DELETED",
      message: `Deleted quiz "${v2.title}".`,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      courseId: v2.courseId,
      sectionId: v2.sectionId,
      visibility: "GLOBAL_STUDENTS",
    });
    return res.status(204).send();
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { lesson: { include: { course: true } } },
  });
  if (!quiz || quiz.lesson.course.instructorId !== req.auth!.userId) {
    return res.status(404).json({ message: "Quiz not found" });
  }

  await prisma.quiz.delete({ where: { id: quizId } });
  await emitNotificationAction({
    actionType: "QUIZ_DELETED",
    message: `Deleted quiz for "${quiz.lesson.title}" in "${quiz.lesson.course.title}".`,
    actorUserId: req.auth!.userId,
    actorRole: req.auth!.role,
    courseId: quiz.lesson.courseId,
    sectionId: quiz.lesson.sectionId,
    visibility: "GLOBAL_STUDENTS",
  });
  res.status(204).send();
});

router.post("/:id/submit", requireRole("STUDENT"), async (req, res) => {
  const quizId = Number(req.params.id);
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true, lesson: { include: { course: true } } },
  });
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: {
        courseId: quiz.lesson.courseId,
        studentId: req.auth!.userId,
      },
    },
  });
  if (!enrollment || enrollment.status !== "APPROVED") {
    return res
      .status(403)
      .json({ message: "You are not enrolled in this course" });
  }
  if (enrollment.sectionId !== quiz.lesson.sectionId) {
    return res
      .status(403)
      .json({ message: "Quiz is not available for your section/block" });
  }

  let score = 0;
  const total = quiz.questions.length;

  const answerMap = new Map(
    parsed.data.answers.map((x) => [x.questionId, x.selectedOption]),
  );
  for (const q of quiz.questions) {
    if (answerMap.get(q.id) === q.correctOption) score += 1;
  }

  const attempt = await prisma.attempt.create({
    data: {
      quizId,
      studentId: req.auth!.userId,
      score,
      total,
    },
  });

  res.json({
    attemptId: attempt.id,
    score,
    total,
    percentage: Math.round((score / Math.max(total, 1)) * 100),
  });
});

router.get("/scores/me", async (req, res) => {
  if (req.auth?.role !== "STUDENT") return res.json([]);
  await ensureQuizV2Tables();
  const attempts = await prisma.attempt.findMany({
    where: { studentId: req.auth!.userId },
    include: {
      quiz: { include: { lesson: { include: { course: true, section: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const v2Rows = (await prisma.$queryRawUnsafe(
    `SELECT
       s.id, s.quizId, s.studentId, s.score, s.total, s.createdAt,
       q.title as quizTitle, q.lessonId, q.courseId, q.sectionId, q.passingPercentage, q.showScoreInStudentScores,
       l.title as lessonTitle,
       c.title as courseTitle,
       sec.name as sectionName
     FROM LessonQuizSubmission s
     JOIN LessonQuiz q ON q.id = s.quizId
     JOIN Lesson l ON l.id = q.lessonId
     JOIN Course c ON c.id = q.courseId
     JOIN Section sec ON sec.id = q.sectionId
     WHERE s.studentId = ?
     ORDER BY s.createdAt DESC`,
    req.auth!.userId,
  )) as Array<any>;

  const normalizedV2 = v2Rows.map((r) => ({
    id: r.id,
    quizId: r.quizId,
    studentId: r.studentId,
    score: Number(r.score || 0),
    total: Number(r.total || 0),
    createdAt: r.createdAt,
    quiz: {
      id: r.quizId,
      passingPercentage: r.passingPercentage,
      showScoreInStudentScores: Boolean(r.showScoreInStudentScores),
      lesson: {
        id: r.lessonId,
        title: r.lessonTitle || r.quizTitle || "Quiz",
        sectionName: r.sectionName || null,
        course: {
          id: r.courseId,
          title: r.courseTitle || "Course",
        },
      },
    },
  }));

  res.json([...normalizedV2, ...attempts]);
});

router.get("/scores/instructor", async (req, res) => {
  if (req.auth?.role !== "INSTRUCTOR") return res.json([]);
  await ensureQuizV2Tables();
  const attempts = await prisma.attempt.findMany({
    where: {
      quiz: { lesson: { course: { instructorId: req.auth!.userId } } },
    },
    include: {
      student: { select: { id: true, fullName: true, email: true } },
      quiz: { include: { lesson: { include: { course: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const v2Rows = (await prisma.$queryRawUnsafe(
    `SELECT
       s.id, s.quizId, s.studentId, s.score, s.total, s.createdAt,
       q.title as quizTitle, q.lessonId, q.courseId, q.sectionId, q.passingPercentage, q.showScoreInStudentScores,
       l.title as lessonTitle,
       c.title as courseTitle,
      sec.name as sectionName,
      u.fullName, u.email
     FROM LessonQuizSubmission s
     JOIN LessonQuiz q ON q.id = s.quizId
     JOIN Lesson l ON l.id = q.lessonId
     JOIN Course c ON c.id = q.courseId
     JOIN Section sec ON sec.id = q.sectionId
     JOIN User u ON u.id = s.studentId
     WHERE q.instructorId = ?
     ORDER BY s.createdAt DESC`,
    req.auth!.userId,
  )) as Array<any>;

  const normalizedV2 = v2Rows.map((r) => ({
    id: r.id,
    quizId: r.quizId,
    studentId: r.studentId,
    score: Number(r.score || 0),
    total: Number(r.total || 0),
    createdAt: r.createdAt,
    student: {
      id: r.studentId,
      fullName: r.fullName,
      email: r.email,
    },
    quiz: {
      id: r.quizId,
      passingPercentage: r.passingPercentage,
      showScoreInStudentScores: Boolean(r.showScoreInStudentScores),
      lesson: {
        id: r.lessonId,
        title: r.lessonTitle || r.quizTitle || "Quiz",
        sectionName: r.sectionName || null,
        course: {
          id: r.courseId,
          title: r.courseTitle || "Course",
        },
      },
    },
  }));
  res.json([...normalizedV2, ...attempts]);
});

export default router;
