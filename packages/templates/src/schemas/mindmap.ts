import { z } from "zod";

export const mindmapSchema = z.object({
  root: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      parentId: z.string().nullable(),
      depth: z.number().int().min(0),
      color: z.string().optional(),
    }),
  ),
});
export type MindmapOutput = z.infer<typeof mindmapSchema>;
