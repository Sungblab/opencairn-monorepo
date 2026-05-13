import { z } from "zod";
import type {
  AgentActionApprovalMode,
  CreateAgentActionRequest,
} from "./agent-actions";
import type { CreateAgentFilePayload } from "./agent-files";

export const studyArtifactTypeSchema = z.enum([
  "quiz_set",
  "mock_exam",
  "flashcard_deck",
  "fill_blank_set",
  "exam_prep_pack",
  "compare_table",
  "glossary",
  "cheat_sheet",
  "interactive_html",
  "data_table",
]);
export type StudyArtifactType = z.infer<typeof studyArtifactTypeSchema>;

export const studyArtifactDifficultySchema = z.enum([
  "easy",
  "medium",
  "hard",
  "mixed",
]);
export type StudyArtifactDifficulty = z.infer<
  typeof studyArtifactDifficultySchema
>;

export const studyArtifactRenderTargetSchema = z.enum([
  "note",
  "interactive_view",
  "json_file",
  "export",
]);

export const studyArtifactSourceRefSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(240).optional(),
    quote: z.string().trim().min(1).max(1000).optional(),
    page: z.number().int().positive().optional(),
    timestampSec: z.number().nonnegative().optional(),
  })
  .strict();

const studyArtifactBaseSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    sourceIds: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
    difficulty: studyArtifactDifficultySchema,
    tags: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
    createdByRunId: z.string().trim().min(1).max(240),
    renderTargets: z.array(studyArtifactRenderTargetSchema).min(1).max(4),
  })
  .strict();

const studyItemBaseSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    sourceRefs: z.array(studyArtifactSourceRefSchema).default([]),
  })
  .strict();

const quizQuestionSchema = studyItemBaseSchema
  .extend({
    kind: z.enum(["multiple_choice", "true_false", "short_answer"]),
    prompt: z.string().trim().min(1).max(2000),
    choices: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(40),
            text: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    answer: z.record(z.unknown()),
    explanation: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const mockExamSectionSchema = studyItemBaseSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(2000).optional(),
    points: z.number().nonnegative().optional(),
    questions: z.array(quizQuestionSchema).min(1).max(80),
  })
  .strict();

const flashcardSchema = studyItemBaseSchema
  .extend({
    front: z.string().trim().min(1).max(1000),
    back: z.string().trim().min(1).max(2000),
    tags: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  })
  .strict();

