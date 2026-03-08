import { prisma } from "../../db.js";
import { ensureAcademicTermsStorage, getActiveTerm } from "../terms/term.store.js";

let initialized = false;

export async function ensureOfferingsStorage() {
  await ensureAcademicTermsStorage();
  if (initialized) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS CourseTemplate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS CourseOffering (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseTemplateId INTEGER NOT NULL,
      termId INTEGER NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Course ADD COLUMN courseTemplateId INTEGER`,
    );
  } catch {
    // exists
  }
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE Course ADD COLUMN offeringId INTEGER`);
  } catch {
    // exists
  }

  const courses = (await prisma.$queryRawUnsafe(
    `SELECT id, title, description, termId, courseTemplateId, offeringId FROM Course`,
  )) as Array<{
    id: number;
    title: string;
    description: string;
    termId: number | null;
    courseTemplateId: number | null;
    offeringId: number | null;
  }>;

  const active = await getActiveTerm();
  const activeTermId = Number(active?.id || 1);

  for (const course of courses) {
    let templateId = Number(course.courseTemplateId || 0);
    if (!templateId) {
      const existingTemplate = (await prisma.$queryRawUnsafe(
        `SELECT id FROM CourseTemplate
         WHERE lower(title) = lower(?) AND lower(description) = lower(?)
         ORDER BY id ASC LIMIT 1`,
        course.title,
        course.description || "",
      )) as Array<{ id: number }>;
      if (existingTemplate[0]?.id) {
        templateId = existingTemplate[0].id;
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO CourseTemplate (title, description) VALUES (?, ?)`,
          course.title,
          course.description || "",
        );
        const inserted = (await prisma.$queryRawUnsafe(
          `SELECT id FROM CourseTemplate WHERE rowid = last_insert_rowid()`,
        )) as Array<{ id: number }>;
        templateId = Number(inserted[0]?.id || 0);
      }
      if (templateId) {
        await prisma.$executeRawUnsafe(
          `UPDATE Course SET courseTemplateId = ? WHERE id = ?`,
          templateId,
          course.id,
        );
      }
    }

    let offeringId = Number(course.offeringId || 0);
    if (!offeringId && templateId) {
      const targetTermId = Number(course.termId || activeTermId);
      const existingOffering = (await prisma.$queryRawUnsafe(
        `SELECT id FROM CourseOffering
         WHERE courseTemplateId = ? AND termId = ?
         ORDER BY id ASC LIMIT 1`,
        templateId,
        targetTermId,
      )) as Array<{ id: number }>;
      if (existingOffering[0]?.id) {
        offeringId = existingOffering[0].id;
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO CourseOffering (courseTemplateId, termId) VALUES (?, ?)`,
          templateId,
          targetTermId,
        );
        const inserted = (await prisma.$queryRawUnsafe(
          `SELECT id FROM CourseOffering WHERE rowid = last_insert_rowid()`,
        )) as Array<{ id: number }>;
        offeringId = Number(inserted[0]?.id || 0);
      }
      if (offeringId) {
        await prisma.$executeRawUnsafe(
          `UPDATE Course SET offeringId = ?, termId = ? WHERE id = ?`,
          offeringId,
          targetTermId,
          course.id,
        );
      }
    }
  }
  initialized = true;
}

export async function createCourseOfferingFromPayload(params: {
  title: string;
  description: string;
  termId: number;
}) {
  await ensureOfferingsStorage();
  await prisma.$executeRawUnsafe(
    `INSERT INTO CourseTemplate (title, description) VALUES (?, ?)`,
    params.title,
    params.description || "",
  );
  const template = (await prisma.$queryRawUnsafe(
    `SELECT id, title, description FROM CourseTemplate WHERE rowid = last_insert_rowid()`,
  )) as Array<{ id: number; title: string; description: string }>;
  const templateId = Number(template[0]?.id || 0);
  await prisma.$executeRawUnsafe(
    `INSERT INTO CourseOffering (courseTemplateId, termId) VALUES (?, ?)`,
    templateId,
    params.termId,
  );
  const offering = (await prisma.$queryRawUnsafe(
    `SELECT id FROM CourseOffering WHERE rowid = last_insert_rowid()`,
  )) as Array<{ id: number }>;
  return {
    templateId,
    offeringId: Number(offering[0]?.id || 0),
  };
}

export async function listCourseOfferingsByTerm(termId: number) {
  await ensureOfferingsStorage();
  return (await prisma.$queryRawUnsafe(
    `SELECT o.id,
            o.termId,
            t.id as templateId,
            t.code,
            t.title,
            t.description,
            o.createdAt,
            c.id as courseId,
            c.instructorId,
            u.fullName as instructorName
     FROM CourseOffering o
     JOIN CourseTemplate t ON t.id = o.courseTemplateId
     LEFT JOIN Course c ON c.offeringId = o.id
     LEFT JOIN User u ON u.id = c.instructorId
     WHERE o.termId = ?
     ORDER BY o.id DESC`,
    termId,
  )) as Array<{
    id: number;
    termId: number;
    templateId: number;
    code: string | null;
    title: string;
    description: string;
    createdAt: string;
    courseId: number | null;
    instructorId: number | null;
    instructorName: string | null;
  }>;
}
