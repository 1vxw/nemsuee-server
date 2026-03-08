import { prisma } from "../db.js";

export type GradingPeriod = "MIDTERM" | "FINALS";

export type GradeWeights = {
  quiz: number;
  assignment: number;
  activity: number;
  exam: number;
  attendance: number;
  midtermWeight: number;
  finalsWeight: number;
};

export type GradeComputationMeta = {
  id: number | null;
  midterm: number;
  finals: number;
  attendance: number;
  isLocked: boolean;
  reviewStatus: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
};

export type ComputedStudentGradeRow = {
  studentId: number;
  studentName: string;
  blockName: string;
  quizAvg: number;
  assignmentAvg: number;
  activityAvg: number;
  midterm: number;
  finals: number;
  attendance: number;
  computedPercentage: number;
  equivalentGrade: number;
  result: "PASSED" | "FAILED";
  isLocked: boolean;
  reviewStatus: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
  recordId: number | null;
};

export function getDefaultWeights(): GradeWeights {
  return {
    quiz: 30,
    assignment: 20,
    activity: 20,
    exam: 25,
    attendance: 5,
    midtermWeight: 50,
    finalsWeight: 50,
  };
}

export function normalizeWeights(incoming: unknown): GradeWeights {
  const fallback = getDefaultWeights();
  if (!incoming || typeof incoming !== "object") return fallback;
  const payload = incoming as Record<string, unknown>;
  return {
    quiz: Number.isFinite(Number(payload.quiz)) ? Number(payload.quiz) : fallback.quiz,
    assignment: Number.isFinite(Number(payload.assignment))
      ? Number(payload.assignment)
      : fallback.assignment,
    activity: Number.isFinite(Number(payload.activity))
      ? Number(payload.activity)
      : fallback.activity,
    exam: Number.isFinite(Number(payload.exam)) ? Number(payload.exam) : fallback.exam,
    attendance: Number.isFinite(Number(payload.attendance))
      ? Number(payload.attendance)
      : fallback.attendance,
    midtermWeight: Number.isFinite(Number(payload.midtermWeight))
      ? Number(payload.midtermWeight)
      : fallback.midtermWeight,
    finalsWeight: Number.isFinite(Number(payload.finalsWeight))
      ? Number(payload.finalsWeight)
      : fallback.finalsWeight,
  };
}

export function computeTermGrade(params: {
  period: GradingPeriod;
  quizAvg: number;
  assignmentAvg: number;
  activityAvg: number;
  midterm: number;
  finals: number;
  attendance: number;
  weights: GradeWeights;
}) {
  const examScore = params.period === "FINALS" ? params.finals : params.midterm;
  const totalWeight =
    params.weights.quiz +
    params.weights.assignment +
    params.weights.activity +
    params.weights.exam +
    params.weights.attendance;
  const numerator =
    params.quizAvg * params.weights.quiz +
    params.assignmentAvg * params.weights.assignment +
    params.activityAvg * params.weights.activity +
    examScore * params.weights.exam +
    params.attendance * params.weights.attendance;
  return totalWeight > 0 ? numerator / totalWeight : 0;
}

export function toEquivalentGrade(percent: number) {
  const clamped = Math.max(0, Math.min(100, Number(percent || 0)));
  return Math.max(1, Math.min(5, Number((1 + (100 - clamped) / 20).toFixed(2))));
}

