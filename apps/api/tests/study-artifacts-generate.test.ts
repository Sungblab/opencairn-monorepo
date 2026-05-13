import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentFiles,
  creditLedgerEntries,
  db,
  eq,
  llmUsageEvents,
  notes,
  user,
} from "@opencairn/db";
import type { LLMProvider, StreamChunk } from "../src/lib/llm/provider.js";
import { createApp } from "../src/app.js";
import { grantCredits } from "../src/lib/billing.js";
import { listWorkflowConsoleRuns } from "../src/lib/workflow-console.js";
import { generateStudyArtifact } from "../src/routes/study-artifacts.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const modelOutputs = vi.hoisted(() => [] as string[]);

vi.mock("../src/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/llm")>();
  return {
    ...actual,
    getChatProvider: vi.fn(() => fakeStudyArtifactProvider(modelOutputs)),
  };
});

vi.mock("../src/lib/s3.js", () => ({
  uploadObject: vi.fn().mockResolvedValue(undefined),
}));

const app = createApp();

describe("study artifact generation routes", () => {
  let seed: SeedResult | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    modelOutputs.length = 0;
    await seed?.cleanup();
    seed = undefined;
  });

  it("generates and stores a validated quiz artifact as a JSON agent file", async () => {
    seed = await seedWorkspace({ role: "owner" });
    await db
      .update(notes)
      .set({
        title: "운영체제 노트",
        contentText:
          "페이지 테이블은 가상 주소를 물리 주소로 변환하는 매핑 정보를 저장한다.",
      })
      .where(eq(notes.id, seed.noteId));
    const cookie = await signSessionCookie(seed.userId);

    const response = await app.request(
      `/api/projects/${seed.projectId}/study-artifacts/generate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          type: "quiz_set",
          title: "운영체제 퀴즈",
          sourceNoteIds: [seed.noteId],
          difficulty: "medium",
          tags: ["운영체제"],
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      artifact: {
        type: string;
        title: string;
        sourceIds: string[];
        questions: Array<{
          prompt: string;
          explanation?: string;
          sourceRefs: Array<{ sourceId: string; label?: string; quote?: string }>;
        }>;
      };
      file: { id: string; kind: string; filename: string; title: string };
    };
    expect(body.artifact).toMatchObject({
      type: "quiz_set",
      title: "운영체제 퀴즈",
      sourceIds: [seed.noteId],
    });
    expect(body.artifact.questions[0]?.prompt).toContain("운영체제 노트");
    expect(body.artifact.questions[0]?.explanation).toContain("페이지 테이블");
    expect(body.artifact.questions[0]?.sourceRefs).toEqual([
      {
        sourceId: seed.noteId,
        label: "운영체제 노트",
        quote: "페이지 테이블은 가상 주소를 물리 주소로 변환하는 매핑 정보를 저장한다.",
      },
    ]);
    expect(body.file).toMatchObject({
      kind: "json",
      filename: "quiz-set.json",
      title: "운영체제 퀴즈",
    });

    const [file] = await db
      .select({ id: agentFiles.id, projectId: agentFiles.projectId })
      .from(agentFiles)
      .where(eq(agentFiles.id, body.file.id));
    expect(file).toMatchObject({
      id: body.file.id,
      projectId: seed.projectId,
    });

    const consoleRuns = await listWorkflowConsoleRuns(seed.projectId, seed.userId, {
      limit: 20,
    });
    expect(consoleRuns).toContainEqual(
      expect.objectContaining({
        runType: "agent_action",
        title: "file.create",
        status: "completed",
        outputs: expect.arrayContaining([
          expect.objectContaining({
            outputType: "agent_file",
            id: body.file.id,
            label: "quiz-set.json",
          }),
        ]),
      }),
    );
  });

  it("does not generate artifacts for project viewers", async () => {
    seed = await seedWorkspace({ role: "viewer" });
    const cookie = await signSessionCookie(seed.userId);

    const response = await app.request(
      `/api/projects/${seed.projectId}/study-artifacts/generate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          type: "glossary",
          sourceNoteIds: [seed.noteId],
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("records model usage and debits managed credits for model-generated artifacts", async () => {
    vi.stubEnv("STUDY_ARTIFACT_MODEL_ENABLED", "1");
    seed = await seedWorkspace({ role: "owner" });
    await db
      .update(user)
      .set({ plan: "pro" })
      .where(eq(user.id, seed.userId));
    await grantCredits({
      userId: seed.userId,
      credits: 10_000,
      kind: "subscription_grant",
      plan: "pro",
      idempotencyKey: `${seed.userId}:study-artifact-grant`,
    });
    await db
      .update(notes)
      .set({
        title: "운영체제 노트",
        contentText: "페이지 테이블은 가상 주소를 물리 주소로 변환한다.",
      })
      .where(eq(notes.id, seed.noteId));
    modelOutputs.push(JSON.stringify(validQuizArtifact({
      sourceId: seed.noteId,
      title: "운영체제 퀴즈",
    })));
    const cookie = await signSessionCookie(seed.userId);

    const response = await app.request(
      `/api/projects/${seed.projectId}/study-artifacts/generate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          type: "quiz_set",
          title: "운영체제 퀴즈",
          sourceNoteIds: [seed.noteId],
          difficulty: "hard",
          itemCount: 1,
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      artifact: { createdByRunId: string };
    };
    const [usage] = await db
      .select()
      .from(llmUsageEvents)
      .where(eq(llmUsageEvents.sourceId, body.artifact.createdByRunId));
    expect(usage).toMatchObject({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "studio.quiz",
      sourceType: "study_artifact",
      sourceId: body.artifact.createdByRunId,
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });
    const [ledger] = await db
      .select()
      .from(creditLedgerEntries)
      .where(
        eq(
          creditLedgerEntries.idempotencyKey,
          `study_artifact:${body.artifact.createdByRunId}:usage`,
        ),
      );
    expect(ledger).toMatchObject({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      kind: "usage",
      billingPath: "managed",
      sourceType: "study_artifact",
      sourceId: body.artifact.createdByRunId,
      requestId: body.artifact.createdByRunId,
    });
  });

  it("records model usage for retryable invalid artifact failures", async () => {
    vi.stubEnv("STUDY_ARTIFACT_MODEL_ENABLED", "1");
    seed = await seedWorkspace({ role: "owner" });
    await db
      .update(notes)
      .set({
        title: "운영체제 노트",
        contentText: "페이지 테이블은 가상 주소를 물리 주소로 변환한다.",
      })
      .where(eq(notes.id, seed.noteId));
    modelOutputs.push(
      JSON.stringify({ type: "quiz_set" }),
      JSON.stringify({ type: "quiz_set" }),
    );
    const cookie = await signSessionCookie(seed.userId);

    const response = await app.request(
      `/api/projects/${seed.projectId}/study-artifacts/generate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          type: "quiz_set",
          title: "운영체제 퀴즈",
          sourceNoteIds: [seed.noteId],
          difficulty: "hard",
          itemCount: 1,
        }),
      },
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as {
      error: string;
      retryable: boolean;
      runId: string;
      issues: unknown[];
    };
    expect(body).toMatchObject({
      error: "study_artifact_model_invalid",
      retryable: true,
    });
    expect(body.runId).toMatch(/^study_artifact:/);
    expect(body.issues.length).toBeGreaterThan(0);

    const [usage] = await db
      .select()
      .from(llmUsageEvents)
      .where(eq(llmUsageEvents.sourceId, body.runId));
    expect(usage).toMatchObject({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "studio.quiz",
      sourceType: "study_artifact",
      sourceId: body.runId,
      tokensIn: 2_000_000,
      tokensOut: 2_000_000,
    });
  });
});

