import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNull,
  notes,
  projects,
  user,
} from "@opencairn/db";
import {
  billingPlanConfigs,
  buildStudyArtifactRepairInput,
  generateStudyArtifactRequestSchema,
  studyArtifactToJsonFileCreateAction,
  validateStudyArtifact,
  type GenerateStudyArtifactRequest,
  type StudyArtifact,
  type StudyArtifactValidationIssue,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";
import { canRead, canWrite } from "../lib/permissions";
import { createAgentAction } from "../lib/agent-actions";
import {
  chargeManagedCredits,
  InsufficientCreditsError,
} from "../lib/billing";
import { getChatProvider } from "../lib/llm";
import { recordLlmUsageEvent } from "../lib/llm-usage";
import { envInt } from "../lib/env";
import {
  LLMNotConfiguredError,
  type LLMProvider,
  type Usage,
} from "../lib/llm/provider";

type SourceNote = {
  id: string;
  title: string;
  contentText: string | null;
};

export const studyArtifactRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .post(
    "/:projectId/study-artifacts/generate",
    zValidator("json", generateStudyArtifactRequestSchema),
    async (c) => {
      const userId = c.get("userId");
      const projectId = c.req.param("projectId");
      const input = c.req.valid("json");

      const [project] = await db
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (!project) return c.json({ error: "not_found" }, 404);
      if (!(await canWrite(userId, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }

      const sourceRows = await db
        .select({
          id: notes.id,
          title: notes.title,
          contentText: notes.contentText,
        })
        .from(notes)
        .where(
          and(
            eq(notes.projectId, projectId),
            isNull(notes.deletedAt),
            inArray(notes.id, input.sourceNoteIds),
          ),
        )
        .orderBy(asc(notes.createdAt), asc(notes.id));
      if (sourceRows.length !== new Set(input.sourceNoteIds).size) {
        return c.json({ error: "source_not_found" }, 404);
      }
      for (const source of sourceRows) {
        if (!(await canRead(userId, { type: "note", id: source.id }))) {
          return c.json({ error: "source_not_found" }, 404);
        }
      }

      let generated: Awaited<ReturnType<typeof generateStudyArtifact>>;
      try {
        generated = await generateStudyArtifact(input, sourceRows);
      } catch (error) {
        if (error instanceof StudyArtifactModelError) {
          await recordStudyArtifactUsage({
            userId,
            workspaceId: project.workspaceId,
            runId: error.runId,
            artifactType: input.type,
            title: input.title ?? defaultTitle(input.type, sourceRows[0]!.title),
            usage: error.usage,
            status: "failed",
          });
          return c.json(
            {
              error: error.code,
              retryable: true,
              runId: error.runId,
              issues: error.issues,
            },
            502,
          );
        }
        throw error;
      }

      const validation = validateStudyArtifact(generated.artifact);
      if (!validation.success) {
        console.error("[study-artifacts] generated invalid artifact", validation.issues);
        return c.json({ error: "study_artifact_invalid" }, 500);
      }
      await recordStudyArtifactModelUsage({
        userId,
        workspaceId: project.workspaceId,
        artifact: validation.artifact,
        usage: generated.usage,
      });

      const { action } = await createAgentAction(
        projectId,
        userId,
        studyArtifactToJsonFileCreateAction(validation.artifact, {
          requestId: randomUUID(),
          approvalMode: "auto_safe",
        }),
      );
      const file = fileFromActionResult(action.result);
      if (!file) {
        console.error("[study-artifacts] file action completed without file", action);
        return c.json({ error: "study_artifact_file_missing" }, 500);
      }

      return c.json({ artifact: validation.artifact, file, action }, 201);
    },
  );

type GenerateStudyArtifactOptions = {
  provider?: LLMProvider;
};

export async function generateStudyArtifact(
  input: GenerateStudyArtifactRequest,
  sources: SourceNote[],
  options: GenerateStudyArtifactOptions = {},
): Promise<{
  artifact: StudyArtifact;
  generation: "model" | "deterministic";
  usage: Usage | null;
}> {
  if (shouldUseModelGeneration(options)) {
    try {
      const result = await buildModelStudyArtifact(input, sources, options);
      return { ...result, generation: "model" };
    } catch (error) {
      if (error instanceof LLMNotConfiguredError) {
        return {
          artifact: buildDeterministicStudyArtifact(input, sources),
          generation: "deterministic",
          usage: null,
        };
      }
      throw error;
    }
  }

  return {
    artifact: buildDeterministicStudyArtifact(input, sources),
    generation: "deterministic",
    usage: null,
  };
}

function shouldUseModelGeneration(options: GenerateStudyArtifactOptions): boolean {
  if (options.provider) return true;
  if (process.env.STUDY_ARTIFACT_MODEL_ENABLED === "0") return false;
  if (
    process.env.NODE_ENV === "test" &&
    process.env.STUDY_ARTIFACT_MODEL_ENABLED !== "1"
  ) {
    return false;
  }
  return true;
}

async function buildModelStudyArtifact(
  input: GenerateStudyArtifactRequest,
  sources: SourceNote[],
  options: GenerateStudyArtifactOptions,
): Promise<{ artifact: StudyArtifact; usage: Usage | null }> {
  const provider = options.provider ?? getChatProvider();
  const createdByRunId = `study_artifact:${randomUUID()}`;
  const first = await collectStudyArtifactJson(provider, {
    input,
    sources,
    createdByRunId,
  });
  const firstCandidate = parseJsonObject(first.text);
  const firstValidation = validateStudyArtifact(firstCandidate);
  if (firstValidation.success) {
    return {
      artifact: applyTrustedArtifactBase(
        firstValidation.artifact,
        input,
        sources,
        createdByRunId,
      ),
      usage: first.usage,
    };
  }

  const repair = await collectStudyArtifactRepairJson(provider, {
    input,
    sources,
    createdByRunId,
    invalidArtifact: firstCandidate ?? first.text,
    issues: firstValidation.issues,
  });
  const repairCandidate = parseJsonObject(repair.text);
  const repairedValidation = validateStudyArtifact(repairCandidate);
  if (!repairedValidation.success) {
    throw new StudyArtifactModelError(
      "study_artifact_model_invalid",
      repairedValidation.issues,
      createdByRunId,
      mergeUsage(first.usage, repair.usage),
    );
  }
  return {
    artifact: applyTrustedArtifactBase(
      repairedValidation.artifact,
      input,
      sources,
      createdByRunId,
    ),
    usage: mergeUsage(first.usage, repair.usage),
  };
}

async function collectStudyArtifactJson(
  provider: LLMProvider,
  params: {
    input: GenerateStudyArtifactRequest;
    sources: SourceNote[];
    createdByRunId: string;
  },
): Promise<{ text: string; usage: Usage | null }> {
  return collectModelText(provider, [
    {
      role: "system",
      content: [
        "You generate OpenCairn structured study artifacts.",
        "Return only one strict JSON object matching the requested artifact type.",
        "Use the provided sourceRefs only; do not invent source ids or quotes.",
        "Write naturally in the source language. Prefer Korean when the sources are Korean.",
        "Do not include markdown fences.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(modelArtifactPromptPayload(params)),
    },
  ]);
}

async function collectStudyArtifactRepairJson(
  provider: LLMProvider,
  params: {
    input: GenerateStudyArtifactRequest;
    sources: SourceNote[];
    createdByRunId: string;
    invalidArtifact: unknown;
    issues: StudyArtifactValidationIssue[];
  },
): Promise<{ text: string; usage: Usage | null }> {
  return collectModelText(provider, [
    {
      role: "system",
      content: [
        "Repair the OpenCairn study artifact JSON so it validates.",
        "Return only one strict JSON object. Do not include markdown fences.",
        "Keep the same artifact type and use only the supplied sourceRefs.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        ...modelArtifactPromptPayload(params),
        repair: buildStudyArtifactRepairInput(
          params.invalidArtifact,
          params.issues,
        ),
      }),
    },
  ]);
}

async function collectModelText(
  provider: LLMProvider,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ text: string; usage: Usage | null }> {
  let text = "";
  let usage: Usage | null = null;
  for await (const chunk of provider.streamGenerate({
    messages,
    maxOutputTokens: envInt("STUDY_ARTIFACT_MAX_OUTPUT_TOKENS", 16_000),
    temperature: 0.2,
    thinkingLevel: "low",
  })) {
    if ("delta" in chunk) {
      text += chunk.delta;
      if (text.length > 500_000) break;
    } else if ("usage" in chunk) {
      usage = chunk.usage;
    }
  }
  return { text, usage };
}

function mergeUsage(first: Usage | null, second: Usage | null): Usage | null {
  if (!first) return second;
  if (!second) return first;
  return {
    model: second.model || first.model,
    tokensIn: first.tokensIn + second.tokensIn,
    tokensOut: first.tokensOut + second.tokensOut,
  };
}

function modelArtifactPromptPayload(params: {
  input: GenerateStudyArtifactRequest;
  sources: SourceNote[];
  createdByRunId: string;
}) {
  const sourceRefs = params.sources.map(sourceRefForNote);
  return {
    requestedType: params.input.type,
    itemCount: params.input.itemCount,
    trustedBase: {
      title: params.input.title ?? defaultTitle(params.input.type, params.sources[0]!.title),
      sourceIds: params.input.sourceNoteIds,
      difficulty: params.input.difficulty,
      tags: params.input.tags,
      createdByRunId: params.createdByRunId,
      renderTargets: defaultRenderTargets(),
    },
    allowedSourceRefs: sourceRefs,
    schemaNotes: [
      "quiz_set.questions[] need id, kind, prompt, answer, optional choices, explanation, sourceRefs.",
      "mock_exam.sections[] need id, title, questions[], and each question follows quiz_set question shape.",
      "flashcard_deck.cards[] need id, front, back, tags, sourceRefs.",
      "fill_blank_set.items[] need id, prompt, blanks[], explanation, sourceRefs.",
      "exam_prep_pack needs keyConcepts[], expectedQuestions[], weakSpots[].",
      "compare_table needs columns[] and rows[] with label, cells, sourceRefs.",
      "glossary needs terms[] with id, term, definition, optional example, sourceRefs.",
      "cheat_sheet needs sections[] with id, heading, bullets, sourceRefs.",
      "interactive_html needs html and entryFilename.",
      "data_table needs columns[] and rows[] objects.",
    ],
    sources: params.sources.map((source) => ({
      id: source.id,
      title: source.title,
      text: compactText(source.contentText || source.title, 8_000),
    })),
  };
}

function parseJsonObject(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate =
    fenced?.trim() ??
    text.slice(Math.max(0, text.indexOf("{")), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function applyTrustedArtifactBase(
  artifact: StudyArtifact,
  input: GenerateStudyArtifactRequest,
  sources: SourceNote[],
  createdByRunId: string,
): StudyArtifact {
  const trusted = {
    ...artifact,
    title: input.title ?? defaultTitle(input.type, sources[0]!.title),
    sourceIds: input.sourceNoteIds,
    difficulty: input.difficulty,
    tags: input.tags,
    createdByRunId,
    renderTargets: defaultRenderTargets(),
  };
  const validation = validateStudyArtifact(trusted);
  if (!validation.success) {
    throw new StudyArtifactModelError(
      "study_artifact_model_invalid",
      validation.issues,
      createdByRunId,
      null,
    );
  }
  return validation.artifact;
}

class StudyArtifactModelError extends Error {
  constructor(
    readonly code: "study_artifact_model_invalid",
    readonly issues: StudyArtifactValidationIssue[],
    readonly runId: string,
    readonly usage: Usage | null,
  ) {
    super(code);
    this.name = "StudyArtifactModelError";
  }
}

async function recordStudyArtifactModelUsage(input: {
  userId: string;
  workspaceId: string;
  artifact: StudyArtifact;
  usage: Usage | null;
}) {
  return recordStudyArtifactUsage({
    userId: input.userId,
    workspaceId: input.workspaceId,
    runId: input.artifact.createdByRunId,
    artifactType: input.artifact.type,
    title: input.artifact.title,
    usage: input.usage,
    status: "completed",
  });
}

async function recordStudyArtifactUsage(input: {
  userId: string;
  workspaceId: string;
  runId: string;
  artifactType: StudyArtifact["type"];
  title: string;
  usage: Usage | null;
  status: "completed" | "failed";
}) {
  if (!input.usage) return;
  const usage = input.usage;
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  const operation = studyArtifactOperation(input.artifactType);
  try {
    await recordLlmUsageEvent({
      userId: input.userId,
      workspaceId: input.workspaceId,
      provider,
      model: usage.model,
      operation,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      sourceType: "study_artifact",
      sourceId: input.runId,
      metadata: {
        artifactType: input.artifactType,
        title: input.title,
        status: input.status,
      },
    });
    await chargeStudyArtifactManagedCredits({
      ...input,
      usage,
      provider,
      operation,
    });
  } catch (error) {
    console.warn("study_artifact_usage_record_failed", error);
  }
}

async function chargeStudyArtifactManagedCredits(input: {
  userId: string;
  workspaceId: string;
  runId: string;
  artifactType: StudyArtifact["type"];
  title: string;
  usage: Usage;
  provider: string;
  operation: string;
  status: "completed" | "failed";
}) {
  const [row] = await db
    .select({ plan: user.plan })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  const plan = row?.plan ?? "free";
  if (!billingPlanConfigs[plan].managedLlm) return;

  try {
    await chargeManagedCredits({
      userId: input.userId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      model: input.usage.model,
      operation: input.operation,
      tokensIn: input.usage.tokensIn,
      tokensOut: input.usage.tokensOut,
      sourceType: "study_artifact",
      sourceId: input.runId,
      requestId: input.runId,
      idempotencyKey: `study_artifact:${input.runId}:usage`,
      metadata: {
        artifactType: input.artifactType,
        title: input.title,
        status: input.status,
      },
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      console.warn("study_artifact_credit_charge_insufficient", {
        sourceId: input.runId,
        requiredCredits: error.requiredCredits,
      });
      return;
    }
    throw error;
  }
}

function studyArtifactOperation(type: StudyArtifact["type"]): string {
  switch (type) {
    case "quiz_set":
      return "studio.quiz";
    case "flashcard_deck":
      return "studio.flashcards";
    case "mock_exam":
      return "studio.mock_exam";
    case "fill_blank_set":
      return "studio.fill_blank";
    case "exam_prep_pack":
      return "studio.exam_prep";
    case "compare_table":
      return "studio.compare";
    case "glossary":
      return "studio.glossary";
    case "cheat_sheet":
      return "studio.cheat_sheet";
    case "interactive_html":
      return "studio.interactive_html";
    case "data_table":
      return "studio.data_table";
  }
}

function buildDeterministicStudyArtifact(
  input: GenerateStudyArtifactRequest,
  sources: SourceNote[],
): StudyArtifact {
  const sourceText = compactText(
    sources
      .map((source) => `${source.title}: ${source.contentText || source.title}`)
      .join("\n"),
    2000,
  );
  const primary = sources[0]!;
  const base = {
    title: input.title ?? defaultTitle(input.type, primary.title),
    sourceIds: input.sourceNoteIds,
    difficulty: input.difficulty,
    tags: input.tags,
    createdByRunId: `study_artifact:${randomUUID()}`,
    renderTargets: defaultRenderTargets(),
  };
  const sourceRefs = sources.map(sourceRefForNote);
  const itemCount = Math.max(1, input.itemCount);

  switch (input.type) {
    case "quiz_set":
      return {
        ...base,
        type: "quiz_set",
        questions: range(itemCount).map((index) =>
          quizQuestion(index, primary.title, sourceText, sourceRefs),
        ),
      };
    case "mock_exam":
      return {
        ...base,
        type: "mock_exam",
        sections: [
          {
            id: "section-1",
            title: `${primary.title} Exam`,
            instructions: "Answer from the provided OpenCairn sources.",
            sourceRefs,
            questions: range(itemCount).map((index) =>
              quizQuestion(index, primary.title, sourceText, sourceRefs),
            ),
          },
        ],
      };
    case "flashcard_deck":
      return {
        ...base,
        type: "flashcard_deck",
        cards: range(itemCount).map((index) => ({
          id: `card-${index + 1}`,
          front: `Key idea from ${primary.title}`,
          back: sourceText,
          tags: input.tags,
          sourceRefs,
        })),
      };
    case "fill_blank_set":
      return {
        ...base,
        type: "fill_blank_set",
        items: range(itemCount).map((index) => ({
          id: `blank-${index + 1}`,
          prompt: `${primary.title}: ____`,
          blanks: [{ id: "b1", answer: firstKeyword(sourceText) }],
          explanation: sourceText,
          sourceRefs,
        })),
      };
    case "exam_prep_pack":
      return {
        ...base,
        type: "exam_prep_pack",
        keyConcepts: range(itemCount).map((index) => ({
          id: `concept-${index + 1}`,
          term: firstKeyword(sourceText),
          explanation: sourceText,
          sourceRefs,
        })),
        expectedQuestions: range(itemCount).map((index) =>
          quizQuestion(index, primary.title, sourceText, sourceRefs),
        ),
        weakSpots: [],
      };
    case "compare_table":
      return {
        ...base,
        type: "compare_table",
        columns: ["Topic", "Evidence"],
        rows: sources.map((source, index) => ({
          id: `row-${index + 1}`,
          label: source.title,
          cells: [source.title, compactText(source.contentText || source.title, 500)],
          sourceRefs: [sourceRefForNote(source)],
        })),
      };
    case "glossary":
      return {
        ...base,
        type: "glossary",
        terms: range(itemCount).map((index) => ({
          id: `term-${index + 1}`,
          term: firstKeyword(sourceText),
          definition: sourceText,
          sourceRefs,
        })),
      };
    case "cheat_sheet":
      return {
        ...base,
        type: "cheat_sheet",
        sections: [
          {
            id: "section-1",
            heading: primary.title,
            bullets: splitBullets(sourceText, itemCount),
            sourceRefs,
          },
        ],
      };
    case "interactive_html":
      return {
        ...base,
        type: "interactive_html",
        html: `<!doctype html><html><body><h1>${escapeHtml(base.title)}</h1><p>${escapeHtml(sourceText)}</p></body></html>`,
        entryFilename: "index.html",
      };
    case "data_table":
      return {
        ...base,
        type: "data_table",
        columns: ["source", "summary"],
        rows: sources.map((source) => ({
          source: source.title,
          summary: compactText(source.contentText || source.title, 500),
        })),
      };
  }
}

function sourceRefForNote(source: SourceNote): {
  sourceId: string;
  label: string;
  quote: string;
} {
  return {
    sourceId: source.id,
    label: source.title,
    quote: compactText(source.contentText || source.title, 300),
  };
}

function defaultRenderTargets(): StudyArtifact["renderTargets"] {
  return ["interactive_view", "json_file"];
}

function quizQuestion(
  index: number,
  title: string,
  text: string,
  sourceRefs: Array<{ sourceId: string; label: string }>,
) {
  return {
    id: `q-${index + 1}`,
    kind: "multiple_choice" as const,
    prompt: `What is a key idea from ${title}?`,
    choices: [
      { id: "a", text },
      { id: "b", text: "This is not supported by the selected source." },
    ],
    answer: { choiceId: "a" },
    explanation: text,
    sourceRefs,
  };
}

function defaultTitle(type: string, sourceTitle: string): string {
  return `${sourceTitle} ${type.replaceAll("_", " ")}`;
}

function firstKeyword(text: string): string {
  return text.split(/\s+/).find((word) => word.length >= 2)?.slice(0, 120) ?? "Concept";
}

function splitBullets(text: string, limit: number): string[] {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
  return sentences.length > 0 ? sentences : [text];
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

function compactText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "Source content is available in OpenCairn.";
  return compact.length <= maxLength ? compact : compact.slice(0, maxLength);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileFromActionResult(result: Record<string, unknown> | null | undefined): {
  id: string;
  projectId: string;
  kind: string;
  filename: string;
  title: string;
  folderId?: string | null;
} | null {
  if (!result || typeof result.file !== "object" || result.file === null) {
    return null;
  }
  const file = result.file as Record<string, unknown>;
  if (
    typeof file.id !== "string" ||
    typeof file.projectId !== "string" ||
    typeof file.kind !== "string" ||
    typeof file.filename !== "string" ||
    typeof file.title !== "string"
  ) {
    return null;
  }
  return {
    id: file.id,
    projectId: file.projectId,
    kind: file.kind,
    filename: file.filename,
    title: file.title,
    folderId:
      typeof file.folderId === "string" || file.folderId === null
        ? file.folderId
        : undefined,
  };
}
