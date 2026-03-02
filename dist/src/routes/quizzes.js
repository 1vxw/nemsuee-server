import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
const router = Router();
router.use(requireAuth);
const quizSchema = z.object({
    lessonId: z.number(),
    questions: z.array(z.object({
        prompt: z.string().min(2),
        optionA: z.string().min(1),
        optionB: z.string().min(1),
        optionC: z.string().min(1),
        optionD: z.string().min(1),
        correctOption: z.enum(["A", "B", "C", "D"])
    })).min(1)
});
router.post("/", requireRole("INSTRUCTOR"), async (req, res) => {
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const lesson = await prisma.lesson.findUnique({ where: { id: parsed.data.lessonId }, include: { course: true, quiz: true } });
    if (!lesson || lesson.course.instructorId !== req.auth.userId)
        return res.status(404).json({ message: "Lesson not found" });
    if (lesson.quiz)
        return res.status(409).json({ message: "Quiz already exists for this lesson" });
    const quiz = await prisma.quiz.create({
        data: {
            lessonId: parsed.data.lessonId,
            questions: { create: parsed.data.questions }
        },
        include: { questions: true }
    });
    res.status(201).json(quiz);
});
const submitSchema = z.object({
    answers: z.array(z.object({ questionId: z.number(), selectedOption: z.enum(["A", "B", "C", "D"]) }))
});
router.post("/:id/submit", requireRole("STUDENT"), async (req, res) => {
    const quizId = Number(req.params.id);
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: { questions: true, lesson: { include: { course: true } } } });
    if (!quiz)
        return res.status(404).json({ message: "Quiz not found" });
    const enrollment = await prisma.enrollment.findUnique({
        where: {
            courseId_studentId: { courseId: quiz.lesson.courseId, studentId: req.auth.userId }
        }
    });
    if (!enrollment || enrollment.status !== "APPROVED") {
        return res.status(403).json({ message: "You are not enrolled in this course" });
    }
    if (enrollment.sectionId !== quiz.lesson.sectionId) {
        return res.status(403).json({ message: "Quiz is not available for your section/block" });
    }
    let score = 0;
    const total = quiz.questions.length;
    const answerMap = new Map(parsed.data.answers.map((x) => [x.questionId, x.selectedOption]));
    for (const q of quiz.questions) {
        if (answerMap.get(q.id) === q.correctOption)
            score += 1;
    }
    const attempt = await prisma.attempt.create({
        data: {
            quizId,
            studentId: req.auth.userId,
            score,
            total
        }
    });
    res.json({
        attemptId: attempt.id,
        score,
        total,
        percentage: Math.round((score / Math.max(total, 1)) * 100)
    });
});
router.get("/scores/me", requireRole("STUDENT"), async (req, res) => {
    const attempts = await prisma.attempt.findMany({
        where: { studentId: req.auth.userId },
        include: {
            quiz: { include: { lesson: { include: { course: true } } } }
        },
        orderBy: { createdAt: "desc" }
    });
    res.json(attempts);
});
router.get("/scores/instructor", requireRole("INSTRUCTOR"), async (req, res) => {
    const attempts = await prisma.attempt.findMany({
        where: {
            quiz: { lesson: { course: { instructorId: req.auth.userId } } }
        },
        include: {
            student: { select: { id: true, fullName: true, email: true } },
            quiz: { include: { lesson: { include: { course: true } } } }
        },
        orderBy: { createdAt: "desc" }
    });
    res.json(attempts);
});
export default router;
