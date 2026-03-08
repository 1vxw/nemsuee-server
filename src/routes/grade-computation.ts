import { Router } from "express";
import { prisma } from "../db.js";
import { requireAnyRole, requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessCourse } from "../modules/courses/access.js";
import {
  computeCourseGradeRows,
  computeTermGrade,
  getDefaultWeights,
  getStudentSourceAverages,
  normalizeWeights,
  toEquivalentGrade,
  type GradingPeriod,
} from "../services/gradeEngine.js";
import { emitNotificationAction } from "../services/notifications.js";

const router = Router();
router.use(requireAuth);

async function ensureTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS GradeComputation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      quizAvg REAL NOT NULL DEFAULT 0,
      assignmentAvg REAL NOT NULL DEFAULT 0,
      activityAvg REAL NOT NULL DEFAULT 0,
      midterm REAL NOT NULL DEFAULT 0,
      finals REAL NOT NULL DEFAULT 0,
      attendance REAL NOT NULL DEFAULT 0,
      semester TEXT NOT NULL DEFAULT '1st Semester',
      term TEXT NOT NULL DEFAULT '2025',
      gradingPeriod TEXT NOT NULL DEFAULT 'MIDTERM',
      computedPercentage REAL NOT NULL DEFAULT 0,
      equivalentGrade REAL NOT NULL DEFAULT 5,
      result TEXT NOT NULL DEFAULT 'FAILED',
      isLocked INTEGER NOT NULL DEFAULT 0,
      reviewStatus TEXT NOT NULL DEFAULT 'DRAFT',
      reviewerId INTEGER,
      reviewerNote TEXT,
      submittedAt DATETIME,
      reviewedAt DATETIME,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(courseId, studentId, semester, term, gradingPeriod)
    )`,
  );

  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE GradeComputation ADD COLUMN reviewStatus TEXT NOT NULL DEFAULT 'DRAFT'`,
    );
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN reviewerId INTEGER`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN reviewerNote TEXT`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN submittedAt DATETIME`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN reviewedAt DATETIME`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN semester TEXT NOT NULL DEFAULT '1st Semester'`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN term TEXT NOT NULL DEFAULT 'Midterm'`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation ADD COLUMN gradingPeriod TEXT NOT NULL DEFAULT 'MIDTERM'`);
  } catch {}

  const indexes = (await prisma.$queryRawUnsafe(
    `PRAGMA index_list('GradeComputation')`,
  )) as Array<{ name: string; unique: number }>;
  let hasLegacyUnique = false;
  for (const idx of indexes) {
    if (!Number(idx.unique)) continue;
    const cols = (await prisma.$queryRawUnsafe(
      `PRAGMA index_info('${String(idx.name || "").replace(/'/g, "''")}')`,
    )) as Array<{ name: string }>;
    const names = cols.map((c) => String(c.name));
    if (
      names.length === 2 &&
      names.includes("courseId") &&
      names.includes("studentId")
    ) {
      hasLegacyUnique = true;
      break;
    }
  }
  if (hasLegacyUnique) {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS GradeComputation_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        courseId INTEGER NOT NULL,
        studentId INTEGER NOT NULL,
        quizAvg REAL NOT NULL DEFAULT 0,
        assignmentAvg REAL NOT NULL DEFAULT 0,
        activityAvg REAL NOT NULL DEFAULT 0,
        midterm REAL NOT NULL DEFAULT 0,
        finals REAL NOT NULL DEFAULT 0,
        attendance REAL NOT NULL DEFAULT 0,
        semester TEXT NOT NULL DEFAULT '1st Semester',
        term TEXT NOT NULL DEFAULT '2025',
        gradingPeriod TEXT NOT NULL DEFAULT 'MIDTERM',
        computedPercentage REAL NOT NULL DEFAULT 0,
        equivalentGrade REAL NOT NULL DEFAULT 5,
        result TEXT NOT NULL DEFAULT 'FAILED',
        isLocked INTEGER NOT NULL DEFAULT 0,
        reviewStatus TEXT NOT NULL DEFAULT 'DRAFT',
        reviewerId INTEGER,
        reviewerNote TEXT,
        submittedAt DATETIME,
        reviewedAt DATETIME,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(courseId, studentId, semester, term, gradingPeriod)
      )`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO GradeComputation_v2 (
        id, courseId, studentId, quizAvg, assignmentAvg, activityAvg, midterm, finals, attendance,
        semester, term, gradingPeriod, computedPercentage, equivalentGrade, result, isLocked,
        reviewStatus, reviewerId, reviewerNote, submittedAt, reviewedAt, updatedAt
      )
      SELECT id, courseId, studentId, quizAvg, assignmentAvg, activityAvg, midterm, finals, attendance,
             COALESCE(semester, '1st Semester'),
             CASE WHEN term IS NULL OR term = '' OR lower(term) IN ('midterm', 'finals') THEN 'Legacy' ELSE term END,
             CASE WHEN lower(term) = 'finals' THEN 'FINALS' ELSE COALESCE(gradingPeriod, 'MIDTERM') END,
             computedPercentage, equivalentGrade, result, isLocked,
             COALESCE(reviewStatus, 'DRAFT'), reviewerId, reviewerNote, submittedAt, reviewedAt, updatedAt
      FROM GradeComputation`,
    );
    await prisma.$executeRawUnsafe(`DROP TABLE GradeComputation`);
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeComputation_v2 RENAME TO GradeComputation`);
  }

  await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS GradeWeightProfile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        courseId INTEGER NOT NULL,
        semester TEXT NOT NULL DEFAULT '1st Semester',
        term TEXT NOT NULL DEFAULT 'Legacy',
        quiz REAL NOT NULL DEFAULT 25,
        assignment REAL NOT NULL DEFAULT 25,
        activity REAL NOT NULL DEFAULT 10,
        exam REAL NOT NULL DEFAULT 40,
      attendance REAL NOT NULL DEFAULT 0,
      midtermWeight REAL NOT NULL DEFAULT 50,
      finalsWeight REAL NOT NULL DEFAULT 50,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(courseId, semester, term)
    )`,
  );
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeWeightProfile ADD COLUMN midtermWeight REAL NOT NULL DEFAULT 50`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE GradeWeightProfile ADD COLUMN finalsWeight REAL NOT NULL DEFAULT 50`);
  } catch {}
}

