# Grounded Agent Verifier And Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic answer verification and an eval suite for date conflicts, missing grounding, unsupported citations, and retrieval quality regressions.

**Architecture:** Add a verifier that checks answer metadata before finalization, persist verifier/source-ledger metadata in chat message content, and add a local eval harness with golden cases. This plan uses deterministic checks first and leaves LLM-based claim support scoring for a later enhancement.

**Tech Stack:** TypeScript, Vitest, existing chat SSE pipeline, JSONL eval fixtures.

---

## File Structure

Create:

- `apps/api/src/lib/answer-verifier.ts`
- `apps/api/src/lib/chat-source-ledger.ts`
- `apps/api/tests/lib/answer-verifier.test.ts`
- `apps/api/tests/eval/grounded-chat-cases.jsonl`
- `apps/api/tests/eval/grounded-chat-eval.test.ts`

Modify:

- `apps/api/src/lib/chat-llm.ts`
- `apps/api/src/lib/agent-pipeline.ts`
- `apps/api/tests/lib/chat-llm.test.ts`

---

## Task 1: Deterministic Answer Verifier

**Files:**

- Create: `apps/api/src/lib/answer-verifier.ts`
- Test: `apps/api/tests/lib/answer-verifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/lib/answer-verifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyAnswer } from "../../src/lib/answer-verifier.js";

describe("verifyAnswer", () => {
  it("fails freshness answers without grounding", () => {
    const result = verifyAnswer({
      answer: "The current CEO is X.",
      policy: { externalGroundingRequired: true, workspaceEvidenceRequired: false },
      evidenceItems: [],
      serverNowIso: "2026-05-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "missing_external_grounding" }));
  });

  it("fails workspace answers without citations", () => {
    const result = verifyAnswer({
      answer: "Your project says alpha.",
      policy: { externalGroundingRequired: false, workspaceEvidenceRequired: true },
      evidenceItems: [],
      serverNowIso: "2026-05-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "missing_workspace_evidence" }));
  });

  it("fails answers that mention stale internal year against server time", () => {
    const result = verifyAnswer({
      answer: "As of 2024, I cannot know.",
      policy: { externalGroundingRequired: false, workspaceEvidenceRequired: false },
      evidenceItems: [],
      serverNowIso: "2026-05-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "stale_model_year" }));
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/answer-verifier.test.ts
```

Expected: FAIL because verifier does not exist.

- [ ] **Step 3: Implement verifier**

Create `apps/api/src/lib/answer-verifier.ts`:

```ts
export type VerificationFailureCode =
  | "missing_external_grounding"
  | "missing_workspace_evidence"
  | "stale_model_year";

export type VerificationFailure = {
  code: VerificationFailureCode;
  message: string;
};

export type VerifyAnswerInput = {
  answer: string;
  policy: {
    externalGroundingRequired: boolean;
    workspaceEvidenceRequired: boolean;
  };
  evidenceItems: unknown[];
  serverNowIso: string;
};

export type VerificationResult = {
  ok: boolean;
  failures: VerificationFailure[];
};

export function verifyAnswer(input: VerifyAnswerInput): VerificationResult {
  const failures: VerificationFailure[] = [];
  const serverYear = new Date(input.serverNowIso).getUTCFullYear();

  if (input.policy.externalGroundingRequired && input.evidenceItems.length === 0) {
    failures.push({
      code: "missing_external_grounding",
      message: "Current or recent factual answer has no grounding evidence.",
    });
  }

  if (input.policy.workspaceEvidenceRequired && input.evidenceItems.length === 0) {
    failures.push({
      code: "missing_workspace_evidence",
      message: "Workspace-grounded answer has no retrieved evidence.",
    });
  }

  if (serverYear >= 2026 && /\bas of 2024\b|\bknowledge cutoff\b/i.test(input.answer)) {
    failures.push({
      code: "stale_model_year",
      message: "Answer appears to rely on stale model-date framing despite server current time.",
    });
  }

  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run verifier test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/answer-verifier.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/answer-verifier.ts apps/api/tests/lib/answer-verifier.test.ts
git commit -m "feat(api): verify grounded chat answers"
```

