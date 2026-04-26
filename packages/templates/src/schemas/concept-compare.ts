import { z } from "zod";

export const conceptCompareSchema = z.object({
  concept_a: z.string(),
  concept_b: z.string(),
  similarities: z.array(z.string()).min(1),
  differences: z
    .array(
      z.object({
        dimension: z.string(),
        a: z.string(),
        b: z.string(),
      }),
    )
    .min(1),
  when_to_use_a: z.string(),
  when_to_use_b: z.string(),
  summary: z.string(),
});
export type ConceptCompareOutput = z.infer<typeof conceptCompareSchema>;
