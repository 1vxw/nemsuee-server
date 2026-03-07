import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  canAccessCourse,
  canAccessSection,
  generateEnrollmentKey,
  isCourseArchived,
} from "../modules/courses/access.js";
import {
  listAdminCourses,
  listArchivedInstructorCourses,
  listCatalogCourses,
  listInstructorCourses,
  listStudentCourses,
} from "../modules/courses/course.service.js";
import {
  archiveSchema,
  assignInstructorSchema,
  courseSchema,
  enrollmentDecisionSchema,
  enrollSchema,
  lessonSchema,
  lessonUpdateSchema,
  manualAddSchema,
  sectionSchema,
  sectionUpdateSchema,
} from "../modules/courses/schemas.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  if (req.auth?.role === "ADMIN") {
    return res.json(await listAdminCourses());
  }
  if (req.auth?.role === "INSTRUCTOR") {
    return res.json(await listInstructorCourses(req.auth.userId));
  }
  return res.json(await listStudentCourses(req.auth!.userId));
});

router.get("/catalog", requireRole("STUDENT"), async (req, res) => {
  const query =
    typeof req.query.query === "string" ? req.query.query.trim() : "";
  res.json(await listCatalogCourses(req.auth!.userId, query));
});

router.get("/instructors", requireRole("ADMIN"), async (_req, res) => {
  const instructors = await prisma.user.findMany({
    where: { role: "INSTRUCTOR" },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: "asc" },
  });
  res.json(instructors);
});

router.get("/archived", requireRole("INSTRUCTOR"), async (req, res) => {
  return res.json(await listArchivedInstructorCourses(req.auth!.userId));
});

router.get("/teaching-blocks", requireRole("INSTRUCTOR"), async (req, res) => {
  const blocks = (await prisma.$queryRawUnsafe(
    `SELECT s.id, s.name, s.courseId, s.createdAt, c.title AS courseTitle, c.description AS courseDescription
     FROM Section s
     JOIN BlockInstructor bi ON bi.sectionId = s.id
     JOIN Course c ON c.id = s.courseId
     WHERE bi.instructorId = ?
     ORDER BY s.courseId ASC, s.id ASC`,
    req.auth!.userId,
  )) as Array<{
    id: number;
    name: string;
    courseId: number;
    createdAt: string;
    courseTitle: string;
    courseDescription: string;
  }>;
  res.json(blocks);
});

router.get("/:id/students", async (req, res) => {
  const id = Number(req.params.id);
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) return res.status(404).json({ message: "Course not found" });

  if (req.auth!.role === "INSTRUCTOR") {
    if (!(await canAccessCourse(req.auth!.userId, id)))
      return res.status(403).json({ message: "Forbidden" });

    const sectionRows = (await prisma.$queryRawUnsafe(
      `SELECT sectionId FROM BlockInstructor WHERE instructorId = ?`,
      req.auth!.userId,
    )) as Array<{ sectionId: number }>;
    const sectionIds = sectionRows.map((r: { sectionId: number }) => r.sectionId);

    const rows = await prisma.enrollment.findMany({
      where: {
        courseId: id,
        status: "APPROVED",
        sectionId: { in: sectionIds.length ? sectionIds : [-1] },
      },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        section: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return res.json(rows);
  }

  const myEnrollment = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: { courseId: id, studentId: req.auth!.userId },
    },
  });
  if (!myEnrollment || myEnrollment.status !== "APPROVED")
    return res.status(403).json({ message: "Not enrolled" });

  const rows = await prisma.enrollment.findMany({
    where: {
      courseId: id,
      status: "APPROVED",
      sectionId: myEnrollment.sectionId || undefined,
    },
    include: {
      student: { select: { id: true, fullName: true, email: true } },
      section: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return res.json(rows);
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      instructorId: req.auth!.userId,
      enrollmentKey: generateEnrollmentKey(),
      sections: { create: [{ name: "BLOCK-A" }] },
    },
    include: { sections: true },
  });

  res.status(201).json(course);
});

