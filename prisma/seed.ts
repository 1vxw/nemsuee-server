import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("Password@123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@nemsu.edu" },
    update: {
      fullName: "Demo Admin",
      passwordHash: hash,
      role: "ADMIN",
    },
    create: {
      fullName: "Demo Admin",
      email: "admin@nemsu.edu",
      passwordHash: hash,
      role: "ADMIN",
    },
  });

  await prisma.user.upsert({
    where: { email: "registrar@nemsu.edu" },
    update: {
      fullName: "Demo Registrar",
      passwordHash: hash,
      role: "REGISTRAR",
    },
    create: {
      fullName: "Demo Registrar",
      email: "registrar@nemsu.edu",
      passwordHash: hash,
      role: "REGISTRAR",
    },
  });

  await prisma.user.upsert({
    where: { email: "dean@nemsu.edu" },
    update: {
      fullName: "Demo Dean",
      passwordHash: hash,
      role: "DEAN",
    },
    create: {
      fullName: "Demo Dean",
      email: "dean@nemsu.edu",
      passwordHash: hash,
      role: "DEAN",
    },
  });

  const instructor = await prisma.user.upsert({
    where: { email: "instructor@nemsu.edu" },
    update: {
      fullName: "Demo Instructor",
      passwordHash: hash,
      role: "INSTRUCTOR",
    },
    create: {
      fullName: "Demo Instructor",
      email: "instructor@nemsu.edu",
      passwordHash: hash,
      role: "INSTRUCTOR"
    }
  });

  const student = await prisma.user.upsert({
    where: { email: "student@nemsu.edu" },
    update: {
      fullName: "Demo Student",
      passwordHash: hash,
      role: "STUDENT",
    },
    create: {
      fullName: "Demo Student",
      email: "student@nemsu.edu",
      passwordHash: hash,
      role: "STUDENT"
    }
  });

  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS StudentIdentity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      studentId TEXT NOT NULL UNIQUE,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO StudentIdentity (userId, studentId) VALUES (?, ?)`,
    student.id,
    "STU-0001",
  );

  const existingCourse = await prisma.course.findFirst({
    where: { title: "Web Systems Fundamentals" },
    select: { id: true },
  });
  const course = existingCourse
    ? await prisma.course.update({
        where: { id: existingCourse.id },
        data: {
          description: "Intro course for LMS demo",
          enrollmentKey: "NEMSU-DEMO1",
          instructorId: instructor.id,
        },
      })
    : await prisma.course.create({
        data: {
          title: "Web Systems Fundamentals",
          description: "Intro course for LMS demo",
          enrollmentKey: "NEMSU-DEMO1",
          instructorId: instructor.id,
        },
      });

  const section = await prisma.section.upsert({
    where: {
      courseId_name: {
        courseId: course.id,
        name: "BLOCK-A",
      },
    },
    update: {},
    create: { name: "BLOCK-A", courseId: course.id },
  });

  const existingLesson = await prisma.lesson.findFirst({
    where: { courseId: course.id, sectionId: section.id, title: "Lesson 1" },
    select: { id: true },
  });
  const lesson = existingLesson
    ? await prisma.lesson.update({
        where: { id: existingLesson.id },
        data: {
          content: "Intro to web-based learning.",
        },
      })
    : await prisma.lesson.create({
        data: {
          title: "Lesson 1",
          content: "Intro to web-based learning.",
          courseId: course.id,
          sectionId: section.id,
        },
      });

  const lessonId = lesson.id;
  const quiz = await prisma.quiz.upsert({
    where: { lessonId },
    update: {},
    create: {
      lessonId,
    },
  });
  const existingQuestion = await prisma.question.findFirst({
    where: { quizId: quiz.id },
    select: { id: true },
  });
  if (!existingQuestion) {
    await prisma.question.create({
      data: {
        quizId: quiz.id,
        prompt: "Which protocol is used for web pages?",
        optionA: "HTTP",
        optionB: "FTP",
        optionC: "SMTP",
        optionD: "SSH",
        correctOption: "A",
      },
    });
  }

  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO Enrollment (courseId, studentId, sectionId, status)
     VALUES (?, ?, ?, 'APPROVED')`,
    course.id,
    student.id,
    section.id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO BlockInstructor (sectionId, instructorId, role)
     VALUES (?, ?, 'PRIMARY')`,
    section.id,
    instructor.id,
  );

  await prisma.$executeRawUnsafe(
    `INSERT OR REPLACE INTO InstructorApplication (userId, status, reviewedBy, reviewedAt, note)
     VALUES (?, 'APPROVED', ?, CURRENT_TIMESTAMP, 'Seeded account approved')`,
    instructor.id,
    admin.id,
  );
}

main().finally(async () => {
  await prisma.$disconnect();
});
