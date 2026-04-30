# Grounded Agent Retrieval Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 1 of the Grounded Agent Retrieval Architecture: runtime time injection, Gemini 3 thinking policy, request intent routing, and source guardrails for the chat/agent paths.

**Architecture:** Add a small policy layer in `apps/api/src/lib` that runs before Gemini generation. The policy classifies freshness/workspace/tool/research intent, maps chat modes to Gemini 3 `thinkingLevel`, injects server time into the system prompt, and prevents freshness-sensitive answers when no grounding source is available. This plan deliberately does not add `note_chunks`, graph expansion, reranking, or verifier persistence; those are follow-up plans after the reliability policy is in place.

**Tech Stack:** TypeScript, Hono API, Vitest, `@google/genai`, Drizzle-backed chat history, existing `runChat()`/`runAgent()` streaming pipeline.

---

## Scope Boundaries

This plan implements the first shippable slice from
`docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md`.

Included:

- server current-time injection for chat and agent-panel generation;
- deterministic intent router for freshness/workspace/research/ambiguous/action signals;
- runtime policy that maps `auto | fast | balanced | accurate | research` to Gemini 3 thinking levels;
- Gemini provider support for `thinkingLevel` in `streamGenerate()`;
- freshness guard that blocks unsupported current/latest factual answers when no grounding source exists;
- focused API unit tests.

Deferred to separate plans:

- `note_chunks` schema and chunk embedding pipeline;
- graph expansion channel for RRF;
- reranking and `EvidenceBundle`;
- answer verifier with claim/citation mapping;
- persistent source ledger tables.

---

## File Structure

Create:

- `apps/api/src/lib/chat-runtime-context.ts`  
  Builds deterministic runtime context text from server time, locale, and timezone. Owns all current-time prompt wording.

- `apps/api/src/lib/chat-intent-router.ts`  
  Classifies user requests with conservative rules. No model call. Returns flags used by policy and guards.

- `apps/api/src/lib/chat-runtime-policy.ts`  
  Defines `ChatMode`, `ThinkingLevel`, `ChatRuntimePolicy`, and `selectChatRuntimePolicy()`.

- `apps/api/tests/lib/chat-runtime-context.test.ts`  
  Unit tests for stable time text and relative-date instruction.

- `apps/api/tests/lib/chat-intent-router.test.ts`  
  Unit tests for freshness/workspace/tool/research/ambiguous detection.

- `apps/api/tests/lib/chat-runtime-policy.test.ts`  
  Unit tests for mode-to-thinking-level mapping and auto policy.

Modify:

- `apps/api/src/lib/llm/gemini.ts`  
  Add `thinkingLevel` to `LLMProvider.streamGenerate()` options and forward it to `generateContentStream()`.

- `apps/api/tests/lib/llm-gemini.test.ts`  
  Assert Gemini 3 default model and `thinkingConfig.thinkingLevel`.

- `apps/api/src/lib/chat-llm.ts`  
  Add runtime context, intent policy, mode-aware thinking, and freshness guard.

- `apps/api/tests/lib/chat-llm.test.ts`  
  Assert runtime context injection, mode thinking propagation, and freshness guard behavior.

- `apps/api/src/lib/agent-pipeline.ts`  
  Import shared `ChatMode` type and pass selected mode through to `runChat()`.

- `apps/api/tests/agent-pipeline-history.test.ts`  
  Update assertions if the system message now includes runtime context.

- `apps/api/src/routes/chat.ts`  
  Pass `mode: "auto"` to `runChat()` for the legacy conversation route so it gets the same policy defaults.

---

## Task 1: Runtime Time Context

**Files:**

