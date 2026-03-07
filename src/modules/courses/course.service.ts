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
  return courses.filter((c: any) => !c.isArchived);
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
  return courses.filter((c: any) => !c.isArchived).slice(0, 5);
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

  return approved
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
}

export async function listCatalogCourses(studentId: number, query: string) {
  const courses = await prisma.course.findMany({
    where: {
      ...(query
        ? {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
              { instructor: { fullName: { contains: query } } },
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
    take: 30,
  });

  return courses
    .filter((c: any) => !c.isArchived)
    .map((c: (typeof courses)[number]) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      instructor: c.instructor,
      sections: c.sections,
      enrollmentStatus: c.enrollments[0]?.status || null,
    }));
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

  return courses.filter((c: any) => Boolean(c.isArchived));
}