async function getActiveGradingContext() {
  let semester = "1st Semester";
  let term = "Legacy";
  let gradingPeriod = "MIDTERM";

  try {
    const activeTermRows = (await prisma.$queryRawUnsafe(
      `SELECT name, academicYear FROM AcademicTerm WHERE isActive = 1 ORDER BY id DESC LIMIT 1`,
    )) as Array<{ name: string; academicYear: string }>;
    if (activeTermRows[0]?.name) semester = String(activeTermRows[0].name);
    if (activeTermRows[0]?.academicYear) term = String(activeTermRows[0].academicYear);
  } catch {}

  try {
    const settingsRows = (await prisma.$queryRawUnsafe(
      `SELECT payload FROM AppSettings WHERE scope = 'admin' LIMIT 1`,
    )) as Array<{ payload: string }>;
    if (settingsRows[0]?.payload) {
      const parsed = JSON.parse(settingsRows[0].payload);
      const activePeriod = String(parsed?.active_period || "1");
      gradingPeriod = activePeriod === "2" ? "FINALS" : "MIDTERM";
    }
  } catch {}

  return { semester, term, gradingPeriod };
}

async function getCourseWeights(
  courseId: number,
  semester: string,
  term: string,
) {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT quiz, assignment, activity, exam, attendance, midtermWeight, finalsWeight
     FROM GradeWeightProfile
     WHERE courseId = ? AND semester = ? AND term = ?
     ORDER BY datetime(updatedAt) DESC, id DESC
     LIMIT 1`,
    courseId,
    semester,
    term,
  )) as Array<{
    quiz: number;
    assignment: number;
    activity: number;
    exam: number;
    attendance: number;
    midtermWeight: number;
    finalsWeight: number;
  }>;

  if (!rows[0]) {
    return normalizeWeights(null);
  }
  return normalizeWeights(rows[0]);
}

router.get("/course/:courseId/weights", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  await ensureTable();
  const context = await getActiveGradingContext();
  const weights = await getCourseWeights(courseId, context.semester, context.term);
  res.json({ weights });
});

router.patch("/course/:courseId/weights", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  await ensureTable();
  const context = await getActiveGradingContext();
  const weights = normalizeWeights(req.body?.weights);

  const existing = (await prisma.$queryRawUnsafe(
    `SELECT id FROM GradeWeightProfile
     WHERE courseId = ? AND semester = ? AND term = ?
     ORDER BY datetime(updatedAt) DESC, id DESC
     LIMIT 1`,
    courseId,
    context.semester,
    context.term,
  )) as Array<{ id: number }>;

  if (existing[0]?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE GradeWeightProfile
       SET quiz = ?, assignment = ?, activity = ?, exam = ?, attendance = ?, midtermWeight = ?, finalsWeight = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      weights.quiz,
      weights.assignment,
      weights.activity,
      weights.exam,
      weights.attendance,
      weights.midtermWeight,
      weights.finalsWeight,
      Number(existing[0].id),
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO GradeWeightProfile (
        courseId, semester, term, quiz, assignment, activity, exam, attendance, midtermWeight, finalsWeight, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      courseId,
      context.semester,
      context.term,
      weights.quiz,
      weights.assignment,
      weights.activity,
      weights.exam,
      weights.attendance,
      weights.midtermWeight,
      weights.finalsWeight,
    );
  }

  res.json({ weights });
});

router.get("/course/:courseId", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  await ensureTable();
  const context = await getActiveGradingContext();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT gc.*, u.fullName as studentName, s.name as blockName
     FROM GradeComputation gc
     JOIN User u ON u.id = gc.studentId
     LEFT JOIN Enrollment e ON e.courseId = gc.courseId AND e.studentId = gc.studentId
     LEFT JOIN Section s ON s.id = e.sectionId
     WHERE gc.courseId = ?
       AND gc.semester = ?
       AND gc.term = ?
       AND gc.gradingPeriod = ?
     ORDER BY s.name ASC, u.fullName ASC`,
    courseId,
    context.semester,
    context.term,
    context.gradingPeriod,
  )) as Array<any>;
  res.json(rows);
});