- Create: `apps/api/src/lib/chat-runtime-context.ts`
- Test: `apps/api/tests/lib/chat-runtime-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/lib/chat-runtime-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRuntimeContext } from "../../src/lib/chat-runtime-context.js";

describe("buildRuntimeContext", () => {
  it("injects exact server time, locale, and timezone", () => {
    const now = new Date("2026-04-30T14:30:00.000Z");
    const context = buildRuntimeContext({
      now,
      locale: "ko",
      timezone: "Asia/Seoul",
    });

    expect(context).toContain("Current server time: 2026-04-30T14:30:00.000Z");
    expect(context).toContain("User locale: ko");
    expect(context).toContain("User timezone: Asia/Seoul");
  });

  it("orders server time above model prior knowledge", () => {
    const context = buildRuntimeContext({
      now: new Date("2026-04-30T00:00:00.000Z"),
    });

    expect(context).toContain(
      "Server current time outranks model training data and internal date assumptions.",
    );
    expect(context).toContain(
      "Resolve relative dates such as today, yesterday, tomorrow, latest, and recent from the server time above.",
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-runtime-context.test.ts
```

Expected: FAIL because `chat-runtime-context.ts` does not exist.

- [ ] **Step 3: Implement runtime context builder**

Create `apps/api/src/lib/chat-runtime-context.ts`:

```ts
export type RuntimeContextInput = {
  now?: Date;
  locale?: string;
  timezone?: string;
};

export function buildRuntimeContext(input: RuntimeContextInput = {}): string {
  const now = input.now ?? new Date();
  const locale = input.locale ?? "ko";
  const timezone = input.timezone ?? "Asia/Seoul";

  return [
    "[Runtime Context]",
    `Current server time: ${now.toISOString()}`,
    `User locale: ${locale}`,
    `User timezone: ${timezone}`,
    "Server current time outranks model training data and internal date assumptions.",
    "Resolve relative dates such as today, yesterday, tomorrow, latest, and recent from the server time above.",
    "If a current or recent factual answer is needed, use verified grounding or state that the latest state could not be verified.",
  ].join("\n");
}
```

- [ ] **Step 4: Run the test again**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-runtime-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-runtime-context.ts apps/api/tests/lib/chat-runtime-context.test.ts
git commit -m "feat(api): add chat runtime time context"
```

---

## Task 2: Intent Router

**Files:**

- Create: `apps/api/src/lib/chat-intent-router.ts`
- Test: `apps/api/tests/lib/chat-intent-router.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/lib/chat-intent-router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyChatIntent } from "../../src/lib/chat-intent-router.js";