router.post("/:id/sections", requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = sectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) return res.status(404).json({ message: "Course not found" });

  const section = await prisma.section.create({
    data: { name: parsed.data.name.trim(), courseId: id },
  });
  res.status(201).json(section);
});

router.get("/:courseId/instructors", requireRole("ADMIN"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return res.status(404).json({ message: "Course not found" });

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT DISTINCT u.id, u.fullName, u.email
     FROM BlockInstructor bi
     JOIN Section s ON s.id = bi.sectionId
     JOIN User u ON u.id = bi.instructorId
     WHERE s.courseId = ?
     ORDER BY u.fullName ASC`,
    courseId,
  )) as Array<{ id: number; fullName: string; email: string }>;
  res.json(rows);
});

router.post(
  "/:courseId/instructors",
  requireRole("ADMIN"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const parsed = assignInstructorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ message: "Course not found" });
    const instructor = await prisma.user.findUnique({
      where: { id: parsed.data.instructorId },
    });
    if (!instructor || instructor.role !== "INSTRUCTOR")
      return res.status(400).json({ message: "Instructor not found" });

    const sections = await prisma.section.findMany({
      where: { courseId },
      select: { id: true },
    });
    for (const s of sections) {
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO BlockInstructor (sectionId, instructorId, role) VALUES (?, ?, ?)`,
        s.id,
        parsed.data.instructorId,
        parsed.data.role || "ASSISTANT",
      );
    }

    res.status(201).json({
      courseId,
      instructorId: parsed.data.instructorId,
      sectionsAssigned: sections.length,
    });
  },
);

router.delete(
  "/:courseId/instructors/:instructorId",
  requireRole("ADMIN"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const instructorId = Number(req.params.instructorId);

    const sections = await prisma.section.findMany({
      where: { courseId },
      select: { id: true },
    });
    if (!sections.length)
      return res.status(404).json({ message: "Course not found" });

    for (const s of sections) {
      const countRows = (await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM BlockInstructor WHERE sectionId = ?`,
        s.id,
      )) as Array<{ c: number }>;
      const count = Number(countRows[0]?.c || 0);
      const targetRows = (await prisma.$queryRawUnsafe(
        `SELECT id FROM BlockInstructor WHERE sectionId = ? AND instructorId = ? LIMIT 1`,
        s.id,
        instructorId,
      )) as Array<{ id: number }>;
      if (targetRows.length && count <= 1) {
        return res.status(400).json({
          message:
            "Cannot remove. One or more blocks would have no instructor.",
        });
      }
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM BlockInstructor
     WHERE instructorId = ?
       AND sectionId IN (SELECT id FROM Section WHERE courseId = ?)`,
      instructorId,
      courseId,
    );
    res.status(204).send();
  },
);

router.get(
  "/:courseId/sections/:sectionId/instructors",
  requireAuth,
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(404).json({ message: "Section not found" });
    if (
      req.auth!.role === "INSTRUCTOR" &&
      !(await canAccessSection(req.auth!.userId, sectionId))
    )
      return res.status(403).json({ message: "Forbidden" });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT bi.id, bi.role, u.id AS instructorId, u.fullName, u.email
     FROM BlockInstructor bi
     JOIN User u ON u.id = bi.instructorId
     WHERE bi.sectionId = ?
     ORDER BY bi.id ASC`,
      sectionId,
    )) as Array<{
      id: number;
      role: string | null;
      instructor: { id: number; fullName: string; email: string };
    }>;
    res.json(rows);
  },
);

router.post(
  "/:courseId/sections/:sectionId/instructors",
  requireRole("ADMIN"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const parsed = assignInstructorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(404).json({ message: "Section not found" });
    const instructor = await prisma.user.findUnique({
      where: { id: parsed.data.instructorId },
    });
    if (!instructor || instructor.role !== "INSTRUCTOR")
      return res.status(400).json({ message: "Instructor not found" });

    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO BlockInstructor (id, sectionId, instructorId, role, createdAt)
     VALUES (
       (SELECT id FROM BlockInstructor WHERE sectionId = ? AND instructorId = ?),
       ?, ?, ?, COALESCE((SELECT createdAt FROM BlockInstructor WHERE sectionId = ? AND instructorId = ?), CURRENT_TIMESTAMP)
     )`,
      sectionId,
      parsed.data.instructorId,
      sectionId,
      parsed.data.instructorId,
      parsed.data.role || "ASSISTANT",
      sectionId,
      parsed.data.instructorId,
    );
    res.status(201).json({
      sectionId,
      instructorId: parsed.data.instructorId,
      role: parsed.data.role || "ASSISTANT",
    });
  },
);