router.get("/course/:courseId/computed", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  await ensureTable();
  const context = await getActiveGradingContext();
  const weights = await getCourseWeights(courseId, context.semester, context.term);
  const rows = await computeCourseGradeRows({
    courseId,
    semester: context.semester,
    term: context.term,
    gradingPeriod: context.gradingPeriod,
    weights,
  });
  res.json({
    context,
    weights,
    rows,
  });
});

router.patch("/course/:courseId/student/:studentId", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const studentId = Number(req.params.studentId);
  const {
    midterm = 0,
    finals = 0,
    attendance = 0,
    isLocked,
  } = req.body || {};

  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await ensureTable();
  const context = await getActiveGradingContext();
  const period = (String(context.gradingPeriod).toUpperCase() === "FINALS" ? "FINALS" : "MIDTERM") as GradingPeriod;
  const storedWeights = await getCourseWeights(courseId, context.semester, context.term);
  const sourceAverages = await getStudentSourceAverages(courseId, studentId);
  const computedPercentage = computeTermGrade({
    period,
    quizAvg: sourceAverages.quizAvg,
    assignmentAvg: sourceAverages.assignmentAvg,
    activityAvg: sourceAverages.activityAvg,
    midterm: Number(midterm || 0),
    finals: Number(finals || 0),
    attendance: Number(attendance || 0),
    weights: storedWeights,
  });
  const equivalentGrade = toEquivalentGrade(computedPercentage);
  const result = equivalentGrade <= 3 ? "PASSED" : "FAILED";

  await prisma.$executeRawUnsafe(
    `INSERT INTO GradeComputation (
      courseId, studentId, quizAvg, assignmentAvg, activityAvg, midterm, finals, attendance, semester, term, gradingPeriod,
      computedPercentage, equivalentGrade, result, isLocked, reviewStatus, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', CURRENT_TIMESTAMP)
    ON CONFLICT(courseId, studentId, semester, term, gradingPeriod)
    DO UPDATE SET
      quizAvg = excluded.quizAvg,
      assignmentAvg = excluded.assignmentAvg,
      activityAvg = excluded.activityAvg,
      midterm = excluded.midterm,
      finals = excluded.finals,
      attendance = excluded.attendance,
      computedPercentage = excluded.computedPercentage,
      equivalentGrade = excluded.equivalentGrade,
      result = excluded.result,
      isLocked = COALESCE(?, GradeComputation.isLocked),
      reviewStatus = CASE WHEN GradeComputation.reviewStatus = 'APPROVED' THEN 'APPROVED' ELSE 'DRAFT' END,
      reviewerId = NULL,
      reviewerNote = NULL,
      reviewedAt = NULL,
      updatedAt = CURRENT_TIMESTAMP`,
    courseId,
    studentId,
    Number(sourceAverages.quizAvg || 0),
    Number(sourceAverages.assignmentAvg || 0),
    Number(sourceAverages.activityAvg || 0),
    Number(midterm || 0),
    Number(finals || 0),
    Number(attendance || 0),
    context.semester,
    context.term,
    context.gradingPeriod,
    Number(computedPercentage || 0),
    Number(equivalentGrade || 5),
    String(result),
    typeof isLocked === "boolean" ? (isLocked ? 1 : 0) : 0,
    typeof isLocked === "boolean" ? (isLocked ? 1 : 0) : null,
  );

  res.json({ ok: true });
});

