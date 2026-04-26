import { z } from "zod";

export const fillBlankSchema = z.object({
  passage: z.string(),
  blanks: z
    .array(
      z.object({
        placeholder: z.string(),
        answer: z.string(),
        hint: z.string().optional(),
      }),
    )
    .min(1),
});
export type FillBlankOutput = z.infer<typeof fillBlankSchema>;