export async function getCourseSourceAverages(courseId: number) {
  const rosterRows = (await prisma.$queryRawUnsafe(
    `SELECT e.studentId, u.fullName as studentName, COALESCE(s.name, 'Unassigned') as blockName
     FROM Enrollment e
     JOIN User u ON u.id = e.studentId
     LEFT JOIN Section s ON s.id = e.sectionId
     WHERE e.courseId = ? AND e.status = 'APPROVED'
     ORDER BY COALESCE(s.name, 'Unassigned') ASC, u.fullName ASC`,
    courseId,
  )) as Array<{ studentId: number; studentName: string; blockName: string }>;

  const quizRows = (await prisma.$queryRawUnsafe(
    `WITH latest_quiz AS (
      SELECT a.studentId,
             l.id as lessonId,
             (CAST(a.score AS REAL) / CASE WHEN a.total = 0 THEN 1 ELSE a.total END) * 100 as pct,
             ROW_NUMBER() OVER (
               PARTITION BY a.studentId, l.id
               ORDER BY datetime(a.createdAt) DESC, a.id DESC
             ) as rn
      FROM Attempt a
      JOIN Quiz q ON q.id = a.quizId
      JOIN Lesson l ON l.id = q.lessonId
      WHERE l.courseId = ?
    )
    SELECT studentId, AVG(pct) as quizAvg
    FROM latest_quiz
    WHERE rn = 1
    GROUP BY studentId`,
    courseId,
  )) as Array<{ studentId: number; quizAvg: number }>;

  let assignmentRows: Array<{ studentId: number; assignmentAvg: number }> = [];
  try {
    assignmentRows = (await prisma.$queryRawUnsafe(
      `WITH latest_grade AS (
      SELECT ts.studentId,
             ct.id as taskId,
             ts.grade as grade,
             ROW_NUMBER() OVER (
               PARTITION BY ts.studentId, ct.id
               ORDER BY datetime(ts.createdAt) DESC, ts.id DESC
             ) as rn
      FROM TaskSubmission ts
      JOIN CourseTask ct ON ct.id = ts.taskId
      WHERE ct.courseId = ? AND ct.kind = 'ASSIGNMENT' AND ts.grade IS NOT NULL
    )
    SELECT studentId, AVG(grade) as assignmentAvg
    FROM latest_grade
    WHERE rn = 1
    GROUP BY studentId`,
    courseId,
    )) as Array<{ studentId: number; assignmentAvg: number }>;
  } catch {
    assignmentRows = [];
  }

  let activityRows: Array<{ studentId: number; activityAvg: number }> = [];
  try {
    activityRows = (await prisma.$queryRawUnsafe(
      `WITH latest_grade AS (
      SELECT ts.studentId,
             ct.id as taskId,
             ts.grade as grade,
             ROW_NUMBER() OVER (
               PARTITION BY ts.studentId, ct.id
               ORDER BY datetime(ts.createdAt) DESC, ts.id DESC
             ) as rn
      FROM TaskSubmission ts
      JOIN CourseTask ct ON ct.id = ts.taskId
      WHERE ct.courseId = ? AND ct.kind = 'ACTIVITY' AND ts.grade IS NOT NULL
    )
    SELECT studentId, AVG(grade) as activityAvg
    FROM latest_grade
    WHERE rn = 1
    GROUP BY studentId`,
    courseId,
    )) as Array<{ studentId: number; activityAvg: number }>;
  } catch {
    activityRows = [];
  }

  return { rosterRows, quizRows, assignmentRows, activityRows };
}