router.post("/course/:courseId/student/:studentId/submit", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const studentId = Number(req.params.studentId);

  if (!(await canAccessCourse(req.auth!.userId, courseId))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await ensureTable();
  const context = await getActiveGradingContext();

  await prisma.$executeRawUnsafe(
    `UPDATE GradeComputation
     SET isLocked = 1,
         reviewStatus = 'PENDING',
         submittedAt = CURRENT_TIMESTAMP,
         reviewerId = NULL,
         reviewerNote = NULL,
         reviewedAt = NULL,
         updatedAt = CURRENT_TIMESTAMP
     WHERE courseId = ? AND studentId = ? AND semester = ? AND term = ? AND gradingPeriod = ?`,
    courseId,
    studentId,
    context.semester,
    context.term,
    context.gradingPeriod,
  );

  res.json({ ok: true });
});

router.get("/review/pending", requireAnyRole(["ADMIN", "DEAN", "REGISTRAR"]), async (_req, res) => {
  await ensureTable();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT gc.courseId,
            e.sectionId as blockId,
            COALESCE(s.name, 'Unassigned') as blockName,
            gc.semester,
            gc.term,
            gc.gradingPeriod,
            COUNT(gc.id) as studentCount,
            ROUND(AVG(gc.computedPercentage), 2) as avgComputedPercentage,
            ROUND(AVG(gc.equivalentGrade), 2) as avgEquivalentGrade,
            MIN(CAST(gc.submittedAt AS TEXT)) as submittedAt,
            c.title as courseTitle
     FROM GradeComputation gc
     JOIN Course c ON c.id = gc.courseId
     LEFT JOIN Enrollment e ON e.courseId = gc.courseId AND e.studentId = gc.studentId
     LEFT JOIN Section s ON s.id = e.sectionId
     WHERE gc.reviewStatus = 'PENDING'
     GROUP BY gc.courseId, e.sectionId, COALESCE(s.name, 'Unassigned'), gc.semester, gc.term, gc.gradingPeriod, c.title
     ORDER BY datetime(MIN(gc.submittedAt)) ASC, gc.courseId ASC, blockName ASC`,
  )) as Array<any>;
  const normalized = rows.map((row) => ({
    ...row,
    courseId: Number(row.courseId),
    blockId:
      row.blockId === null || row.blockId === undefined
        ? null
        : Number(row.blockId),
    studentCount: Number(row.studentCount || 0),
    avgComputedPercentage: Number(row.avgComputedPercentage || 0),
    avgEquivalentGrade: Number(row.avgEquivalentGrade || 0),
  }));
  res.json(normalized);
});

router.patch("/review/block", requireAnyRole(["ADMIN", "DEAN"]), async (req, res) => {
  const {
    courseId: rawCourseId,
    blockId: rawBlockId,
    semester,
    term,
    gradingPeriod,
    action,
    note,
  } = req.body || {};
  const courseId = Number(rawCourseId);
  const blockId =
    rawBlockId === null || rawBlockId === undefined || rawBlockId === ""
      ? null
      : Number(rawBlockId);
  const nextStatus = String(action) === "APPROVE" ? "APPROVED" : "REJECTED";

  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ message: "Invalid course id" });
  }

  await ensureTable();

  const pendingRows = (await prisma.$queryRawUnsafe(
    `SELECT gc.id, gc.studentId, gc.courseId
     FROM GradeComputation gc
     LEFT JOIN Enrollment e ON e.courseId = gc.courseId AND e.studentId = gc.studentId
     WHERE gc.courseId = ?
       AND gc.reviewStatus = 'PENDING'
       AND gc.semester = ?
       AND gc.term = ?
       AND gc.gradingPeriod = ?
       AND (
         (? IS NULL AND e.sectionId IS NULL) OR
         e.sectionId = ?
       )`,
    courseId,
    String(semester || ""),
    String(term || ""),
    String(gradingPeriod || ""),
    blockId,
    blockId,
  )) as Array<{ id: number; studentId: number; courseId: number }>;

  if (!pendingRows.length) {
    return res.status(404).json({ message: "No pending grade records found for this block." });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE GradeComputation
     SET reviewStatus = ?,
         reviewerId = ?,
         reviewerNote = ?,
         reviewedAt = CURRENT_TIMESTAMP,
         updatedAt = CURRENT_TIMESTAMP
     WHERE id IN (${pendingRows.map(() => "?").join(",")})`,
    nextStatus,
    req.auth!.userId,
    note ? String(note) : null,
    ...pendingRows.map((r) => r.id),
  );

  if (nextStatus === "APPROVED") {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    for (const row of pendingRows) {
      await emitNotificationAction({
        actionType: "GRADEBOOK_PUBLISHED",
        message: `Your grade in ${course?.title || "course"} is now available.`,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        courseId: row.courseId,
        visibility: "PERSONAL",
        targetUserId: row.studentId,
      });
    }
  }

  res.json({ ok: true, status: nextStatus, affected: pendingRows.length });
});