const fillBlankItemSchema = studyItemBaseSchema
  .extend({
    prompt: z.string().trim().min(1).max(2000),
    blanks: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(40),
            answer: z.string().trim().min(1).max(240),
            hint: z.string().trim().min(1).max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    explanation: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const examPrepPackSchema = studyArtifactBaseSchema
  .extend({
    type: z.literal("exam_prep_pack"),
    keyConcepts: z
      .array(
        studyItemBaseSchema.extend({
          term: z.string().trim().min(1).max(200),
          explanation: z.string().trim().min(1).max(2000),
        }),
      )
      .min(1)
      .max(80),
    expectedQuestions: z.array(quizQuestionSchema).min(1).max(80),
    weakSpots: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
  })
  .strict();

const compareTableSchema = studyArtifactBaseSchema
  .extend({
    type: z.literal("compare_table"),
    columns: z.array(z.string().trim().min(1).max(120)).min(2).max(12),
    rows: z
      .array(
        studyItemBaseSchema
          .extend({
            label: z.string().trim().min(1).max(200),
            cells: z.array(z.string().trim().max(2000)).min(2).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(120),
  })
  .strict();

const glossarySchema = studyArtifactBaseSchema
  .extend({
    type: z.literal("glossary"),
    terms: z
      .array(
        studyItemBaseSchema
          .extend({
            term: z.string().trim().min(1).max(200),
            definition: z.string().trim().min(1).max(2000),
            example: z.string().trim().min(1).max(1000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const cheatSheetSchema = studyArtifactBaseSchema
  .extend({
    type: z.literal("cheat_sheet"),
    sections: z
      .array(
        studyItemBaseSchema
          .extend({
            heading: z.string().trim().min(1).max(200),
            bullets: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();

const dataTableSchema = studyArtifactBaseSchema
  .extend({
    type: z.literal("data_table"),
    columns: z.array(z.string().trim().min(1).max(120)).min(1).max(40),
    rows: z.array(z.record(z.unknown())).min(1).max(500),
  })
  .strict();

export const studyArtifactSchema = z
  .discriminatedUnion("type", [
    studyArtifactBaseSchema
      .extend({
        type: z.literal("quiz_set"),
        questions: z.array(quizQuestionSchema).min(1).max(120),
      })
      .strict(),
    studyArtifactBaseSchema
      .extend({
        type: z.literal("mock_exam"),
        sections: z.array(mockExamSectionSchema).min(1).max(20),
      })
      .strict(),
    studyArtifactBaseSchema
      .extend({
        type: z.literal("flashcard_deck"),
        cards: z.array(flashcardSchema).min(1).max(500),
      })
      .strict(),
    studyArtifactBaseSchema
      .extend({
        type: z.literal("fill_blank_set"),
        items: z.array(fillBlankItemSchema).min(1).max(120),
      })
      .strict(),
    examPrepPackSchema,
    compareTableSchema,
    glossarySchema,
    cheatSheetSchema,
    studyArtifactBaseSchema
      .extend({
        type: z.literal("interactive_html"),
        html: z.string().trim().min(1).max(500_000),
        entryFilename: z.string().trim().min(1).max(200).default("index.html"),
      })
      .strict(),
    dataTableSchema,
  ])
  .superRefine((artifact, ctx) => {
    switch (artifact.type) {
      case "quiz_set":
        rejectDuplicateItemIds(artifact.questions, ["questions"], ctx);
        return;
      case "mock_exam":
        rejectDuplicateItemIds(artifact.sections, ["sections"], ctx);
        artifact.sections.forEach((section, sectionIndex) =>
          rejectDuplicateItemIds(
            section.questions,
            ["sections", sectionIndex, "questions"],
            ctx,
          ),
        );
        return;
      case "flashcard_deck":
        rejectDuplicateItemIds(artifact.cards, ["cards"], ctx);
        return;
      case "fill_blank_set":
        rejectDuplicateItemIds(artifact.items, ["items"], ctx);
        return;
      case "exam_prep_pack":
        rejectDuplicateItemIds(artifact.keyConcepts, ["keyConcepts"], ctx);
        rejectDuplicateItemIds(
          artifact.expectedQuestions,
          ["expectedQuestions"],
          ctx,
        );
        return;
      case "compare_table":
        rejectDuplicateItemIds(artifact.rows, ["rows"], ctx);
        return;
      case "glossary":
        rejectDuplicateItemIds(artifact.terms, ["terms"], ctx);
        return;
      case "cheat_sheet":
        rejectDuplicateItemIds(artifact.sections, ["sections"], ctx);
        return;
      default:
        return;
    }
  });

export type StudyArtifact = z.infer<typeof studyArtifactSchema>;

export const generateStudyArtifactRequestSchema = z
  .object({
    type: studyArtifactTypeSchema,
    sourceNoteIds: z.array(z.string().uuid()).min(1).max(20),
    title: z.string().trim().min(1).max(240).optional(),
    difficulty: studyArtifactDifficultySchema.default("mixed"),
    tags: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
    itemCount: z.number().int().min(1).max(20).default(5),
  })
  .strict();

export type GenerateStudyArtifactRequest = z.infer<
  typeof generateStudyArtifactRequestSchema
>;

export type StudyArtifactValidationIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
};

export type StudyArtifactValidationResult =
  | { success: true; artifact: StudyArtifact; issues: [] }
  | { success: false; issues: StudyArtifactValidationIssue[] };

export type StudyArtifactRepairInput = {
  invalidArtifact: unknown;
  validationErrors: Array<{
    code: string;
    path: string;
    message: string;
  }>;
};

export function studyArtifactToJsonAgentFile(
  artifact: StudyArtifact,
): CreateAgentFilePayload {
  return {
    filename: `${artifact.type.replaceAll("_", "-")}.json`,
    title: artifact.title,
    kind: "json",
    mimeType: "application/json",
    content: JSON.stringify(artifact, null, 2),
    startIngest: false,
  };
}

export function studyArtifactToJsonFileCreateAction(
  artifact: StudyArtifact,
  opts: {
    requestId?: string;
    approvalMode?: AgentActionApprovalMode;
  } = {},
): CreateAgentActionRequest {
  return {
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
    sourceRunId: artifact.createdByRunId,
    kind: "file.create",
    risk: "write",
    approvalMode: opts.approvalMode ?? "auto_safe",
    input: studyArtifactToJsonAgentFile(artifact),
    preview: {
      studyArtifact: {
        type: artifact.type,
        title: artifact.title,
        sourceIds: artifact.sourceIds,
        renderTargets: artifact.renderTargets,
      },
    },
  };
}

export function validateStudyArtifact(
  value: unknown,
): StudyArtifactValidationResult {
  const result = studyArtifactSchema.safeParse(value);
  if (result.success) {
    return { success: true, artifact: result.data, issues: [] };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => {
      const customParams = "params" in issue ? issue.params : undefined;
      return {
        code:
          typeof customParams?.code === "string"
            ? customParams.code
            : issue.code,
        path: issue.path,
        message: issue.message,
      };
    }),
  };
}

export function buildStudyArtifactRepairInput(
  invalidArtifact: unknown,
  issues: StudyArtifactValidationIssue[],
): StudyArtifactRepairInput {
  return {
    invalidArtifact,
    validationErrors: issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function rejectDuplicateItemIds(
  items: Array<{ id: string }>,
  basePath: Array<string | number>,
  ctx: z.RefinementCtx,
) {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const firstIndex = seen.get(item.id);
    if (firstIndex === undefined) {
      seen.set(item.id, index);
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...basePath, index, "id"],
      message: `Duplicate item id "${item.id}" also appears at ${[
        ...basePath,
        firstIndex,
        "id",
      ].join(".")}.`,
      params: { code: "duplicate_item_id" },
    });
  });
}
