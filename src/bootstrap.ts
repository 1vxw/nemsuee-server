import { prisma } from "./db.js";

export async function initDb() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS User (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      emailVerifiedAt DATETIME,
      role TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE User ADD COLUMN emailVerifiedAt DATETIME;
    `);
    // Backfill existing accounts created before verification was introduced.
    await prisma.$executeRawUnsafe(`
      UPDATE User
      SET emailVerifiedAt = createdAt
      WHERE emailVerifiedAt IS NULL;
    `);
  } catch {
    // Column already exists in existing databases.
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Course (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      isArchived INTEGER NOT NULL DEFAULT 0,
      enrollmentKey TEXT NOT NULL DEFAULT 'NEMSU001',
      instructorId INTEGER NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (instructorId) REFERENCES User(id)
    );
  `);

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Course ADD COLUMN enrollmentKey TEXT NOT NULL DEFAULT 'NEMSU001';
    `);
  } catch {
    // Column already exists in existing databases.
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Course ADD COLUMN isArchived INTEGER NOT NULL DEFAULT 0;
    `);
  } catch {
    // Column already exists in existing databases.
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Section (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      courseId INTEGER NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (courseId) REFERENCES Course(id) ON DELETE CASCADE,
      UNIQUE(courseId, name)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS BlockInstructor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sectionId INTEGER NOT NULL,
      instructorId INTEGER NOT NULL,
      role TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sectionId) REFERENCES Section(id) ON DELETE CASCADE,
      FOREIGN KEY (instructorId) REFERENCES User(id) ON DELETE CASCADE,
      UNIQUE(sectionId, instructorId)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Lesson (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      fileUrl TEXT,
      courseId INTEGER NOT NULL,
      sectionId INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (courseId) REFERENCES Course(id) ON DELETE CASCADE,
      FOREIGN KEY (sectionId) REFERENCES Section(id) ON DELETE CASCADE
    );
  `);

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Lesson ADD COLUMN sectionId INTEGER NOT NULL DEFAULT 1;
    `);
  } catch {
    // Column already exists in existing databases.
  }

  await prisma.$executeRawUnsafe(`
    INSERT INTO Section (name, courseId)
    SELECT 'BLOCK-A', c.id
    FROM Course c
    WHERE NOT EXISTS (
      SELECT 1 FROM Section s WHERE s.courseId = c.id
    );
  `);

  await prisma.$executeRawUnsafe(`
    INSERT OR IGNORE INTO BlockInstructor (sectionId, instructorId, role)
    SELECT s.id, c.instructorId, 'PRIMARY'
    FROM Section s
    JOIN Course c ON c.id = s.courseId;
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE Lesson
    SET sectionId = (
      SELECT s.id FROM Section s
      WHERE s.courseId = Lesson.courseId
      ORDER BY s.id ASC
      LIMIT 1
    )
    WHERE sectionId IS NULL
      OR NOT EXISTS (SELECT 1 FROM Section s2 WHERE s2.id = Lesson.sectionId);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Quiz (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lessonId INTEGER NOT NULL UNIQUE,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lessonId) REFERENCES Lesson(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Question (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quizId INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      optionA TEXT NOT NULL,
      optionB TEXT NOT NULL,
      optionC TEXT NOT NULL,
      optionD TEXT NOT NULL,
      correctOption TEXT NOT NULL,
      FOREIGN KEY (quizId) REFERENCES Quiz(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Attempt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quizId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quizId) REFERENCES Quiz(id) ON DELETE CASCADE,
      FOREIGN KEY (studentId) REFERENCES User(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS GoogleDriveConnection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      googleEmail TEXT,
      accessToken TEXT NOT NULL,
      refreshToken TEXT,
      personalFolderId TEXT,
      expiryDate BIGINT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    );
  `);

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE GoogleDriveConnection ADD COLUMN personalFolderId TEXT;
    `);
  } catch {
    // Column already exists in existing databases.
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Enrollment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      sectionId INTEGER,
      status TEXT NOT NULL DEFAULT 'PENDING',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (courseId) REFERENCES Course(id) ON DELETE CASCADE,
      FOREIGN KEY (studentId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (sectionId) REFERENCES Section(id) ON DELETE SET NULL,
      UNIQUE(courseId, studentId)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS InstructorApplication (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewedBy INTEGER,
      reviewedAt DATETIME,
      note TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewedBy) REFERENCES User(id) ON DELETE SET NULL
    );
  `);

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Enrollment ADD COLUMN sectionId INTEGER;
    `);
  } catch {
    // Column already exists in existing databases.
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS EmailVerificationToken (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      tokenHash TEXT NOT NULL UNIQUE,
      expiresAt DATETIME NOT NULL,
      consumedAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_email_verification_user ON EmailVerificationToken(userId);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_email_verification_expires ON EmailVerificationToken(expiresAt);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PasswordResetToken (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      tokenHash TEXT NOT NULL UNIQUE,
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON PasswordResetToken(userId);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON PasswordResetToken(expiresAt);
  `);
}
