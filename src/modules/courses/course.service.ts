import { prisma } from "../../db.js";

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
  const courses = await prisma.course.findMany({
    include: courseInclude,
    orderBy: { id: "desc" },
  });
  return attachInstructors(courses.filter((c: any) => !c.isArchived));
}

export async function listInstructorCourses(instructorId: number) {
  const accessibleRows = await getInstructorSectionAccess(instructorId);
  const courseIds = Array.from(
    new Set(accessibleRows.map((r: SectionAccessRow) => r.courseId)),
  );
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
  return attachInstructors(courses.filter((c: any) => !c.isArchived).slice(0, 5));
}

export async function listStudentCourses(studentId: number) {
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
    .filter((e: any) => !e.course?.isArchived)
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

  return attachInstructors(mapped);
}

export async function listCatalogCourses(studentId: number, query: string) {
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
  return withInstructors.slice(0, 30);
}

export async function listArchivedInstructorCourses(instructorId: number) {
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

  return attachInstructors(courses.filter((c: any) => Boolean(c.isArchived)));
}
