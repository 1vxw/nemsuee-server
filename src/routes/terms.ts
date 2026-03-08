import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../db.js";
import {
  ensureAcademicTermsStorage,
  getActiveTerm,
  listTerms,
} from "../modules/terms/term.store.js";
import {
  createCourseOfferingFromPayload,
  ensureOfferingsStorage,
  listCourseOfferingsByTerm,
} from "../modules/offerings/offering.store.js";

const router = Router();
router.use(requireAuth);

router.get("/active", async (_req, res) => {
  const active = await getActiveTerm();
  res.json(active);
});

router.get("/context", async (_req, res) => {
  const active = await getActiveTerm();
  let activePeriod = "1";
  let gradingPeriod = "MIDTERM";
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT payload FROM AppSettings WHERE scope = 'admin' LIMIT 1`,
    )) as Array<{ payload: string }>;
    if (rows[0]?.payload) {
      const parsed = JSON.parse(rows[0].payload);
      activePeriod = String(parsed?.active_period || "1");
      gradingPeriod = activePeriod === "2" ? "FINALS" : "MIDTERM";
    }
  } catch {}
  res.json({
    semester: active?.name || "1st Semester",
    academicYear: active?.academicYear || "Legacy",
    activePeriod,
    gradingPeriod,
  });
});

router.get("/", requireRole("ADMIN"), async (_req, res) => {
  const terms = await listTerms();
  res.json(terms);
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  await ensureAcademicTermsStorage();
  const name = String(req.body?.name || "").trim();
  const academicYear = String(req.body?.academicYear || "").trim();
  const startDate = req.body?.startDate ? String(req.body.startDate) : null;
  const endDate = req.body?.endDate ? String(req.body.endDate) : null;
  if (!name || !academicYear) {
    return res.status(400).json({ message: "name and academicYear are required" });
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO AcademicTerm (name, academicYear, startDate, endDate, isActive, isArchived)
     VALUES (?, ?, ?, ?, 0, 0)`,
    name,
    academicYear,
    startDate,
    endDate,
  );
  const row = (await prisma.$queryRawUnsafe(
    `SELECT id, name, academicYear, startDate, endDate, isActive, isArchived, createdAt
     FROM AcademicTerm WHERE rowid = last_insert_rowid()`,
  )) as any[];
  res.status(201).json(row[0] || null);
});

router.patch("/:id/activate", requireRole("ADMIN"), async (req, res) => {
  await ensureAcademicTermsStorage();
  const id = Number(req.params.id);
  const target = (await prisma.$queryRawUnsafe(
    `SELECT id FROM AcademicTerm WHERE id = ? LIMIT 1`,
    id,
  )) as Array<{ id: number }>;
  if (!target[0]) return res.status(404).json({ message: "Term not found" });
  await prisma.$executeRawUnsafe(`UPDATE AcademicTerm SET isActive = 0`);
  await prisma.$executeRawUnsafe(
    `UPDATE AcademicTerm SET isActive = 1, isArchived = 0 WHERE id = ?`,
    id,
  );
  const active = await getActiveTerm();
  res.json(active);
});

router.patch("/:id/archive", requireRole("ADMIN"), async (req, res) => {
  await ensureAcademicTermsStorage();
  const id = Number(req.params.id);
  const archived = Boolean(req.body?.archived ?? true);
  await prisma.$executeRawUnsafe(
    `UPDATE AcademicTerm
     SET isArchived = ?, isActive = CASE WHEN ? = 1 THEN 0 ELSE isActive END
     WHERE id = ?`,
    archived ? 1 : 0,
    archived ? 1 : 0,
    id,
  );
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, name, academicYear, startDate, endDate, isActive, isArchived, createdAt
     FROM AcademicTerm WHERE id = ?`,
    id,
  )) as any[];
  res.json(rows[0] || null);
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  await ensureAcademicTermsStorage();
  const id = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  const academicYear = String(req.body?.academicYear || "").trim();
  const startDate = req.body?.startDate ? String(req.body.startDate) : null;
  const endDate = req.body?.endDate ? String(req.body.endDate) : null;
  if (!name || !academicYear) {
    return res.status(400).json({ message: "name and academicYear are required" });
  }
  await prisma.$executeRawUnsafe(
    `UPDATE AcademicTerm
     SET name = ?, academicYear = ?, startDate = ?, endDate = ?
     WHERE id = ?`,
    name,
    academicYear,
    startDate,
    endDate,
    id,
  );
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, name, academicYear, startDate, endDate, isActive, isArchived, createdAt
     FROM AcademicTerm WHERE id = ?`,
    id,
  )) as any[];
  if (!rows[0]) return res.status(404).json({ message: "Term not found" });
  res.json(rows[0]);
});

router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  await ensureAcademicTermsStorage();
  const id = Number(req.params.id);
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, isActive FROM AcademicTerm WHERE id = ?`,
    id,
  )) as Array<{ id: number; isActive: number }>;
  if (!rows[0]) return res.status(404).json({ message: "Term not found" });
  if (Number(rows[0].isActive) === 1) {
    return res.status(400).json({ message: "Cannot delete active term" });
  }
  const courseRefs = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as c FROM Course WHERE termId = ?`,
    id,
  )) as Array<{ c: number }>;
  if (Number(courseRefs[0]?.c || 0) > 0) {
    return res.status(400).json({
      message: "Cannot delete term with existing course offerings. Archive it instead.",
    });
  }
  await prisma.$executeRawUnsafe(`DELETE FROM AcademicTerm WHERE id = ?`, id);
  res.status(204).send();
});

router.patch("/courses/:courseId/assign", requireRole("ADMIN"), async (req, res) => {
  await ensureAcademicTermsStorage();
  const courseId = Number(req.params.courseId);
  const termId = Number(req.body?.termId);
  if (!termId) return res.status(400).json({ message: "termId is required" });
  await prisma.$executeRawUnsafe(
    `UPDATE Course SET termId = ? WHERE id = ?`,
    termId,
    courseId,
  );
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, termId FROM Course WHERE id = ?`,
    courseId,
  )) as any[];
  res.json(rows[0] || null);
});

router.get("/:id/offerings", requireRole("ADMIN"), async (req, res) => {
  await ensureOfferingsStorage();
  const termId = Number(req.params.id);
  const offerings = await listCourseOfferingsByTerm(termId);
  res.json(offerings);
});

router.post("/:id/offerings", requireRole("ADMIN"), async (req, res) => {
  await ensureOfferingsStorage();
  const termId = Number(req.params.id);
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim();
  const instructorId = Number(req.body?.instructorId || req.auth!.userId);
  if (!title) return res.status(400).json({ message: "title is required" });

  const { templateId, offeringId } = await createCourseOfferingFromPayload({
    title,
    description,
    termId,
  });
  const enrollmentKey = `NEMSU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO Course (title, description, isArchived, enrollmentKey, instructorId, createdAt, termId, courseTemplateId, offeringId)
     VALUES (?, ?, 0, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
    title,
    description,
    enrollmentKey,
    instructorId,
    termId,
    templateId,
    offeringId,
  );
  const created = (await prisma.$queryRawUnsafe(
    `SELECT id, title, description, instructorId, termId, courseTemplateId, offeringId FROM Course WHERE rowid = last_insert_rowid()`,
  )) as any[];
  const courseId = Number(created[0]?.id || 0);
  if (courseId) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO Section (name, courseId, createdAt) VALUES ('BLOCK-A', ?, CURRENT_TIMESTAMP)`,
      courseId,
    );
  }
  res.status(201).json(created[0] || null);
});

export default router;
