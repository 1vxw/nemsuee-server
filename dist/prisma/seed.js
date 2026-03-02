import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
    const hash = await bcrypt.hash("password123", 10);
    const instructor = await prisma.user.upsert({
        where: { email: "instructor@nemsu.edu" },
        update: {},
        create: {
            fullName: "Demo Instructor",
            email: "instructor@nemsu.edu",
            passwordHash: hash,
            role: "INSTRUCTOR"
        }
    });
    await prisma.user.upsert({
        where: { email: "student@nemsu.edu" },
        update: {},
        create: {
            fullName: "Demo Student",
            email: "student@nemsu.edu",
            passwordHash: hash,
            role: "STUDENT"
        }
    });
    const course = await prisma.course.create({
        data: {
            title: "Web Systems Fundamentals",
            description: "Intro course for LMS demo",
            enrollmentKey: "NEMSU-DEMO1",
            instructorId: instructor.id
        }
    });
    const section = await prisma.section.create({
        data: { name: "BLOCK-A", courseId: course.id }
    });
    const lesson = await prisma.lesson.create({
        data: {
            title: "Lesson 1",
            content: "Intro to web-based learning.",
            courseId: course.id,
            sectionId: section.id
        }
    });
    const lessonId = lesson.id;
    await prisma.quiz.create({
        data: {
            lessonId,
            questions: {
                create: [
                    {
                        prompt: "Which protocol is used for web pages?",
                        optionA: "HTTP",
                        optionB: "FTP",
                        optionC: "SMTP",
                        optionD: "SSH",
                        correctOption: "A"
                    }
                ]
            }
        }
    });
}
main().finally(async () => {
    await prisma.$disconnect();
});
