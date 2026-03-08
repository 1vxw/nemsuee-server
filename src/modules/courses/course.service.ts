import { prisma } from "../../db.js";
import {
  ensureAcademicTermsStorage,
  getActiveTermCourseIds,
  getCourseTermMap,
} from "../terms/term.store.js";
import { ensureOfferingsStorage } from "../offerings/offering.store.js";

const lessonInclude = {
  include: { quiz: { include: { questions: true } } },
  orderBy: { id: "asc" as const },
};

const enrollmentInclude = {
  include: {
    student: { select: { id: true, fullName: true, email: true } },
  },
  orderBy: { createdAt: "desc" as const },
};

const sectionInclude = {
  orderBy: { id: "asc" as const },
  include: {
    lessons: lessonInclude,
    enrollments: enrollmentInclude,
  },
};

const courseInclude = {
  instructor: { select: { id: true, fullName: true } },
  sections: sectionInclude,
};

type SectionAccessRow = { courseId: number; sectionId: number };
type CourseLike = { id: number };

async function attachInstructors<T extends CourseLike>(courses: T[]) {
  if (!courses.length) return [];
  const courseIds = Array.from(new Set(courses.map((c) => c.id)));
  const placeholders = courseIds.map(() => "?").join(", ");
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT s.courseId, u.id, u.fullName, u.email
     FROM BlockInstructor bi
     JOIN Section s ON s.id = bi.sectionId
     JOIN User u ON u.id = bi.instructorId
     WHERE s.courseId IN (${placeholders})
     ORDER BY s.courseId ASC, u.fullName ASC`,
    ...courseIds,
  )) as Array<{ courseId: number; id: number; fullName: string; email: string }>;

  const byCourseId = new Map<number, Array<{ id: number; fullName: string; email: string }>>();
  for (const row of rows) {
    const list = byCourseId.get(row.courseId) || [];
    if (!list.some((i) => i.id === row.id)) {
      list.push({ id: row.id, fullName: row.fullName, email: row.email });
    }
    byCourseId.set(row.courseId, list);
  }
  return courses.map((course) => ({
    ...course,
    instructors: byCourseId.get(course.id) || [],
  }));
}

export async function getInstructorSectionAccess(instructorId: number) {
  return (await prisma.$queryRawUnsafe(
    `SELECT DISTINCT s.courseId
          , s.id as sectionId
     FROM BlockInstructor bi
     JOIN Section s ON s.id = bi.sectionId
     WHERE bi.instructorId = ?`,
    instructorId,
  )) as Array<SectionAccessRow>;
}

export async function listAdminCourses() {
  await ensureAcademicTermsStorage();
  await ensureOfferingsStorage();
  const courses = await prisma.course.findMany({
    include: courseInclude,
    orderBy: { id: "desc" },
  });
  const withInstructors = await attachInstructors(
    courses.filter((c: any) => !c.isArchived),
  );
  const termMap = await getCourseTermMap(withInstructors.map((c) => c.id));
  return withInstructors.map((course) => ({
    ...course,
    term: termMap.get(course.id) || null,
  }));
}

export async function listInstructorCourses(instructorId: number) {
  await ensureAcademicTermsStorage();
  await ensureOfferingsStorage();
  const accessibleRows = await getInstructorSectionAccess(instructorId);
  const activeTermCourseIds = new Set(await getActiveTermCourseIds());
  const courseIds = Array.from(
    new Set(accessibleRows.map((r: SectionAccessRow) => r.courseId)),
  ).filter((id) => activeTermCourseIds.has(id));
  const sectionIds = accessibleRows.map((r: SectionAccessRow) => r.sectionId);
  const courses = await prisma.course.findMany({
    where: courseIds.length ? { id: { in: courseIds } } : { id: -1 },
    take: 50,
    include: {
      instructor: { select: { id: true, fullName: true } },
      sections: {
        where: sectionIds.length ? { id: { in: sectionIds } } : { id: -1 },
        ...sectionInclude,
      },
    },
    orderBy: { id: "desc" },
  });
  const withInstructors = await attachInstructors(
    courses.filter((c: any) => !c.isArchived).slice(0, 5),
  );
  const termMap = await getCourseTermMap(withInstructors.map((c) => c.id));
  return withInstructors.map((course) => ({
    ...course,
    term: termMap.get(course.id) || null,
  }));
}

export async function listStudentCourses(studentId: number) {
  await ensureAcademicTermsStorage();
  await ensureOfferingsStorage();
  const activeTermCourseIds = new Set(await getActiveTermCourseIds());
  const approved = await prisma.enrollment.findMany({
    where: { studentId, status: "APPROVED" },
    take: 5,
    include: {
      section: {
        include: {
          lessons: lessonInclude,
        },
      },
      course: {
        include: { instructor: { select: { id: true, fullName: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const mapped = approved
    .filter(
      (e: any) =>
        !e.course?.isArchived && activeTermCourseIds.has(Number(e.course?.id)),
    )
    .map((e: (typeof approved)[number]) => ({
      id: e.course.id,
      title: e.course.title,
      description: e.course.description,
      instructor: e.course.instructor,
      sections: e.section
        ? [
            {
              id: e.section.id,
              name: e.section.name,
              lessons: e.section.lessons,
              enrollments: [],
            },
          ]
        : [],
    }));

  const withInstructors = await attachInstructors(mapped);
  const termMap = await getCourseTermMap(withInstructors.map((c) => c.id));
  return withInstructors.map((course) => ({
    ...course,
    term: termMap.get(course.id) || null,
  }));
}

export async function listCatalogCourses(studentId: number, query: string) {
  await ensureAcademicTermsStorage();
  await ensureOfferingsStorage();
  const activeTermCourseIds = await getActiveTermCourseIds();
  const normalizedQuery = query.trim();
  const matchingCourseIds = normalizedQuery
    ? ((await prisma.$queryRawUnsafe(
        `SELECT DISTINCT s.courseId
         FROM BlockInstructor bi
         JOIN Section s ON s.id = bi.sectionId
         JOIN User u ON u.id = bi.instructorId
         WHERE u.fullName LIKE ? OR u.email LIKE ?`,
        `%${normalizedQuery}%`,
        `%${normalizedQuery}%`,
      )) as Array<{ courseId: number }>).map((r) => r.courseId)
    : [];

  const courses = await prisma.course.findMany({
    where: {
      ...(normalizedQuery
        ? {
            OR: [
              { title: { contains: normalizedQuery } },
              { description: { contains: normalizedQuery } },
              ...(matchingCourseIds.length ? [{ id: { in: matchingCourseIds } }] : []),
            ],
          }
        : {}),
      ...(activeTermCourseIds.length
        ? { id: { in: activeTermCourseIds } }
        : { id: -1 }),
    },
    include: {
      instructor: { select: { fullName: true } },
      enrollments: {
        where: { studentId },
        select: { id: true, status: true },
      },
      sections: { select: { id: true, name: true }, orderBy: { id: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const mapped = courses
    .filter((c: any) => !c.isArchived)
    .map((c: (typeof courses)[number]) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      instructor: c.instructor,
      sections: c.sections,
      enrollmentStatus: c.enrollments[0]?.status || null,
    }));

  const withInstructors = await attachInstructors(mapped);
  const sliced = withInstructors.slice(0, 30);
  const termMap = await getCourseTermMap(sliced.map((c) => c.id));
  return sliced.map((course) => ({
    ...course,
    term: termMap.get(course.id) || null,
  }));
}

export async function listArchivedInstructorCourses(instructorId: number) {
  await ensureAcademicTermsStorage();
  await ensureOfferingsStorage();
  const accessibleRows = await getInstructorSectionAccess(instructorId);
  const ids = Array.from(
    new Set(accessibleRows.map((r: SectionAccessRow) => r.courseId)),
  );
  const sectionIds = accessibleRows.map((r: SectionAccessRow) => r.sectionId);
  const courses = await prisma.course.findMany({
    where: ids.length ? { id: { in: ids } } : { id: -1 },
    include: {
      instructor: { select: { id: true, fullName: true } },
      sections: {
        where: sectionIds.length ? { id: { in: sectionIds } } : { id: -1 },
        ...sectionInclude,
      },
    },
    orderBy: { id: "desc" },
  });

  const withInstructors = await attachInstructors(
    courses.filter((c: any) => Boolean(c.isArchived)),
  );
  const termMap = await getCourseTermMap(withInstructors.map((c) => c.id));
  return withInstructors.map((course) => ({
    ...course,
    term: termMap.get(course.id) || null,
  }));
}