describe("classifyChatIntent", () => {
  it("detects freshness-required Korean and English requests", () => {
    expect(classifyChatIntent("오늘 Gemini 3 최신 변경점 알려줘")).toMatchObject({
      freshnessRequired: true,
    });
    expect(classifyChatIntent("Who is the current CEO of OpenAI?")).toMatchObject({
      freshnessRequired: true,
    });
  });

  it("detects workspace-grounded requests", () => {
    expect(classifyChatIntent("내 문서에서 Plan 11B가 뭐였는지 찾아줘")).toMatchObject({
      workspaceGrounded: true,
    });
    expect(classifyChatIntent("Summarize this workspace project")).toMatchObject({
      workspaceGrounded: true,
    });
  });

  it("detects tool action requests", () => {
    expect(classifyChatIntent("이 내용을 새 노트로 저장해줘")).toMatchObject({
      toolAction: true,
    });
    expect(classifyChatIntent("Import this GitHub repo")).toMatchObject({
      toolAction: true,
    });
  });

  it("detects research-depth requests", () => {
    expect(classifyChatIntent("Gemini 3와 Claude 최신 모델을 근거 기반으로 비교 조사해줘")).toMatchObject({
      researchDepth: true,
      freshnessRequired: true,
    });
  });

  it("detects ambiguous short requests", () => {
    expect(classifyChatIntent("해줘")).toMatchObject({
      ambiguous: true,
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-intent-router.test.ts
```

Expected: FAIL because `chat-intent-router.ts` does not exist.

- [ ] **Step 3: Implement deterministic router**

Create `apps/api/src/lib/chat-intent-router.ts`:

```ts
export type ChatIntent = {
  freshnessRequired: boolean;
  workspaceGrounded: boolean;
  toolAction: boolean;
  ambiguous: boolean;
  highRisk: boolean;
  researchDepth: boolean;
};

const FRESHNESS_RE =
  /(오늘|현재|최신|최근|방금|지금|뉴스|가격|주가|환율|일정|법|규정|릴리즈|버전|current|latest|recent|today|now|news|price|stock|exchange rate|schedule|law|regulation|release|version|CEO)/i;

const WORKSPACE_RE =
  /(내 문서|내 노트|이 문서|이 노트|이 프로젝트|워크스페이스|첨부|위키|workspace|project|note|document|attached|wiki)/i;

const TOOL_ACTION_RE =
  /(저장|생성|수정|삭제|보내|import|가져와|업로드|초대|메일|이메일|save|create|update|delete|send|import|upload|invite|email)/i;

const HIGH_RISK_RE =
  /(삭제|외부|메일|이메일|초대|공유|결제|대량|delete|external|email|invite|share|billing|payment|bulk)/i;

const RESEARCH_RE =
  /(조사|리서치|근거 기반|비교|분석|출처|논문|시장|due diligence|research|investigate|compare|analysis|sources|literature|market)/i;

export function classifyChatIntent(input: string): ChatIntent {
  const text = input.trim();
  const freshnessRequired = FRESHNESS_RE.test(text);
  const workspaceGrounded = WORKSPACE_RE.test(text);
  const toolAction = TOOL_ACTION_RE.test(text);
  const researchDepth = RESEARCH_RE.test(text);

  return {
    freshnessRequired,
    workspaceGrounded,
    toolAction,
    ambiguous: text.length <= 6 || /^(해줘|ㄱㄱ|go|do it)$/i.test(text),
    highRisk: HIGH_RISK_RE.test(text),
    researchDepth,
  };
}
```

- [ ] **Step 4: Run the test again**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-intent-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-intent-router.ts apps/api/tests/lib/chat-intent-router.test.ts
git commit -m "feat(api): classify chat grounding intent"
```

---

## Task 3: Runtime Policy And Mode Mapping

**Files:**

- Create: `apps/api/src/lib/chat-runtime-policy.ts`
- Test: `apps/api/tests/lib/chat-runtime-policy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/lib/chat-runtime-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectChatRuntimePolicy } from "../../src/lib/chat-runtime-policy.js";

describe("selectChatRuntimePolicy", () => {
  it("maps explicit modes to Gemini 3 thinking levels", () => {
    expect(selectChatRuntimePolicy({ mode: "fast", userMessage: "hi" }).thinkingLevel).toBe("low");
    expect(selectChatRuntimePolicy({ mode: "balanced", userMessage: "hi" }).thinkingLevel).toBe("medium");
    expect(selectChatRuntimePolicy({ mode: "accurate", userMessage: "hi" }).thinkingLevel).toBe("high");
    expect(selectChatRuntimePolicy({ mode: "research", userMessage: "hi" }).thinkingLevel).toBe("high");
  });

  it("auto escalates latest questions to high thinking and external grounding", () => {
    expect(selectChatRuntimePolicy({
      mode: "auto",
      userMessage: "오늘 Gemini 3 최신 뉴스 알려줘",
    })).toMatchObject({
      thinkingLevel: "high",
      externalGroundingRequired: true,
      verifierRequired: true,
    });
  });

  it("balanced workspace question requires workspace evidence", () => {
    expect(selectChatRuntimePolicy({
      mode: "balanced",
      userMessage: "내 문서에서 Plan 11B 요약해줘",
    })).toMatchObject({
      thinkingLevel: "medium",
      workspaceEvidenceRequired: true,
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-runtime-policy.test.ts
```

Expected: FAIL because `chat-runtime-policy.ts` does not exist.

- [ ] **Step 3: Implement policy selector**

Create `apps/api/src/lib/chat-runtime-policy.ts`:

```ts
import { classifyChatIntent, type ChatIntent } from "./chat-intent-router";

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";
export type ThinkingLevel = "low" | "medium" | "high";

export type ChatRuntimePolicy = {
  mode: ChatMode;
  intent: ChatIntent;
  thinkingLevel: ThinkingLevel;
  externalGroundingRequired: boolean;
  workspaceEvidenceRequired: boolean;
  verifierRequired: boolean;
};

export function selectChatRuntimePolicy(input: {
  mode: ChatMode;
  userMessage: string;
}): ChatRuntimePolicy {
  const intent = classifyChatIntent(input.userMessage);

  const explicitThinking: Record<Exclude<ChatMode, "auto">, ThinkingLevel> = {
    fast: "low",
    balanced: "medium",
    accurate: "high",
    research: "high",
  };

  const thinkingLevel =
    input.mode === "auto"
      ? intent.freshnessRequired || intent.researchDepth
        ? "high"
        : "medium"
      : explicitThinking[input.mode];

  const externalGroundingRequired =
    intent.freshnessRequired || input.mode === "research";

  const workspaceEvidenceRequired = intent.workspaceGrounded;

  return {
    mode: input.mode,
    intent,
    thinkingLevel,
    externalGroundingRequired,
    workspaceEvidenceRequired,
    verifierRequired:
      input.mode === "accurate" ||
      input.mode === "research" ||
      externalGroundingRequired ||
      workspaceEvidenceRequired,
  };
}
```

- [ ] **Step 4: Run the test again**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-runtime-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-runtime-policy.ts apps/api/tests/lib/chat-runtime-policy.test.ts
git commit -m "feat(api): map chat modes to runtime policy"
```

---

## Task 4: Gemini 3 Thinking Level In API Provider

**Files:**

- Modify: `apps/api/src/lib/llm/gemini.ts`
- Modify: `apps/api/tests/lib/llm-gemini.test.ts`

- [ ] **Step 1: Add failing provider tests**

In `apps/api/tests/lib/llm-gemini.test.ts`, update the stream tests.

Change the usage fallback expectation from `gemini-2.5-flash` to `gemini-3-flash-preview`:

```ts
expect(usages[0].usage).toEqual({
  tokensIn: 0,
  tokensOut: 0,
  model: "gemini-3-flash-preview",
});
```

Add this test inside `describe("GeminiProvider.streamGenerate", () => { ... })`:

```ts
it("forwards Gemini 3 thinkingLevel to generateContentStream", async () => {
  async function* one() {
    yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
  }
  fakeStream.mockReturnValue(one());

  const provider = getGeminiProvider();
  for await (const _ of provider.streamGenerate({
    messages: [{ role: "user", content: "x" }],
    thinkingLevel: "high",
  })) {
    // drain
  }

  expect(fakeStream).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "gemini-3-flash-preview",
      config: expect.objectContaining({
        thinkingConfig: { thinkingLevel: "high" },
      }),
    }),
  );
});
```

- [ ] **Step 2: Run the failing provider test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: FAIL because the default model is still `gemini-2.5-flash` and `thinkingLevel` is not accepted.

- [ ] **Step 3: Update provider types and config**

Modify `apps/api/src/lib/llm/gemini.ts`.

Change:

```ts
const CHAT_MODEL_DEFAULT = "gemini-2.5-flash";
```

to:

```ts
const CHAT_MODEL_DEFAULT = "gemini-3-flash-preview";
```

Add the type near `Usage`:

```ts
export type ThinkingLevel = "low" | "medium" | "high";
```

Add to `streamGenerate()` options:

```ts
thinkingLevel?: ThinkingLevel;
```

Change the destructure:

```ts
const { messages, signal, maxOutputTokens, temperature, thinkingLevel } = opts;
```

Add to the `config` object:

```ts
...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
```

The resulting config block should include:

```ts
config: {
  ...(systemMsgs.length > 0
    ? { systemInstruction: systemMsgs.map((m) => m.content).join("\n\n") }
    : {}),
  ...(maxOutputTokens ? { maxOutputTokens } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
  ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  ...(signal ? { abortSignal: signal } : {}),
},
```

- [ ] **Step 4: Run provider tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/llm/gemini.ts apps/api/tests/lib/llm-gemini.test.ts
git commit -m "feat(api): enable Gemini 3 thinking level for chat"
```

---

## Task 5: Wire Runtime Policy Into runChat

**Files:**

- Modify: `apps/api/src/lib/chat-llm.ts`
- Modify: `apps/api/tests/lib/chat-llm.test.ts`

- [ ] **Step 1: Add failing runChat tests**

In `apps/api/tests/lib/chat-llm.test.ts`, add these tests:

```ts
it("injects runtime current time into the system message", async () => {
  retrievalMod.retrieve.mockResolvedValue([]);
  let receivedMessages: unknown[] = [];
  fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
    messages: unknown[];
  }) {
    receivedMessages = opts.messages;
    yield { delta: "ok" };
    yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
  });

  await collect(
    runChat({
      workspaceId: "ws-1",
      scope: { type: "workspace", workspaceId: "ws-1" },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "hi",
      provider: fakeProvider,
      mode: "balanced",
      now: new Date("2026-04-30T00:00:00.000Z"),
    }),
  );

  expect((receivedMessages[0] as { content: string }).content).toContain(
    "Current server time: 2026-04-30T00:00:00.000Z",
  );
});

it("passes selected thinkingLevel to the provider", async () => {
  retrievalMod.retrieve.mockResolvedValue([]);
  let thinkingLevel: unknown;
  fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
    thinkingLevel?: unknown;
  }) {
    thinkingLevel = opts.thinkingLevel;
    yield { delta: "ok" };
    yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
  });

  await collect(
    runChat({
      workspaceId: "ws-1",
      scope: { type: "workspace", workspaceId: "ws-1" },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "정확하게 분석해줘",
      provider: fakeProvider,
      mode: "accurate",
    }),
  );

  expect(thinkingLevel).toBe("high");
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: FAIL because `runChat()` does not accept `mode` or `now`, and provider options do not include `thinkingLevel`.

- [ ] **Step 3: Update runChat signature and prompt assembly**

Modify imports in `apps/api/src/lib/chat-llm.ts`:

```ts
import { buildRuntimeContext } from "./chat-runtime-context";
import {
  selectChatRuntimePolicy,
  type ChatMode,
} from "./chat-runtime-policy";
```

Add to `runChat()` opts:

```ts
mode?: ChatMode;
now?: Date;
locale?: string;
timezone?: string;
```

After `const provider = ...`, add:

```ts
const policy = selectChatRuntimePolicy({
  mode: opts.mode ?? "auto",
  userMessage: opts.userMessage,
});
```

Build runtime context before the system message:

```ts
const runtimeContext = buildRuntimeContext({
  now: opts.now,
  locale: opts.locale,
  timezone: opts.timezone,
});
```

Change the system content from:

```ts
content: SYSTEM_PROMPT + ragBlock,
```

to:

```ts
content: [SYSTEM_PROMPT, runtimeContext, ragBlock].filter(Boolean).join("\n\n"),
```

Pass thinking level into the provider:

```ts
for await (const chunk of provider.streamGenerate({
  messages,
  signal: opts.signal,
  maxOutputTokens: envInt("CHAT_MAX_OUTPUT_TOKENS", 2048),
  thinkingLevel: policy.thinkingLevel,
})) {
```

- [ ] **Step 4: Run runChat tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-llm.ts apps/api/tests/lib/chat-llm.test.ts
git commit -m "feat(api): apply chat runtime policy"
```

---

## Task 6: Freshness Guard For Unsupported Latest Answers

**Files:**

- Modify: `apps/api/src/lib/chat-llm.ts`
- Modify: `apps/api/tests/lib/chat-llm.test.ts`

- [ ] **Step 1: Add failing guard tests**

Add this test to `apps/api/tests/lib/chat-llm.test.ts`:

```ts
it("blocks freshness-required answers when no grounding source is available", async () => {
  retrievalMod.retrieve.mockResolvedValue([]);
  fakeProvider.streamGenerate.mockImplementation(async function* () {
    yield { delta: "This should not be generated" };
    yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
  });

  const events = await collect(
    runChat({
      workspaceId: "ws-1",
      scope: { type: "workspace", workspaceId: "ws-1" },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "오늘 OpenAI CEO가 누구야?",
      provider: fakeProvider,
      mode: "auto",
      now: new Date("2026-04-30T00:00:00.000Z"),
    }),
  );

  expect(fakeProvider.streamGenerate).not.toHaveBeenCalled();
  const errorEvt = events.find((e) => e.type === "error");
  expect(errorEvt?.payload).toMatchObject({
    code: "grounding_required",
  });
  expect(events[events.length - 1].type).toBe("done");
});
```

- [ ] **Step 2: Run the failing guard test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: FAIL because `runChat()` still lets the model answer freshness-required questions without grounding.

- [ ] **Step 3: Implement freshness guard**

In `apps/api/src/lib/chat-llm.ts`, after citations are emitted and before building `messages`, add:

```ts
if (policy.externalGroundingRequired && citations.length === 0) {
  yield {
    type: "error",
    payload: {
      code: "grounding_required",
      message:
        "최신 정보가 필요한 질문이라 확인 가능한 근거가 필요합니다. 현재 연결된 검색 근거가 없어 답변을 생성하지 않았습니다.",
    },
  };
  return;
}
```

This is intentionally conservative for Phase 1. Follow-up plans can satisfy
`externalGroundingRequired` through Gemini Google Search or another source
ledger. Until that exists, the safe behavior is to refuse current factual
answers instead of hallucinating.

- [ ] **Step 4: Run runChat tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-llm.ts apps/api/tests/lib/chat-llm.test.ts
git commit -m "feat(api): guard ungrounded freshness answers"
```

---

## Task 7: Pass Chat Mode Through Agent Pipeline

**Files:**

- Modify: `apps/api/src/lib/agent-pipeline.ts`
- Modify: `apps/api/tests/agent-pipeline-history.test.ts`

- [ ] **Step 1: Add failing assertion to existing test**

In `apps/api/tests/agent-pipeline-history.test.ts`, update `buildCapturingProvider()` so it captures thinking level:

```ts
function buildCapturingProvider(): {
  provider: LLMProvider;
  captured: { messages: ChatMsg[] | null; thinkingLevel: unknown };
} {
  const captured: { messages: ChatMsg[] | null; thinkingLevel: unknown } = {
    messages: null,
    thinkingLevel: undefined,
  };
  const provider: LLMProvider = {
    embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
    streamGenerate: vi.fn().mockImplementation(async function* (args: {
      messages: ChatMsg[];
      thinkingLevel?: unknown;
    }) {
      captured.messages = args.messages;
      captured.thinkingLevel = args.thinkingLevel;
      yield { delta: "ok" };
      yield {
        usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" },
      };
    }) as unknown as LLMProvider["streamGenerate"],
  };
  return { provider, captured };
}
```

In the first test, after the final message assertions, add:

```ts
expect(captured.thinkingLevel).toBe("medium");
```

Add a second focused assertion in a new test or existing mode-specific test:

```ts
expect(captured.thinkingLevel).toBe("high");
```

when `runAgent({ mode: "accurate", ... })` is used.

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/agent-pipeline-history.test.ts
```

Expected: FAIL because `runAgent()` does not pass `mode` to `runChat()`.

- [ ] **Step 3: Import shared ChatMode and pass mode**

In `apps/api/src/lib/agent-pipeline.ts`, replace the local `ChatMode` export:

```ts
export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";
```

with:

```ts
import type { ChatMode } from "./chat-runtime-policy";
export type { ChatMode };
```

In the `runChat()` call, add:

```ts
mode: opts.mode,
```

The call should include:

```ts
for await (const chunk of runChat({
  workspaceId,
  scope: { type: "workspace", workspaceId },
  ragMode: opts.ragMode ?? "strict",
  chips: [],
  history,
  userMessage: opts.userMessage.content,
  signal: opts.signal,
  provider: opts.provider,
  mode: opts.mode,
})) {
```

- [ ] **Step 4: Run agent pipeline tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/agent-pipeline-history.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent-pipeline.ts apps/api/tests/agent-pipeline-history.test.ts
git commit -m "feat(api): pass chat mode into runtime policy"
```

---

## Task 8: Keep Legacy Chat Route On Policy Defaults

**Files:**

- Modify: `apps/api/src/routes/chat.ts`
- Test: existing chat route tests under `apps/api/tests/chat.test.ts` and `apps/api/tests/chat-real-llm.test.ts`

- [ ] **Step 1: Locate the `runChat()` call**

Run:

```bash
rg -n "runChat\\(" apps/api/src/routes/chat.ts
```

Expected: one or more call sites that construct `runChat({ ... })`.

- [ ] **Step 2: Add `mode: "auto"` to each route-level call**

At each `runChat({ ... })` call in `apps/api/src/routes/chat.ts`, add:

```ts
mode: "auto",
```

This keeps the legacy conversation route conservative without adding a new API
field in this plan.

- [ ] **Step 3: Run focused route tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/chat.test.ts tests/chat-real-llm.test.ts
```

Expected: PASS. If `chat-real-llm.test.ts` is configured to use fake provider injection, it should not hit the live Gemini API.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/chat.ts
git commit -m "feat(api): apply runtime policy to legacy chat route"
```

---

## Task 9: Focused Integration Verification

**Files:**

- No new files.

- [ ] **Step 1: Run all new and touched API tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-runtime-context.test.ts tests/lib/chat-intent-router.test.ts tests/lib/chat-runtime-policy.test.ts tests/lib/llm-gemini.test.ts tests/lib/chat-llm.test.ts tests/agent-pipeline-history.test.ts tests/chat.test.ts tests/chat-real-llm.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run API build**

Run:

```bash
pnpm --filter @opencairn/api build
```

Expected: PASS.

- [ ] **Step 3: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit any verification-only test fixture adjustments**

If tests required only fixture updates, commit them with:

```bash
git add apps/api/tests
git commit -m "test(api): align chat reliability fixtures"
```

If there are no additional changes, skip this commit.

---

## Task 10: Documentation And Follow-Up Boundaries

**Files:**

- Modify: `docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md`
- Create: no additional implementation doc unless behavior diverges from the spec.

- [ ] **Step 1: Update spec status note**

At the top of `docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md`, change:

```md
> Status: Draft for implementation planning
```

to:

```md
> Status: Phase 1 implementation planned
```

- [ ] **Step 2: Add a Phase 1 implementation note**

Under `## 18. Implementation Phases`, before `### Phase 1: Reliability Policy`, add:

```md
The first implementation plan is `docs/superpowers/plans/2026-04-30-grounded-agent-retrieval-reliability.md`.
It intentionally ships runtime reliability before chunk storage or graph expansion.
```

- [ ] **Step 3: Run doc diff check**

Run:

```bash
git diff --check -- docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md docs/superpowers/plans/2026-04-30-grounded-agent-retrieval-reliability.md
```

Expected: no output.

- [ ] **Step 4: Commit docs update**

```bash
git add docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md docs/superpowers/plans/2026-04-30-grounded-agent-retrieval-reliability.md
git commit -m "docs(docs): plan grounded chat reliability phase"
```

---

## Final Verification

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-runtime-context.test.ts tests/lib/chat-intent-router.test.ts tests/lib/chat-runtime-policy.test.ts tests/lib/llm-gemini.test.ts tests/lib/chat-llm.test.ts tests/agent-pipeline-history.test.ts tests/chat.test.ts tests/chat-real-llm.test.ts
pnpm --filter @opencairn/api build
git diff --check
```

Expected:

- all listed Vitest suites pass;
- API TypeScript build passes;
- `git diff --check` prints no output.

---

## Follow-Up Plan Boundaries

Write these as separate worktree plans after Phase 1 lands:

1. `grounded-agent-note-chunks`  
   Add `note_chunks`, indexing, backfill, and chunk-level citations.

2. `grounded-agent-graph-expansion`  
   Add bounded concept expansion as a retrieval candidate channel.

3. `grounded-agent-rerank-context`  
   Add candidate pool, reranking, source diversity, and `EvidenceBundle`.

4. `grounded-agent-verifier-evals`  
   Add deterministic verifier checks, source ledger metadata, and eval suite.