describe("generateStudyArtifact", () => {
  it("uses model JSON and repairs invalid structured output before validation", async () => {
    const provider = fakeStudyArtifactProvider([
      JSON.stringify({
        type: "quiz_set",
        questions: [
          {
            id: "q-1",
            kind: "multiple_choice",
            prompt: "운영체제에서 페이지 테이블의 역할은?",
            choices: [{ id: "a", text: "가상 주소를 물리 주소로 매핑한다." }],
            answer: { choiceId: "a" },
            explanation: "페이지 테이블은 주소 변환 매핑을 저장한다.",
            sourceRefs: [
              {
                sourceId: "11111111-1111-4111-8111-111111111111",
                label: "운영체제 노트",
                quote: "페이지 테이블은 가상 주소를 물리 주소로 변환한다.",
              },
            ],
          },
        ],
      }),
      JSON.stringify({
        type: "quiz_set",
        title: "운영체제 퀴즈",
        sourceIds: ["11111111-1111-4111-8111-111111111111"],
        difficulty: "hard",
        tags: ["운영체제"],
        createdByRunId: "study_artifact:model-test",
        renderTargets: ["interactive_view", "json_file"],
        questions: [
          {
            id: "q-1",
            kind: "multiple_choice",
            prompt: "운영체제에서 페이지 테이블의 역할은?",
            choices: [{ id: "a", text: "가상 주소를 물리 주소로 매핑한다." }],
            answer: { choiceId: "a" },
            explanation: "페이지 테이블은 주소 변환 매핑을 저장한다.",
            sourceRefs: [
              {
                sourceId: "11111111-1111-4111-8111-111111111111",
                label: "운영체제 노트",
                quote: "페이지 테이블은 가상 주소를 물리 주소로 변환한다.",
              },
            ],
          },
        ],
      }),
    ]);

    const result = await generateStudyArtifact(
      {
        type: "quiz_set",
        title: "운영체제 퀴즈",
        sourceNoteIds: ["11111111-1111-4111-8111-111111111111"],
        difficulty: "hard",
        tags: ["운영체제"],
        itemCount: 1,
      },
      [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "운영체제 노트",
          contentText: "페이지 테이블은 가상 주소를 물리 주소로 변환한다.",
        },
      ],
      { provider },
    );

    expect(result.artifact).toMatchObject({
      type: "quiz_set",
      title: "운영체제 퀴즈",
      sourceIds: ["11111111-1111-4111-8111-111111111111"],
      difficulty: "hard",
      tags: ["운영체제"],
    });
    expect(result.artifact.questions[0]).toMatchObject({
      prompt: "운영체제에서 페이지 테이블의 역할은?",
      explanation: "페이지 테이블은 주소 변환 매핑을 저장한다.",
    });
    expect(provider.streamGenerate).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify(provider.streamGenerate.mock.calls[1]?.[0].messages),
    ).toContain("validationErrors");
  });
});

