import { afterEach, describe, expect, it } from "vitest";
import { chatThreads, conversations, db } from "@opencairn/db";
import {
  formatAgentMemoryContext,
  runAgent,
  resolveAgentMemoryPolicy,
  resolveAgentRetrievalOptions,
} from "../src/lib/agent-pipeline.js";
import type { ChatMsg, LLMProvider } from "../src/lib/llm/provider.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

describe("agent-pipeline retrieval scope", () => {
  it("normalizes concrete page/project/workspace chips", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: {
        strict: "strict",
        chips: [
          { type: "page", id: "n1" },
          { type: "project", id: "p1" },
          { type: "workspace", id: "w1" },
        ],
      },
    });

    expect(resolved).toEqual({
      scope: { type: "workspace", workspaceId: "w1" },
      ragMode: "strict",
      chips: [
        { type: "page", id: "n1" },
        { type: "project", id: "p1" },
        { type: "workspace", id: "w1" },
      ],
    });
  });

  it("maps loose mode to expanded retrieval and drops unsupported chips", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: {
        strict: "loose",
        chips: [
          { type: "workspace", id: "other" },
          { type: "memory", id: "m1" },
          { type: "page", id: 123 },
        ],
      },
    });

    expect(resolved).toEqual({
      scope: { type: "workspace", workspaceId: "w1" },
      ragMode: "expand",
      chips: [],
    });
  });

  it("lets explicit ragMode override the UI strictness flag", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: { strict: "loose", chips: [{ type: "page", id: "n1" }] },
      ragMode: "off",
    });

    expect(resolved.ragMode).toBe("off");
    expect(resolved.chips).toEqual([{ type: "page", id: "n1" }]);
  });

  it("keeps selected current-source prompts page-scoped", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: {
        strict: "strict",
        manifest: {
          projectId: "p1",
          sourcePolicy: "auto_project",
        },
        chips: [
          { type: "page", id: "n1" },
          { type: "project", id: "p1" },
        ],
        invocationContext: {
          kind: "source",
          sourceId: "n1",
          selectionText: "선택된 문장",
        },
      },
    });

    expect(resolved).toEqual({
      scope: { type: "page", workspaceId: "w1", noteId: "n1" },
      ragMode: "strict",
      chips: [{ type: "page", id: "n1" }],
    });
  });

  it("uses project scope when the manifest carries the active project", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: {
        manifest: {
          projectId: "p1",
          sourcePolicy: "auto_project",
        },
      },
    });

    expect(resolved.scope).toEqual({
      type: "project",
      workspaceId: "w1",
      projectId: "p1",
    });
  });
});

