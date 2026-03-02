import { prisma } from "./db.js";
export async function initDb() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS User (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Course (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
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
    }
    catch {
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
    }
    catch {
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
      expiryDate BIGINT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    );
  `);
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
    try {
        await prisma.$executeRawUnsafe(`
      ALTER TABLE Enrollment ADD COLUMN sectionId INTEGER;
    `);
    }
    catch {
        // Column already exists in existing databases.
    }
}
