import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const courseSchema = z.object({ title: z.string().min(2), description: z.string().min(2) });
const sectionSchema = z.object({ name: z.string().min(1) });
const lessonSchema = z.object({ title: z.string().min(2), content: z.string().min(2), fileUrl: z.string().url().optional().or(z.literal("")) });
const enrollSchema = z.object({ key: z.string().min(3) });
const manualAddSchema = z.object({ email: z.string().email(), sectionId: z.number() });
const enrollmentDecisionSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), sectionId: z.number().optional() });

function generateEnrollmentKey() {
  return `NEMSU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

router.get("/", async (req, res) => {
  if (req.auth?.role === "INSTRUCTOR") {
    const courses = await prisma.course.findMany({
      where: { instructorId: req.auth.userId },
      take: 5,
      include: {
        instructor: { select: { id: true, fullName: true } },
        sections: {
          orderBy: { id: "asc" },
          include: {
            lessons: { include: { quiz: { include: { questions: true } } }, orderBy: { id: "asc" } },
            enrollments: {
              include: { student: { select: { id: true, fullName: true, email: true } } },
              orderBy: { createdAt: "desc" }
            }
          }
        }
      },
      orderBy: { id: "desc" }
    });
    return res.json(courses);
  }

  const approved = await prisma.enrollment.findMany({
    where: { studentId: req.auth!.userId, status: "APPROVED" },
    take: 5,
    include: {
      section: { include: { lessons: { include: { quiz: { include: { questions: true } } }, orderBy: { id: "asc" } } } },
      course: { include: { instructor: { select: { id: true, fullName: true } } } }
    },
    orderBy: { updatedAt: "desc" }
  });

  const mapped = approved.map((e: (typeof approved)[number]) => ({
    id: e.course.id,
    title: e.course.title,
    description: e.course.description,
    instructor: e.course.instructor,
    sections: e.section ? [{ id: e.section.id, name: e.section.name, lessons: e.section.lessons, enrollments: [] }] : []
  }));

  return res.json(mapped);
});

router.get("/catalog", requireRole("STUDENT"), async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const courses = await prisma.course.findMany({
    where: query
      ? {
          OR: [
            { title: { contains: query } },
            { description: { contains: query } },
            { instructor: { fullName: { contains: query } } }
          ]
        }
      : undefined,
    include: {
      instructor: { select: { fullName: true } },
      enrollments: { where: { studentId: req.auth!.userId }, select: { id: true, status: true } },
      sections: { select: { id: true, name: true }, orderBy: { id: "asc" } }
    },
    orderBy: { createdAt: "desc" },
    take: 30
  });

  res.json(
    courses.map((c: (typeof courses)[number]) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      instructor: c.instructor,
      sections: c.sections,
      enrollmentStatus: c.enrollments[0]?.status || null
    }))
  );
});

router.get("/:id/students", async (req, res) => {
  const id = Number(req.params.id);
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) return res.status(404).json({ message: "Course not found" });

  if (req.auth!.role === "INSTRUCTOR") {
    if (course.instructorId !== req.auth!.userId) return res.status(403).json({ message: "Forbidden" });

    const rows = await prisma.enrollment.findMany({
      where: { courseId: id, status: "APPROVED" },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        section: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    return res.json(rows);
  }

  const myEnrollment = await prisma.enrollment.findUnique({
    where: { courseId_studentId: { courseId: id, studentId: req.auth!.userId } }
  });
  if (!myEnrollment || myEnrollment.status !== "APPROVED") return res.status(403).json({ message: "Not enrolled" });

  const rows = await prisma.enrollment.findMany({
    where: {
      courseId: id,
      status: "APPROVED",
      sectionId: myEnrollment.sectionId || undefined
    },
    include: {
      student: { select: { id: true, fullName: true, email: true } },
      section: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: "asc" }
  });
  return res.json(rows);
});

router.post("/", requireRole("INSTRUCTOR"), async (req, res) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.create({
    data: {
      ...parsed.data,
      instructorId: req.auth!.userId,
      enrollmentKey: generateEnrollmentKey(),
      sections: { create: [{ name: "BLOCK-A" }] }
    },
    include: { sections: true }
  });

  res.status(201).json(course);
});

router.post("/:id/sections", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = sectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course || course.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const section = await prisma.section.create({ data: { name: parsed.data.name.trim(), courseId: id } });
  res.status(201).json(section);
});

router.post("/:id/enroll-request", requireRole("STUDENT"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) return res.status(404).json({ message: "Course not found" });
  if (course.enrollmentKey !== parsed.data.key.trim()) return res.status(403).json({ message: "Invalid enrollment key" });

  const existing = await prisma.enrollment.findUnique({ where: { courseId_studentId: { courseId: id, studentId: req.auth!.userId } } });
  if (existing?.status === "APPROVED") return res.status(409).json({ message: "Already enrolled" });

  const enrollment = await prisma.enrollment.upsert({
    where: { courseId_studentId: { courseId: id, studentId: req.auth!.userId } },
    update: { status: "PENDING", sectionId: null },
    create: { courseId: id, studentId: req.auth!.userId, status: "PENDING" }
  });

  res.status(201).json(enrollment);
});

router.get("/:id/enrollments/pending", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course || course.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const pending = await prisma.enrollment.findMany({
    where: { courseId: id, status: "PENDING" },
    include: { student: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: "asc" }
  });

  res.json(pending);
});

router.post("/:id/enrollments/manual", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = manualAddSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course || course.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const section = await prisma.section.findUnique({ where: { id: parsed.data.sectionId } });
  if (!section || section.courseId !== id) return res.status(400).json({ message: "Invalid section" });

  const student = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!student || student.role !== "STUDENT") return res.status(404).json({ message: "Student not found" });

  const enrollment = await prisma.enrollment.upsert({
    where: { courseId_studentId: { courseId: id, studentId: student.id } },
    update: { status: "APPROVED", sectionId: section.id },
    create: { courseId: id, studentId: student.id, status: "APPROVED", sectionId: section.id }
  });

  res.status(201).json(enrollment);
});

router.patch("/:courseId/enrollments/:enrollmentId", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const enrollmentId = Number(req.params.enrollmentId);
  const parsed = enrollmentDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course || course.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment || enrollment.courseId !== courseId) return res.status(404).json({ message: "Enrollment not found" });

  if (parsed.data.status === "APPROVED") {
    if (!parsed.data.sectionId) return res.status(400).json({ message: "sectionId is required to approve" });
    const section = await prisma.section.findUnique({ where: { id: parsed.data.sectionId } });
    if (!section || section.courseId !== courseId) return res.status(400).json({ message: "Invalid section" });
  }

  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { status: parsed.data.status, sectionId: parsed.data.status === "APPROVED" ? parsed.data.sectionId! : null }
  });
  res.json(updated);
});

router.patch("/:id/enrollment-key/regenerate", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course || course.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const updated = await prisma.course.update({ where: { id }, data: { enrollmentKey: generateEnrollmentKey() } });
  res.json({ enrollmentKey: updated.enrollmentKey });
});

router.post("/:courseId/sections/:sectionId/lessons", requireRole("INSTRUCTOR"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const sectionId = Number(req.params.sectionId);
  const parsed = lessonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course || course.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!section || section.courseId !== courseId) return res.status(400).json({ message: "Invalid section" });

  const duplicateOtherSection = await prisma.lesson.findFirst({
    where: {
      courseId,
      sectionId: { not: sectionId },
      OR: [
        { content: parsed.data.content },
        parsed.data.fileUrl ? { fileUrl: parsed.data.fileUrl } : undefined
      ].filter(Boolean) as any
    }
  });

  if (duplicateOtherSection) {
    return res.status(409).json({ message: "Content/file already exists in another section. Keep section content isolated." });
  }

  const lesson = await prisma.lesson.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      fileUrl: parsed.data.fileUrl || null,
      courseId,
      sectionId
    }
  });

  res.status(201).json(lesson);
});

router.put("/:id", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const found = await prisma.course.findUnique({ where: { id } });
  if (!found || found.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  const updated = await prisma.course.update({ where: { id }, data: parsed.data });
  res.json(updated);
});

router.delete("/:id", requireRole("INSTRUCTOR"), async (req, res) => {
  const id = Number(req.params.id);
  const found = await prisma.course.findUnique({ where: { id } });
  if (!found || found.instructorId !== req.auth!.userId) return res.status(404).json({ message: "Course not found" });

  await prisma.course.delete({ where: { id } });
  res.status(204).send();
});

export default router;
