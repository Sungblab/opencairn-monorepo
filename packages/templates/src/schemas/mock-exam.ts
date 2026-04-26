import { z } from "zod";

export const mockExamSchema = z.object({
  title: z.string(),
  duration_minutes: z.number().int().positive(),
  sections: z
    .array(
      z.object({
        name: z.string(),
        questions: z.array(
          z.object({
            type: z.enum(["mcq", "short_answer", "essay"]),
            question: z.string(),
            marks: z.number().int().positive(),
            answer_guide: z.string(),
            options: z.array(z.string()).optional(),
            correct_option: z.number().int().optional(),
          }),
        ),
      }),
    )
    .min(1),
});
export type MockExamOutput = z.infer<typeof mockExamSchema>;
