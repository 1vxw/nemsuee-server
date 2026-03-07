import { randomBytes } from "crypto";
import { prisma } from "../../db.js";

export async function canAccessCourse(userId: number, courseId: number) {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as c
     FROM BlockInstructor bi
     JOIN Section s ON s.id = bi.sectionId
     WHERE bi.instructorId = ? AND s.courseId = ?`,
    userId,
    courseId,
  )) as Array<{ c: number }>;
  return Number(rows[0]?.c || 0) > 0;
}

export async function canAccessSection(userId: number, sectionId: number) {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as c
     FROM BlockInstructor
     WHERE instructorId = ? AND sectionId = ?`,
    userId,
    sectionId,
  )) as Array<{ c: number }>;
  return Number(rows[0]?.c || 0) > 0;
}

export function generateEnrollmentKey() {
  return randomBytes(6).toString("base64url");
}

export async function isCourseArchived(courseId: number) {
  try {
    const course = await (prisma as any).course.findUnique({
      where: { id: courseId },
      select: { isArchived: true },
    });
    return Boolean(course?.isArchived);
  } catch {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT isArchived FROM Course WHERE id = ? LIMIT 1`,
      courseId,
    )) as Array<{ isArchived: number }>;
    return Boolean(rows[0]?.isArchived);
  }
}
