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

  type CatalogCourseRow = (typeof courses)[number];

  res.json(
    courses.map((course: CatalogCourseRow) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      instructor: { fullName: course.instructor?.fullName || "TBA" },
      sections: course.sections.map((section: { id: number; name: string }) => ({
        id: section.id,
        name: section.name,
      })),
      enrollmentStatus: null,
    })),
  );
});

export default router;
