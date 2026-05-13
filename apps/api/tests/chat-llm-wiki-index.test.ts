import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/lib/chat-llm";
import type { ChatMsg, LLMProvider } from "../src/lib/llm/provider";
import { seedWorkspace, type SeedResult } from "./helpers/seed";

describe("runChat project wiki index context", () => {
  let seed: SeedResult | undefined;

  afterEach(async () => {
    await seed?.cleanup();
    seed = undefined;
  });

  it("injects the live project wiki index into project-scoped chat", async () => {
    seed = await seedWorkspace({ role: "owner" });
    let capturedMessages: ChatMsg[] = [];
    const provider: LLMProvider = {
      async embed() {
        return [0.1, 0.2, 0.3];
      },
      async *streamGenerate({ messages }) {
        capturedMessages = messages;
        yield { delta: "확인했습니다." };
      },
    };

    for await (const _chunk of runChat({
      workspaceId: seed.workspaceId,
      userId: seed.userId,
      scope: {
        type: "project",
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "이 프로젝트 지식 구조를 요약해줘",
      provider,
    })) {
      // Drain the generator so the provider receives the full system prompt.
    }

    expect(capturedMessages[0]?.role).toBe("system");
    expect(capturedMessages[0]?.content).toContain("## Project Wiki Index");
    expect(capturedMessages[0]?.content).toContain(
      `Project: ${seed.projectId}`,
    );
    expect(capturedMessages[0]?.content).toContain("Orphan pages:");
  });

  it("injects durable memory context when the caller provides it", async () => {
    seed = await seedWorkspace({ role: "owner" });
    let capturedMessages: ChatMsg[] = [];
    const provider: LLMProvider = {
      async embed() {
        return [0.1, 0.2, 0.3];
      },
      async *streamGenerate({ messages }) {
        capturedMessages = messages;
        yield { delta: "확인했습니다." };
      },
    };

    for await (const _chunk of runChat({
      workspaceId: seed.workspaceId,
      userId: seed.userId,
      scope: { type: "workspace", workspaceId: seed.workspaceId },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "이어서 진행해줘",
      provider,
      memoryContext:
        "## Durable Task Memory\n\n### Session Memory\n- prior decision",
    })) {
      // Drain the generator so the provider receives the full system prompt.
    }

    expect(capturedMessages[0]?.role).toBe("system");
    expect(capturedMessages[0]?.content).toContain("## Durable Task Memory");
    expect(capturedMessages[0]?.content).toContain("- prior decision");
  });
});