router.delete(
  "/:courseId/sections/:sectionId/instructors/:instructorId",
  requireRole("ADMIN"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const instructorId = Number(req.params.instructorId);
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(404).json({ message: "Section not found" });

    const countRows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as c FROM BlockInstructor WHERE sectionId = ?`,
      sectionId,
    )) as Array<{ c: number }>;
    const count = Number(countRows[0]?.c || 0);
    if (count <= 1)
      return res
        .status(400)
        .json({ message: "A block must have at least one instructor." });

    await prisma.$executeRawUnsafe(
      `DELETE FROM BlockInstructor WHERE sectionId = ? AND instructorId = ?`,
      sectionId,
      instructorId,
    );
    res.status(204).send();
  },
);

router.patch(
  "/:courseId/sections/:sectionId",
  requireRole("ADMIN"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const parsed = sectionUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(404).json({ message: "Section not found" });

    const updated = await prisma.section.update({
      where: { id: sectionId },
      data: { name: parsed.data.name.trim() },
    });
    res.json(updated);
  },
);

router.delete(
  "/:courseId/sections/:sectionId",
  requireRole("ADMIN"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(404).json({ message: "Section not found" });

    const sectionCount = await prisma.section.count({ where: { courseId } });
    if (sectionCount <= 1)
      return res
        .status(400)
        .json({ message: "At least one block/section is required." });

    await prisma.section.delete({ where: { id: sectionId } });
    res.status(204).send();
  },
);

router.post("/:id/enroll-request", requireRole("STUDENT"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course || (await isCourseArchived(id)))
    return res.status(404).json({ message: "Course not found" });
  if (course.enrollmentKey !== parsed.data.key.trim())
    return res.status(403).json({ message: "Invalid enrollment key" });

  const existing = await prisma.enrollment.findUnique({
    where: {
      courseId_studentId: { courseId: id, studentId: req.auth!.userId },
    },
  });
  if (existing?.status === "APPROVED")
    return res.status(409).json({ message: "Already enrolled" });

  const enrollment = await prisma.enrollment.upsert({
    where: {
      courseId_studentId: { courseId: id, studentId: req.auth!.userId },
    },
    update: { status: "PENDING", sectionId: null },
    create: { courseId: id, studentId: req.auth!.userId, status: "PENDING" },
  });

  res.status(201).json(enrollment);
});

router.get(
  "/:id/enrollments/pending",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const id = Number(req.params.id);
    const course = await prisma.course.findUnique({ where: { id } });
    if (
      !course ||
      !(await canAccessCourse(req.auth!.userId, id)) ||
      (await isCourseArchived(id))
    )
      return res.status(404).json({ message: "Course not found" });

    const pending = await prisma.enrollment.findMany({
      where: { courseId: id, status: "PENDING" },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json(pending);
  },
);

router.post(
  "/:id/enrollments/manual",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const id = Number(req.params.id);
    const parsed = manualAddSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const course = await prisma.course.findUnique({ where: { id } });
    if (
      !course ||
      !(await canAccessCourse(req.auth!.userId, id)) ||
      (await isCourseArchived(id))
    )
      return res.status(404).json({ message: "Course not found" });

    const section = await prisma.section.findUnique({
      where: { id: parsed.data.sectionId },
    });
    if (!section || section.courseId !== id)
      return res.status(400).json({ message: "Invalid section" });
    if (!(await canAccessSection(req.auth!.userId, section.id)))
      return res.status(403).json({ message: "Forbidden for this block" });

    const student = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (!student || student.role !== "STUDENT")
      return res.status(404).json({ message: "Student not found" });

    const enrollment = await prisma.enrollment.upsert({
      where: { courseId_studentId: { courseId: id, studentId: student.id } },
      update: { status: "APPROVED", sectionId: section.id },
      create: {
        courseId: id,
        studentId: student.id,
        status: "APPROVED",
        sectionId: section.id,
      },
    });

    res.status(201).json(enrollment);
  },
);

router.patch(
  "/:courseId/enrollments/:enrollmentId",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const enrollmentId = Number(req.params.enrollmentId);
    const parsed = enrollmentDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (
      !course ||
      !(await canAccessCourse(req.auth!.userId, courseId)) ||
      (await isCourseArchived(courseId))
    )
      return res.status(404).json({ message: "Course not found" });

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment || enrollment.courseId !== courseId)
      return res.status(404).json({ message: "Enrollment not found" });

    if (parsed.data.status === "APPROVED") {
      if (!parsed.data.sectionId)
        return res
          .status(400)
          .json({ message: "sectionId is required to approve" });
      const section = await prisma.section.findUnique({
        where: { id: parsed.data.sectionId },
      });
      if (!section || section.courseId !== courseId)
        return res.status(400).json({ message: "Invalid section" });
      if (!(await canAccessSection(req.auth!.userId, section.id)))
        return res.status(403).json({ message: "Forbidden for this block" });
    }

    const updated = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: parsed.data.status,
        sectionId:
          parsed.data.status === "APPROVED" ? parsed.data.sectionId! : null,
      },
    });
    res.json(updated);
  },
);

router.delete(
  "/:courseId/enrollments/:enrollmentId",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const enrollmentId = Number(req.params.enrollmentId);

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (
      !course ||
      !(await canAccessCourse(req.auth!.userId, courseId)) ||
      (await isCourseArchived(courseId))
    ) {
      return res.status(404).json({ message: "Course not found" });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment || enrollment.courseId !== courseId) {
      return res.status(404).json({ message: "Enrollment not found" });
    }

    await prisma.enrollment.delete({ where: { id: enrollmentId } });
    res.status(204).send();
  },
);

router.delete(
  "/:courseId/sections/:sectionId/enrollments",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (
      !course ||
      !(await canAccessSection(req.auth!.userId, sectionId)) ||
      (await isCourseArchived(courseId))
    ) {
      return res.status(404).json({ message: "Course not found" });
    }

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(404).json({ message: "Section not found" });

    const result = await prisma.enrollment.deleteMany({
      where: { courseId, sectionId, status: "APPROVED" },
    });

    res.json({ removed: result.count });
  },
);

router.delete(
  "/:id/enrollment/me",
  requireRole("STUDENT"),
  async (req, res) => {
    const id = Number(req.params.id);

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        courseId_studentId: { courseId: id, studentId: req.auth!.userId },
      },
    });
    if (!enrollment)
      return res.status(404).json({ message: "Enrollment not found" });

    await prisma.enrollment.delete({ where: { id: enrollment.id } });
    res.status(204).send();
  },
);

router.patch(
  "/:id/enrollment-key/regenerate",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const id = Number(req.params.id);
    const course = await prisma.course.findUnique({ where: { id } });
    if (
      !course ||
      !(await canAccessCourse(req.auth!.userId, id)) ||
      (await isCourseArchived(id))
    )
      return res.status(404).json({ message: "Course not found" });

    const updated = await prisma.course.update({
      where: { id },
      data: { enrollmentKey: generateEnrollmentKey() },
    });
    res.json({ enrollmentKey: updated.enrollmentKey });
  },
);

router.post(
  "/:courseId/sections/:sectionId/lessons",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const parsed = lessonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (
      !course ||
      !(await canAccessSection(req.auth!.userId, sectionId)) ||
      (await isCourseArchived(courseId))
    )
      return res.status(404).json({ message: "Course not found" });

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(400).json({ message: "Invalid section" });

    const duplicateOtherSection = await prisma.lesson.findFirst({
      where: {
        courseId,
        sectionId: { not: sectionId },
        OR: [
          { content: parsed.data.content },
          parsed.data.fileUrl ? { fileUrl: parsed.data.fileUrl } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (duplicateOtherSection) {
      return res.status(409).json({
        message:
          "Content/file already exists in another section. Keep section content isolated.",
      });
    }

    const lesson = await prisma.lesson.create({
      data: {
        title: parsed.data.title,
        content: parsed.data.content,
        fileUrl: parsed.data.fileUrl || null,
        courseId,
        sectionId,
      },
    });

    res.status(201).json(lesson);
  },
);

router.patch(
  "/:courseId/sections/:sectionId/lessons/:lessonId",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const lessonId = Number(req.params.lessonId);
    const parsed = lessonUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || !(await canAccessSection(req.auth!.userId, sectionId)))
      return res.status(404).json({ message: "Course not found" });

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.courseId !== courseId)
      return res.status(400).json({ message: "Invalid section" });

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (
      !lesson ||
      lesson.courseId !== courseId ||
      lesson.sectionId !== sectionId
    ) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: parsed.data.title?.trim() || undefined,
        content: parsed.data.content?.trim() || undefined,
        fileUrl:
          parsed.data.fileUrl !== undefined
            ? parsed.data.fileUrl || null
            : undefined,
      },
    });

    res.json(updated);
  },
);

router.delete(
  "/:courseId/sections/:sectionId/lessons/:lessonId",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sectionId = Number(req.params.sectionId);
    const lessonId = Number(req.params.lessonId);

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || !(await canAccessSection(req.auth!.userId, sectionId)))
      return res.status(404).json({ message: "Course not found" });

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (
      !lesson ||
      lesson.courseId !== courseId ||
      lesson.sectionId !== sectionId
    ) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    await prisma.lesson.delete({ where: { id: lessonId } });
    res.status(204).send();
  },
);

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const found = await prisma.course.findUnique({ where: { id } });
  if (!found || (await isCourseArchived(id)))
    return res.status(404).json({ message: "Course not found" });
  if (
    req.auth!.role !== "ADMIN" &&
    !(
      req.auth!.role === "INSTRUCTOR" &&
      (await canAccessCourse(req.auth!.userId, id))
    )
  ) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const updated = await prisma.course.update({
    where: { id },
    data: parsed.data,
  });
  res.json(updated);
});

router.patch("/:id/archive", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = archiveSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const found = await prisma.course.findUnique({ where: { id } });
  if (!found || !(await canAccessCourse(req.auth!.userId, id)))
    return res.status(404).json({ message: "Course not found" });

  const archived = parsed.data.archived ?? true;
  try {
    const updated = await (prisma as any).course.update({
      where: { id },
      data: { isArchived: archived },
    });
    return res.json({
      id: updated.id,
      isArchived: Boolean(updated.isArchived),
    });
  } catch {
    await prisma.$executeRawUnsafe(
      `UPDATE Course SET isArchived = ? WHERE id = ?`,
      archived ? 1 : 0,
      id,
    );
    return res.json({ id, isArchived: archived });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const found = await prisma.course.findUnique({ where: { id } });
  if (!found) return res.status(404).json({ message: "Course not found" });
  if (
    req.auth!.role !== "ADMIN" &&
    !(
      req.auth!.role === "INSTRUCTOR" &&
      (await canAccessCourse(req.auth!.userId, id))
    )
  ) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await prisma.course.delete({ where: { id } });
  res.status(204).send();
});

export default router;