router.get("/review/block", requireAnyRole(["ADMIN", "DEAN", "REGISTRAR"]), async (req, res) => {
  const courseId = Number(req.query.courseId);
  const blockIdRaw = String(req.query.blockId ?? "");
  const semester = String(req.query.semester || "");
  const term = String(req.query.term || "");
  const gradingPeriod = String(req.query.gradingPeriod || "");
  const hasBlock = blockIdRaw !== "" && blockIdRaw !== "null" && blockIdRaw !== "undefined";
  const blockId = hasBlock ? Number(blockIdRaw) : null;

  if (!Number.isFinite(courseId) || !semester || !term || !gradingPeriod) {
    return res.status(400).json({ message: "Missing or invalid block review query params." });
  }

  await ensureTable();

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT gc.id,
            gc.studentId,
            u.fullName as studentName,
            gc.computedPercentage,
            gc.equivalentGrade,
            gc.result,
            gc.reviewStatus,
            CAST(gc.submittedAt AS TEXT) as submittedAt
     FROM GradeComputation gc
     JOIN User u ON u.id = gc.studentId
     LEFT JOIN Enrollment e ON e.courseId = gc.courseId AND e.studentId = gc.studentId
     WHERE gc.courseId = ?
       AND gc.reviewStatus = 'PENDING'
       AND gc.semester = ?
       AND gc.term = ?
       AND gc.gradingPeriod = ?
       AND (
         (? IS NULL AND e.sectionId IS NULL) OR
         e.sectionId = ?
       )
     ORDER BY u.fullName ASC`,
    courseId,
    semester,
    term,
    gradingPeriod,
    blockId,
    blockId,
  )) as Array<any>;

  const normalized = rows.map((row) => ({
    id: Number(row.id),
    studentId: Number(row.studentId),
    studentName: String(row.studentName || "Student"),
    computedPercentage: Number(row.computedPercentage || 0),
    equivalentGrade: Number(row.equivalentGrade || 0),
    result: String(row.result || "FAILED"),
    reviewStatus: String(row.reviewStatus || "PENDING"),
    submittedAt: row.submittedAt || null,
  }));

  res.json(normalized);
});

router.patch("/review/:id", requireAnyRole(["ADMIN", "DEAN"]), async (req, res) => {
  const id = Number(req.params.id);
  const { action, note } = req.body || {};
  const nextStatus = String(action) === "APPROVE" ? "APPROVED" : "REJECTED";

  await ensureTable();

  const current = (await prisma.$queryRawUnsafe(
    `SELECT id, courseId, studentId FROM GradeComputation WHERE id = ?`,
    id,
  )) as Array<{ id: number; courseId: number; studentId: number }>;
  const row = current[0];
  if (!row) return res.status(404).json({ message: "Grade record not found" });

  await prisma.$executeRawUnsafe(
    `UPDATE GradeComputation
     SET reviewStatus = ?,
         reviewerId = ?,
         reviewerNote = ?,
         reviewedAt = CURRENT_TIMESTAMP,
         updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    nextStatus,
    req.auth!.userId,
    note ? String(note) : null,
    id,
  );

  if (nextStatus === "APPROVED") {
    const course = await prisma.course.findUnique({ where: { id: row.courseId } });
    await emitNotificationAction({
      actionType: "GRADEBOOK_PUBLISHED",
      message: `Your grade in ${course?.title || "course"} is now available.`,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      courseId: row.courseId,
      visibility: "PERSONAL",
      targetUserId: row.studentId,
    });
  }

  res.json({ ok: true, status: nextStatus });
});

