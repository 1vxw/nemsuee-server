import { z } from "zod";

export const courseSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(2),
});

export const sectionSchema = z.object({
  name: z.string().min(1),
});

export const lessonSchema = z.object({
  title: z.string().min(2),
  content: z.string().min(2),
  fileUrl: z.string().url().optional().or(z.literal("")),
});

export const lessonUpdateSchema = z.object({
  title: z.string().min(2).optional(),
  content: z.string().min(2).optional(),
  fileUrl: z.string().url().optional().or(z.literal("")),
});

export const enrollSchema = z.object({
  key: z.string().min(6),
});

export const enrollmentDecisionSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    sectionId: z.number().int().positive().optional(),
  })
  .refine(
    (v) => (v.status === "APPROVED" ? Boolean(v.sectionId) : true),
    "sectionId is required to approve",
  );

export const manualAddSchema = z.object({
  email: z.string().email(),
  sectionId: z.number().int().positive(),
});

export const archiveSchema = z.object({
  archived: z.boolean().optional(),
});

export const assignInstructorSchema = z.object({
  instructorId: z.number().int().positive(),
  role: z.string().trim().min(2).max(30).optional(),
});

export const sectionUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const announcementSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  sectionId: z.number().int().positive().optional(),
});
