import { z } from "zod";

const quizTypeSchema = z.enum(["MULTIPLE_CHOICE", "TRUE_FALSE"]);

const questionSchema = z
  .object({
    prompt: z.string().min(2),
    optionA: z.string().min(1),
    optionB: z.string().min(1),
    optionC: z.string().optional().default(""),
    optionD: z.string().optional().default(""),
    correctOption: z.enum(["A", "B", "C", "D"]),
  })
  .superRefine((value, ctx) => {
    const hasC = value.optionC.trim().length > 0;
    const hasD = value.optionD.trim().length > 0;
    if ((hasC && !hasD) || (!hasC && hasD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "optionC and optionD must both be provided or both be empty",
      });
    }
    if (!hasC && !hasD && (value.correctOption === "C" || value.correctOption === "D")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "correctOption must be A or B for two-option questions",
      });
    }
  });

export const quizSchema = z.object({
  lessonId: z.number(),
  quizType: quizTypeSchema.optional().default("MULTIPLE_CHOICE"),
  questions: z.array(questionSchema).min(1),
});

export const quizUpdateSchema = z.object({
  quizType: quizTypeSchema.optional().default("MULTIPLE_CHOICE"),
  questions: z.array(questionSchema).min(1),
});

export const submitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.number(),
      selectedOption: z.enum(["A", "B", "C", "D"]),
    }),
  ),
});