function fakeStudyArtifactProvider(outputs: string[]) {
  const provider = {
    embed: vi.fn(async () => new Array(768).fill(0)),
    streamGenerate: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      const next = outputs.shift() ?? "";
      yield { delta: next };
      yield {
        usage: {
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
          model: "gemini-3-flash-preview",
        },
      };
    }),
  };
  return provider as unknown as LLMProvider & {
    streamGenerate: ReturnType<typeof vi.fn>;
  };
}

function validQuizArtifact(input: { sourceId: string; title: string }) {
  return {
    type: "quiz_set",
    title: input.title,
    sourceIds: [input.sourceId],
    difficulty: "hard",
    tags: [],
    createdByRunId: "study_artifact:model-test",
    renderTargets: ["interactive_view", "json_file"],
    questions: [
      {
        id: "q-1",
        kind: "multiple_choice",
        prompt: "운영체제에서 페이지 테이블의 역할은?",
        choices: [{ id: "a", text: "가상 주소를 물리 주소로 매핑한다." }],
        answer: { choiceId: "a" },
        explanation: "페이지 테이블은 주소 변환 매핑을 저장한다.",
        sourceRefs: [
          {
            sourceId: input.sourceId,
            label: "운영체제 노트",
            quote: "페이지 테이블은 가상 주소를 물리 주소로 변환한다.",
          },
        ],
      },
    ],
  };
}