describe("agent-pipeline memory policy", () => {
  let seed: SeedResult | undefined;

  afterEach(async () => {
    await seed?.cleanup();
    seed = undefined;
  });

  it("defaults to auto but respects explicit memoryPolicy=off", () => {
    expect(resolveAgentMemoryPolicy(undefined)).toBe("auto");
    expect(
      resolveAgentMemoryPolicy({
        manifest: { memoryPolicy: "off" },
      }),
    ).toBe("off");
  });

  it("formats session and summary memory for the durable chat prompt", () => {
    expect(
      formatAgentMemoryContext({
        sessionMemoryMd: "- prefers source-grounded quizzes",
        fullSummary: "The thread is preparing for an OS exam.",
        scopesUsed: ["conversation:l1", "conversation:summary"],
      }),
    ).toContain("## Durable Task Memory");
  });

  it("bridges conversation memory into durable Agent Panel runs when memory is auto", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const [thread] = await db
      .insert(chatThreads)
      .values({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        title: "memory bridge",
      })
      .returning({ id: chatThreads.id });
    await db.insert(conversations).values({
      workspaceId: seed.workspaceId,
      ownerUserId: seed.userId,
      scopeType: "project",
      scopeId: seed.projectId,
      attachedChips: [],
      ragMode: "strict",
      memoryFlags: {
        l3_global: true,
        l3_workspace: true,
        l4: true,
        l2: false,
      },
      sessionMemoryMd: "- use exam terminology from the source",
      fullSummary: "The user is preparing a study artifact.",
    });

    let capturedMessages: ChatMsg[] = [];
    const provider: LLMProvider = {
      async embed() {
        return [0.1];
      },
      async *streamGenerate({ messages }) {
        capturedMessages = messages;
        yield { delta: "ok" };
      },
    };
    const chunks = [];

    for await (const chunk of runAgent({
      threadId: thread.id,
      userId: seed.userId,
      userMessage: {
        content: "이어서 해줘",
        scope: {
          manifest: { memoryPolicy: "auto", projectId: seed.projectId },
        },
      },
      mode: "auto",
      provider,
      ragMode: "off",
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({
      type: "status",
      payload: {
        kind: "memory_context",
        memoryPolicy: "auto",
        memoryIncluded: true,
        scopesUsed: [`conversation:project:${seed.projectId}`],
      },
    });
    expect(chunks[1]).toEqual({
      type: "status",
      payload: {
        kind: "runtime_context",
        executionClass: "durable_run",
        chatMode: "auto",
        ragMode: "off",
        memoryPolicy: "auto",
      },
    });
    expect(capturedMessages[0]?.content).toContain("## Durable Task Memory");
    expect(capturedMessages[0]?.content).toContain(
      "- use exam terminology from the source",
    );
  });

  it("excludes conversation memory when memoryPolicy is off", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const [thread] = await db
      .insert(chatThreads)
      .values({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        title: "memory off",
      })
      .returning({ id: chatThreads.id });
    await db.insert(conversations).values({
      workspaceId: seed.workspaceId,
      ownerUserId: seed.userId,
      scopeType: "project",
      scopeId: seed.projectId,
      attachedChips: [],
      ragMode: "strict",
      memoryFlags: {
        l3_global: true,
        l3_workspace: true,
        l4: true,
        l2: false,
      },
      sessionMemoryMd: "- hidden when off",
      fullSummary: "This must not be injected.",
    });

    let capturedMessages: ChatMsg[] = [];
    const provider: LLMProvider = {
      async embed() {
        return [0.1];
      },
      async *streamGenerate({ messages }) {
        capturedMessages = messages;
        yield { delta: "ok" };
      },
    };
    const chunks = [];

    for await (const chunk of runAgent({
      threadId: thread.id,
      userId: seed.userId,
      userMessage: {
        content: "메모리 없이 답해줘",
        scope: {
          manifest: { memoryPolicy: "off", projectId: seed.projectId },
        },
      },
      mode: "auto",
      provider,
      ragMode: "off",
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({
      type: "status",
      payload: {
        kind: "memory_context",
        memoryPolicy: "off",
        memoryIncluded: false,
        scopesUsed: [],
      },
    });
    expect(chunks[1]).toMatchObject({
      type: "status",
      payload: {
        kind: "runtime_context",
        chatMode: "auto",
        ragMode: "off",
        memoryPolicy: "off",
      },
    });
    expect(capturedMessages[0]?.content).not.toContain("Durable Task Memory");
    expect(capturedMessages[0]?.content).not.toContain("hidden when off");
  });

  it("does not trust client-supplied scope memory as durable prompt context", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const [thread] = await db
      .insert(chatThreads)
      .values({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        title: "client memory ignored",
      })
      .returning({ id: chatThreads.id });

    let capturedMessages: ChatMsg[] = [];
    const provider: LLMProvider = {
      async embed() {
        return [0.1];
      },
      async *streamGenerate({ messages }) {
        capturedMessages = messages;
        yield { delta: "ok" };
      },
    };

    for await (const _chunk of runAgent({
      threadId: thread.id,
      userId: seed.userId,
      userMessage: {
        content: "클라이언트 메모리는 무시",
        scope: {
          manifest: { memoryPolicy: "auto", projectId: seed.projectId },
          memory: {
            sessionMemoryMd: "- untrusted client memory",
          },
        },
      },
      mode: "auto",
      provider,
      ragMode: "off",
    })) {
      // Drain the generator so the provider receives the assembled prompt.
    }

    expect(capturedMessages[0]?.content).not.toContain("Durable Task Memory");
    expect(capturedMessages[0]?.content).not.toContain(
      "untrusted client memory",
    );
  });
});
