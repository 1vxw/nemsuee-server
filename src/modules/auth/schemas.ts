import { z } from "zod";

export const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
  role: z.enum(["STUDENT", "INSTRUCTOR"]),
  studentId: z
    .string()
    .trim()
    .min(5)
    .max(30)
    .regex(/^[A-Za-z0-9-]+$/, "Student ID must be alphanumeric (dash allowed)")
    .optional(),
}).superRefine((data, ctx) => {
  if (data.role === "STUDENT" && !data.studentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["studentId"],
      message: "Student ID is required for student registration",
    });
  }
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const promoteSchema = z.object({
  email: z.string().email(),
  bootstrapKey: z.string().min(1),
});

export const decisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(300).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const accountStatusSchema = z.object({
  email: z.string().email(),
});
