import bcrypt from "bcryptjs";
import { prisma } from "../../db.js";
import { signToken } from "./tokens.js";

export type RegisterInput = {
  fullName: string;
  email: string;
  password: string;
  role: "STUDENT" | "INSTRUCTOR";
  studentId?: string;
};

export type LoginInput = { email: string; password: string };

async function ensureStudentIdentityTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS StudentIdentity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      studentId TEXT NOT NULL UNIQUE,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )`,
  );
}

async function getStudentIdByUserId(userId: number) {
  await ensureStudentIdentityTable();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT studentId FROM StudentIdentity WHERE userId = ? LIMIT 1`,
    userId,
  )) as Array<{ studentId: string }>;
  return rows[0]?.studentId || null;
}

export async function registerUser(input: RegisterInput) {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const { password, role } = input;
  const studentId = input.studentId?.trim() || undefined;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    const err = new Error("Email already exists");
    (err as any).status = 409;
    throw err;
  }
  if (role === "STUDENT") {
    if (!studentId) {
      const err = new Error("Student ID is required for student registration");
      (err as any).status = 400;
      throw err;
    }
    await ensureStudentIdentityTable();
    const duplicateRows = (await prisma.$queryRawUnsafe(
      `SELECT id FROM StudentIdentity WHERE studentId = ? LIMIT 1`,
      studentId,
    )) as Array<{ id: number }>;
    const duplicateStudentId = duplicateRows.length > 0;
    if (duplicateStudentId) {
      const err = new Error("Student ID already exists");
      (err as any).status = 409;
      throw err;
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      role: role as any,
    },
    select: { id: true, fullName: true, email: true, role: true },
  });
  if (role === "STUDENT") {
    await ensureStudentIdentityTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO StudentIdentity (userId, studentId) VALUES (?, ?)`,
      user.id,
      studentId!,
    );
  }

  if (role === "INSTRUCTOR") {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO InstructorApplication (userId, status, reviewedBy, reviewedAt, note)
       VALUES (?, 'PENDING', NULL, NULL, NULL)`,
      user.id,
    );
  }

  return {
    ...user,
    studentId: role === "STUDENT" ? studentId! : null,
    approvalStatus: role === "INSTRUCTOR" ? "PENDING" : "APPROVED",
  };
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: {
      id: true,
      fullName: true,
      email: true,
      passwordHash: true,
      role: true,
    },
  });
  if (!user) {
    const err = new Error("Invalid credentials");
    (err as any).status = 401;
    throw err;
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    const err = new Error("Invalid credentials");
    (err as any).status = 401;
    throw err;
  }

  if (user.role === "INSTRUCTOR") {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT status FROM InstructorApplication WHERE userId = ? LIMIT 1`,
      user.id,
    )) as Array<{ status: string }>;
    const status = rows[0]?.status;
    if (status && status !== "APPROVED") {
      const err = new Error(
        status === "REJECTED"
          ? "Instructor account registration was rejected by admin."
          : "Instructor account is pending admin approval.",
      );
      (err as any).status = 403;
      throw err;
    }
  }

  const token = signToken({ userId: user.id, role: user.role });
  const studentId = user.role === "STUDENT" ? await getStudentIdByUserId(user.id) : null;
  return {
    token,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      studentId,
    },
  };
}

export async function promoteUserToAdmin(email: string, bootstrapKey: string) {
  const expected = process.env.ADMIN_BOOTSTRAP_KEY || "";
  if (!expected) {
    const err = new Error("ADMIN_BOOTSTRAP_KEY is not configured");
    (err as any).status = 500;
    throw err;
  }
  if (bootstrapKey !== expected) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (!user) {
    const err = new Error("User not found");
    (err as any).status = 404;
    throw err;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" as any } });
  await prisma.$executeRawUnsafe(`DELETE FROM InstructorApplication WHERE userId = ?`, user.id);

  return { message: "User promoted to ADMIN", email: normalizedEmail };
}

export async function getInstructorApplications() {
  return (await prisma.$queryRawUnsafe(
    `SELECT ia.id, ia.userId, ia.status, ia.note, ia.createdAt, u.fullName, u.email
     FROM InstructorApplication ia
     JOIN User u ON u.id = ia.userId
     ORDER BY
       CASE ia.status WHEN 'PENDING' THEN 0 WHEN 'REJECTED' THEN 1 ELSE 2 END,
       ia.createdAt ASC`,
  )) as Array<{
    id: number;
    userId: number;
    status: string;
    note: string | null;
    createdAt: string;
    fullName: string;
    email: string;
  }>;
}

export async function reviewInstructorApplication(
  userId: number,
  status: "APPROVED" | "REJECTED",
  reviewedBy: number,
  note?: string,
) {
  const candidate = await prisma.user.findUnique({ where: { id: userId } });
  if (!candidate || candidate.role !== "INSTRUCTOR") {
    const err = new Error("Instructor not found");
    (err as any).status = 404;
    throw err;
  }

  await prisma.$executeRawUnsafe(
    `INSERT OR REPLACE INTO InstructorApplication (id, userId, status, reviewedBy, reviewedAt, note, createdAt)
     VALUES (
       (SELECT id FROM InstructorApplication WHERE userId = ?),
       ?, ?, ?, CURRENT_TIMESTAMP, ?, COALESCE((SELECT createdAt FROM InstructorApplication WHERE userId = ?), CURRENT_TIMESTAMP)
     )`,
    userId,
    userId,
    status,
    reviewedBy,
    note || null,
    userId,
  );

  return { userId, status };
}

export async function getUserProfile(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true, role: true },
  });
  if (!user) {
    const err = new Error("User not found");
    (err as any).status = 404;
    throw err;
  }
  return {
    ...user,
    studentId:
      user.role === "STUDENT" ? await getStudentIdByUserId(user.id) : null,
  };
}
