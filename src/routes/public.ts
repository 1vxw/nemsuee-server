import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

router.get("/courses/catalog", async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const where =
    query.length > 0
      ? {
          isArchived: false,
          OR: [
            { title: { contains: query } },
            { description: { contains: query } },
            {
              instructor: {
                fullName: { contains: query },
              },
            },
          ],
        }
      : { isArchived: false };

  const courses = await prisma.course.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      instructor: { select: { fullName: true } },
      sections: { select: { id: true, name: true }, orderBy: { id: "asc" } },
    },
    take: 50,
  });

  res.json(
    courses.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      instructor: { fullName: c.instructor?.fullName || "TBA" },
      sections: c.sections.map((s) => ({ id: s.id, name: s.name })),
      enrollmentStatus: null,
    })),
  );
});

export default router;