export async function getSavedGradeMeta(params: {
  courseId: number;
  semester: string;
  term: string;
  gradingPeriod: string;
}) {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, studentId, midterm, finals, attendance, isLocked, reviewStatus
     FROM GradeComputation
     WHERE courseId = ? AND semester = ? AND term = ? AND gradingPeriod = ?`,
    params.courseId,
    params.semester,
    params.term,
    params.gradingPeriod,
  )) as Array<{
    id: number;
    studentId: number;
    midterm: number;
    finals: number;
    attendance: number;
    isLocked: number;
    reviewStatus: string;
  }>;

  const byStudent = new Map<number, GradeComputationMeta>();
  for (const row of rows) {
    byStudent.set(Number(row.studentId), {
      id: Number(row.id),
      midterm: Number(row.midterm || 0),
      finals: Number(row.finals || 0),
      attendance: Number(row.attendance || 0),
      isLocked: Boolean(row.isLocked),
      reviewStatus: String(row.reviewStatus || "DRAFT") as GradeComputationMeta["reviewStatus"],
    });
  }
  return byStudent;
}

export async function computeCourseGradeRows(params: {
  courseId: number;
  semester: string;
  term: string;
  gradingPeriod: string;
  weights: GradeWeights;
}) {
  const period = (String(params.gradingPeriod).toUpperCase() === "FINALS"
    ? "FINALS"
    : "MIDTERM") as GradingPeriod;
  const { rosterRows, quizRows, assignmentRows, activityRows } =
    await getCourseSourceAverages(params.courseId);
  const savedMeta = await getSavedGradeMeta(params);

  const quizByStudent = new Map<number, number>(
    quizRows.map((row) => [Number(row.studentId), Number(row.quizAvg || 0)]),
  );
  const assignmentByStudent = new Map<number, number>(
    assignmentRows.map((row) => [
      Number(row.studentId),
      Number(row.assignmentAvg || 0),
    ]),
  );
  const activityByStudent = new Map<number, number>(
    activityRows.map((row) => [Number(row.studentId), Number(row.activityAvg || 0)]),
  );

  const computedRows: ComputedStudentGradeRow[] = rosterRows.map((row) => {
    const studentId = Number(row.studentId);
    const meta = savedMeta.get(studentId);
    const quizAvg = quizByStudent.get(studentId) ?? 0;
    const assignmentAvg = assignmentByStudent.get(studentId) ?? 0;
    const activityAvg = activityByStudent.get(studentId) ?? 0;
    const midterm = Number(meta?.midterm ?? 0);
    const finals = Number(meta?.finals ?? 0);
    const attendance = Number(meta?.attendance ?? 0);
    const computedPercentage = computeTermGrade({
      period,
      quizAvg,
      assignmentAvg,
      activityAvg,
      midterm,
      finals,
      attendance,
      weights: params.weights,
    });
    const equivalentGrade = toEquivalentGrade(computedPercentage);
    const result = equivalentGrade <= 3 ? "PASSED" : "FAILED";

    return {
      studentId,
      studentName: String(row.studentName || "Student"),
      blockName: String(row.blockName || "Unassigned"),
      quizAvg,
      assignmentAvg,
      activityAvg,
      midterm,
      finals,
      attendance,
      computedPercentage,
      equivalentGrade,
      result,
      isLocked: Boolean(meta?.isLocked),
      reviewStatus: meta?.reviewStatus || "DRAFT",
      recordId: meta?.id || null,
    };
  });

  return computedRows;
}

export async function getStudentSourceAverages(courseId: number, studentId: number) {
  const quizRows = (await prisma.$queryRawUnsafe(
    `WITH latest_quiz AS (
      SELECT l.id as lessonId,
             (CAST(a.score AS REAL) / CASE WHEN a.total = 0 THEN 1 ELSE a.total END) * 100 as pct,
             ROW_NUMBER() OVER (
               PARTITION BY l.id
               ORDER BY datetime(a.createdAt) DESC, a.id DESC
             ) as rn
      FROM Attempt a
      JOIN Quiz q ON q.id = a.quizId
      JOIN Lesson l ON l.id = q.lessonId
      WHERE l.courseId = ? AND a.studentId = ?
    )
    SELECT AVG(pct) as quizAvg
    FROM latest_quiz
    WHERE rn = 1`,
    courseId,
    studentId,
  )) as Array<{ quizAvg: number | null }>;

  let assignmentRows: Array<{ assignmentAvg: number | null }> = [];
  try {
    assignmentRows = (await prisma.$queryRawUnsafe(
      `WITH latest_grade AS (
      SELECT ct.id as taskId,
             ts.grade as grade,
             ROW_NUMBER() OVER (
               PARTITION BY ct.id
               ORDER BY datetime(ts.createdAt) DESC, ts.id DESC
             ) as rn
      FROM TaskSubmission ts
      JOIN CourseTask ct ON ct.id = ts.taskId
      WHERE ct.courseId = ? AND ct.kind = 'ASSIGNMENT' AND ts.studentId = ? AND ts.grade IS NOT NULL
    )
    SELECT AVG(grade) as assignmentAvg
    FROM latest_grade
    WHERE rn = 1`,
    courseId,
    studentId,
    )) as Array<{ assignmentAvg: number | null }>;
  } catch {
    assignmentRows = [{ assignmentAvg: 0 }];
  }

  let activityRows: Array<{ activityAvg: number | null }> = [];
  try {
    activityRows = (await prisma.$queryRawUnsafe(
      `WITH latest_grade AS (
      SELECT ct.id as taskId,
             ts.grade as grade,
             ROW_NUMBER() OVER (
               PARTITION BY ct.id
               ORDER BY datetime(ts.createdAt) DESC, ts.id DESC
             ) as rn
      FROM TaskSubmission ts
      JOIN CourseTask ct ON ct.id = ts.taskId
      WHERE ct.courseId = ? AND ct.kind = 'ACTIVITY' AND ts.studentId = ? AND ts.grade IS NOT NULL
    )
    SELECT AVG(grade) as activityAvg
    FROM latest_grade
    WHERE rn = 1`,
    courseId,
    studentId,
    )) as Array<{ activityAvg: number | null }>;
  } catch {
    activityRows = [{ activityAvg: 0 }];
  }

  return {
    quizAvg: Number(quizRows[0]?.quizAvg || 0),
    assignmentAvg: Number(assignmentRows[0]?.assignmentAvg || 0),
    activityAvg: Number(activityRows[0]?.activityAvg || 0),
  };
}