---

## Task 2: Source Ledger Metadata

**Files:**

- Create: `apps/api/src/lib/chat-source-ledger.ts`
- Test: add to `apps/api/tests/lib/answer-verifier.test.ts` or create a separate test file.

- [ ] **Step 1: Add source ledger helper**

Create `apps/api/src/lib/chat-source-ledger.ts`:

```ts
import type { EvidenceBundle } from "./retrieval-candidates";

export type ChatSourceLedger = {
  generatedAt: string;
  evidenceCount: number;
  sources: Array<{
    citationIndex: number;
    noteId: string;
    chunkId: string | null;
    title: string;
    sourceType: string | null;
    sourceUrl: string | null;
  }>;
};

export function buildSourceLedger(input: {
  generatedAt: Date;
  evidenceBundle: EvidenceBundle;
}): ChatSourceLedger {
  return {
    generatedAt: input.generatedAt.toISOString(),
    evidenceCount: input.evidenceBundle.items.length,
    sources: input.evidenceBundle.items.map((item) => ({
      citationIndex: item.citationIndex,
      noteId: item.noteId,
      chunkId: item.chunkId,
      title: item.title,
      sourceType: item.sourceType,
      sourceUrl: item.sourceUrl,
    })),
  };
}
```

- [ ] **Step 2: Add focused test**

Create `apps/api/tests/lib/chat-source-ledger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSourceLedger } from "../../src/lib/chat-source-ledger.js";

describe("buildSourceLedger", () => {
  it("serializes evidence without source text", () => {
    const ledger = buildSourceLedger({
      generatedAt: new Date("2026-05-01T00:00:00.000Z"),
      evidenceBundle: {
        totalEstimatedTokens: 5,
        items: [
          {
            citationIndex: 1,
            noteId: "n1",
            chunkId: "c1",
            title: "Title",
            headingPath: "",
            snippet: "secret text should not be copied",
            sourceType: null,
            sourceUrl: null,
          },
        ],
      },
    });
    expect(JSON.stringify(ledger)).not.toContain("secret text should not be copied");
    expect(ledger.sources[0]).toMatchObject({ noteId: "n1", chunkId: "c1" });
  });
});
```

- [ ] **Step 3: Run source ledger test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-source-ledger.test.ts
```

Expected: PASS after helper exists.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/chat-source-ledger.ts apps/api/tests/lib/chat-source-ledger.test.ts
git commit -m "feat(api): record grounded chat source ledger"
```

---

## Task 3: Wire Verifier Into runChat

**Files:**

- Modify: `apps/api/src/lib/chat-llm.ts`
- Modify: `apps/api/tests/lib/chat-llm.test.ts`

- [ ] **Step 1: Add failing chat test**

In `apps/api/tests/lib/chat-llm.test.ts`, add:

```ts
it("emits verifier error when final answer uses stale model-date framing", async () => {
  retrievalMod.retrieve.mockResolvedValue([]);
  fakeProvider.streamGenerate.mockImplementation(async function* () {
    yield { delta: "As of 2024, I cannot know." };
    yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
  });

  const events = await collect(
    runChat({
      workspaceId: "ws-1",
      scope: { type: "workspace", workspaceId: "ws-1" },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "hi",
      provider: fakeProvider,
      mode: "balanced",
      now: new Date("2026-05-01T00:00:00.000Z"),
    }),
  );

  expect(events.some((e) => e.type === "error" && (e.payload as { code?: string }).code === "verification_failed")).toBe(true);
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: FAIL until verifier is called after full answer is buffered.

- [ ] **Step 3: Call verifier after generation**

In `apps/api/src/lib/chat-llm.ts`, import:

```ts
import { verifyAnswer } from "./answer-verifier";
```

After `const full = buffer.join("");`, add:

```ts
const verification = verifyAnswer({
  answer: full,
  policy: {
    externalGroundingRequired: policy.externalGroundingRequired,
    workspaceEvidenceRequired: policy.workspaceEvidenceRequired,
  },
  evidenceItems: citations,
  serverNowIso: (opts.now ?? new Date()).toISOString(),
});
if (!verification.ok) {
  yield {
    type: "error",
    payload: {
      code: "verification_failed",
      message: verification.failures.map((f) => f.message).join(" "),
    },
  };
}
```

Do not suppress already-streamed text in this phase. The follow-up UI can render the verification warning. The earlier freshness guard still prevents the most dangerous ungrounded current-answer path before generation.

- [ ] **Step 4: Run chat tests**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts tests/lib/answer-verifier.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-llm.ts apps/api/tests/lib/chat-llm.test.ts
git commit -m "feat(api): verify chat answers before completion"
```

