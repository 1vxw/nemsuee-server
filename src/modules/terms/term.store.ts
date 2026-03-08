import { prisma } from "../../db.js";

export type AcademicTermRow = {
  id: number;
  name: string;
  academicYear: string;
  startDate: string | null;
  endDate: string | null;
  isActive: number;
  isArchived: number;
  createdAt: string;
};

let initialized = false;

export async function ensureAcademicTermsStorage() {
  if (initialized) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS AcademicTerm (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      academicYear TEXT NOT NULL,
      startDate DATETIME,
      endDate DATETIME,
      isActive INTEGER NOT NULL DEFAULT 0,
      isArchived INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Course ADD COLUMN termId INTEGER`,
    );
  } catch {
    // Already exists.
  }

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id FROM AcademicTerm ORDER BY id ASC`,
  )) as Array<{ id: number }>;

  if (!rows.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO AcademicTerm (name, academicYear, isActive, isArchived)
       VALUES (?, ?, 1, 0)`,
      "Legacy Term",
      "Legacy",
    );
  }

  const active = (await prisma.$queryRawUnsafe(
    `SELECT id FROM AcademicTerm WHERE isActive = 1 ORDER BY id DESC LIMIT 1`,
  )) as Array<{ id: number }>;
  const activeId = Number(active[0]?.id || 0);
  if (activeId > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE Course SET termId = ? WHERE termId IS NULL`,
      activeId,
    );
  }

  initialized = true;
}

export async function getActiveTerm() {
  await ensureAcademicTermsStorage();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, name, academicYear, startDate, endDate, isActive, isArchived, createdAt
     FROM AcademicTerm
     WHERE isActive = 1
     ORDER BY id DESC
     LIMIT 1`,
  )) as AcademicTermRow[];
  return rows[0] || null;
}

export async function listTerms() {
  await ensureAcademicTermsStorage();
  return (await prisma.$queryRawUnsafe(
    `SELECT id, name, academicYear, startDate, endDate, isActive, isArchived, createdAt
     FROM AcademicTerm
     ORDER BY id DESC`,
  )) as AcademicTermRow[];
}

export async function getActiveTermCourseIds() {
  const active = await getActiveTerm();
  if (!active) return [];
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id FROM Course WHERE termId = ?`,
    active.id,
  )) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

export async function getCourseTermMap(courseIds: number[]) {
  await ensureAcademicTermsStorage();
  if (!courseIds.length) return new Map<number, AcademicTermRow | null>();
  const placeholders = courseIds.map(() => "?").join(", ");
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT c.id as courseId, t.id, t.name, t.academicYear, t.startDate, t.endDate, t.isActive, t.isArchived, t.createdAt
     FROM Course c
     LEFT JOIN AcademicTerm t ON t.id = c.termId
     WHERE c.id IN (${placeholders})`,
    ...courseIds,
  )) as Array<
    { courseId: number } & Omit<AcademicTermRow, "id"> & { id: number | null }
  >;
  const map = new Map<number, AcademicTermRow | null>();
  for (const row of rows) {
    if (!row.id) {
      map.set(row.courseId, null);
      continue;
    }
    map.set(row.courseId, {
      id: row.id,
      name: row.name,
      academicYear: row.academicYear,
      startDate: row.startDate,
      endDate: row.endDate,
      isActive: row.isActive,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
    });
  }
  return map;
}

