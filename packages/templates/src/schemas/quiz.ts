import { z } from "zod";

export const quizSchema = z.object({
  title: z.string(),
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string(),
      }),
    )
    .min(1)
    .max(20),
});
export type QuizOutput = z.infer<typeof quizSchema>;