---

## Task 4: Grounded Chat Eval Cases

**Files:**

- Create: `apps/api/tests/eval/grounded-chat-cases.jsonl`
- Create: `apps/api/tests/eval/grounded-chat-eval.test.ts`

- [ ] **Step 1: Create eval fixture**

Create `apps/api/tests/eval/grounded-chat-cases.jsonl`:

```jsonl
{"id":"date-current-001","userMessage":"현재는 2026년인데 오늘 최신 Gemini 3 변경점 알려줘","expectFreshnessRequired":true}
{"id":"workspace-cite-001","userMessage":"내 문서에서 Plan 11B 요약해줘","expectWorkspaceGrounded":true}
{"id":"ambiguous-001","userMessage":"해줘","expectAmbiguous":true}
{"id":"tool-action-001","userMessage":"이 내용을 새 노트로 저장해줘","expectToolAction":true}
{"id":"research-001","userMessage":"Gemini 3와 Claude 최신 모델을 근거 기반으로 비교 조사해줘","expectFreshnessRequired":true,"expectResearchDepth":true}
```

- [ ] **Step 2: Create eval test**

Create `apps/api/tests/eval/grounded-chat-eval.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyChatIntent } from "../../src/lib/chat-intent-router.js";

type Case = {
  id: string;
  userMessage: string;
  expectFreshnessRequired?: boolean;
  expectWorkspaceGrounded?: boolean;
  expectAmbiguous?: boolean;
  expectToolAction?: boolean;
  expectResearchDepth?: boolean;
};

const here = dirname(fileURLToPath(import.meta.url));
const cases = readFileSync(join(here, "grounded-chat-cases.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as Case);

describe("grounded chat eval cases", () => {
  for (const c of cases) {
    it(c.id, () => {
      const out = classifyChatIntent(c.userMessage);
      if (c.expectFreshnessRequired !== undefined) expect(out.freshnessRequired).toBe(c.expectFreshnessRequired);
      if (c.expectWorkspaceGrounded !== undefined) expect(out.workspaceGrounded).toBe(c.expectWorkspaceGrounded);
      if (c.expectAmbiguous !== undefined) expect(out.ambiguous).toBe(c.expectAmbiguous);
      if (c.expectToolAction !== undefined) expect(out.toolAction).toBe(c.expectToolAction);
      if (c.expectResearchDepth !== undefined) expect(out.researchDepth).toBe(c.expectResearchDepth);
    });
  }
});
```

- [ ] **Step 3: Run eval test**

```bash
pnpm --filter @opencairn/api test -- tests/eval/grounded-chat-eval.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/eval/grounded-chat-cases.jsonl apps/api/tests/eval/grounded-chat-eval.test.ts
git commit -m "test(api): add grounded chat eval cases"
```

---

## Final Verification

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/answer-verifier.test.ts tests/lib/chat-source-ledger.test.ts tests/lib/chat-llm.test.ts tests/eval/grounded-chat-eval.test.ts
pnpm --filter @opencairn/api build
git diff --check
```

Expected: all pass.

