import { z } from "zod";

export const teachBackSchema = z.object({
  concept: z.string(),
  explanation: z.string(),
  analogy: z.string().optional(),
  key_points: z.array(z.string()).min(2).max(8),
  common_mistakes: z.array(z.string()).max(5),
  follow_up_questions: z.array(z.string()).min(1).max(5),
});
export type TeachBackOutput = z.infer<typeof teachBackSchema>;