router.get("/me", requireRole("STUDENT"), async (req, res) => {
  const semester = String(req.query.semester || "").trim();
  const term = String(req.query.term || "").trim();
  const gradingPeriod = String(req.query.gradingPeriod || "").trim().toUpperCase();
  await ensureTable();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT gc.*, c.title as courseTitle
     FROM GradeComputation gc
     JOIN Course c ON c.id = gc.courseId
     JOIN Enrollment e ON e.courseId = gc.courseId AND e.studentId = gc.studentId
     WHERE gc.studentId = ? AND gc.reviewStatus = 'APPROVED' AND e.status = 'APPROVED'
       AND (? = '' OR gc.semester = ?)
       AND (? = '' OR gc.term = ?)
       AND (? = '' OR gc.gradingPeriod = ?)
     ORDER BY datetime(gc.updatedAt) DESC, gc.id DESC`,
    req.auth!.userId,
    semester,
    semester,
    term,
    term,
    gradingPeriod,
    gradingPeriod,
  )) as Array<any>;
  res.json(rows);
});

router.get("/me/final-course", requireRole("STUDENT"), async (req, res) => {
  const semester = String(req.query.semester || "").trim();
  const term = String(req.query.term || "").trim();
  await ensureTable();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT gc.*, c.title as courseTitle
     FROM GradeComputation gc
     JOIN Course c ON c.id = gc.courseId
     JOIN Enrollment e ON e.courseId = gc.courseId AND e.studentId = gc.studentId
     WHERE gc.studentId = ? AND gc.reviewStatus = 'APPROVED' AND e.status = 'APPROVED'
       AND (? = '' OR gc.semester = ?)
       AND (? = '' OR gc.term = ?)
     ORDER BY gc.courseId ASC, datetime(gc.updatedAt) DESC, gc.id DESC`,
    req.auth!.userId,
    semester,
    semester,
    term,
    term,
  )) as Array<any>;

  const grouped = new Map<number, { courseId: number; courseTitle: string; midterm?: any; finals?: any }>();
  for (const row of rows) {
    const courseId = Number(row.courseId);
    if (!grouped.has(courseId)) {
      grouped.set(courseId, {
        courseId,
        courseTitle: String(row.courseTitle || "Course"),
      });
    }
    const entry = grouped.get(courseId)!;
    const period = String(row.gradingPeriod || "").toUpperCase();
    if (period === "FINALS") entry.finals = row;
    else entry.midterm = row;
  }

  const result: Array<any> = [];
  for (const g of Array.from(grouped.values())) {
    const midtermPercent = g.midterm ? Number(g.midterm.computedPercentage || 0) : null;
    const finalsPercent = g.finals ? Number(g.finals.computedPercentage || 0) : null;
    const midtermGrade = midtermPercent === null ? null : toEquivalentGrade(midtermPercent);
    const finalsGrade = finalsPercent === null ? null : toEquivalentGrade(finalsPercent);
    const baseRow = g.finals || g.midterm;
    const profile = baseRow
      ? await getCourseWeights(Number(g.courseId), String(baseRow.semester || ""), String(baseRow.term || ""))
      : getDefaultWeights();
    const midtermCourseWeight = Number(profile.midtermWeight || 50);
    const finalsCourseWeight = Number(profile.finalsWeight || 50);
    const courseWeightTotal = Math.max(1, midtermCourseWeight + finalsCourseWeight);

    const finalCoursePercent =
      midtermPercent !== null && finalsPercent !== null
        ? (midtermPercent * midtermCourseWeight + finalsPercent * finalsCourseWeight) / courseWeightTotal
        : finalsPercent !== null
          ? finalsPercent
          : midtermPercent !== null
            ? midtermPercent
            : null;
    const finalCourseGrade = finalCoursePercent === null ? null : toEquivalentGrade(finalCoursePercent);
    const equivalentGrade = finalCourseGrade;
    const gradeResult = equivalentGrade === null ? "INCOMPLETE" : equivalentGrade <= 3 ? "PASSED" : "FAILED";
    result.push({
      courseId: g.courseId,
      courseTitle: g.courseTitle,
      midtermGrade,
      finalsGrade,
      midtermPercent,
      finalsPercent,
      finalCoursePercent,
      midtermCourseWeight,
      finalsCourseWeight,
      finalCourseGrade,
      equivalentGrade,
      result: gradeResult,
      midtermRowId: g.midterm?.id || null,
      finalsRowId: g.finals?.id || null,
    });
  }

  res.json(result);
});

export default router;

