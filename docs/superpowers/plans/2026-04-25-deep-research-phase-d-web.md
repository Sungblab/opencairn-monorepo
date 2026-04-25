# Deep Research Phase D — `/research` UI + research-meta block — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. After each task, run `opencairn:post-feature` to verify before moving on.

**Spec:** `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md` (§4.2 component matrix, §4.3 research-meta block, §5 data flow, §6 Phase D, §11 Open Questions)

**Phases A/B/C complete:**
- A — `packages/llm` Interactions wrapper (PRs #2/#4 merged at `8910563`)
- B — DB migration 0013 + Temporal workflow + 4 activities (PR #3 merged at `3b03154`)
- C — `apps/api/src/routes/research.ts` 8 endpoints + SSE polling stream + flag-gated mount (PRs #6/#7/#8/#9 merged at `a838524`)

**Goal:** Ship the web UI that drives Deep Research end-to-end — a `/research` hub for starting and listing runs, a per-run page that walks the user through plan review → progress → completion handoff, plus a Plate v49 `research-meta` block that the worker-generated note renders with collapsible plan/sources/cost metadata.

**Architecture:** The `(shell)/research` placeholder routes from App Shell Phase 1 are replaced with real Server-Component pages that fan out into client components. All API I/O flows through `api-client-research.ts` (TanStack Query) and a custom `useResearchStream` SSE hook that polls `/api/research/runs/:id/stream`. The new `research-meta` Plate block is a void custom element registered in `NoteEditor`'s `basePlugins`, with a Yjs roundtrip test pinning compatibility (spec §11 Open Question 3). The whole feature is gated behind `FEATURE_DEEP_RESEARCH` on both the route layer (`notFound()`) and the sidebar global-nav icon — matching the API-side gate in `apps/api/src/routes/research.ts:52`. Phase E (i18n polish, full E2E, prod release) is explicitly out of scope; ko/en parity is the only i18n bar Phase D must clear.

**Tech Stack:** Next.js 16 (App Router) · React Server Components · TanStack Query v5 · `next-intl` v3 · Plate v49 (`platejs/react`) · `@platejs/yjs` v49 · `@hocuspocus/provider` v3 · Tailwind v4 · Playwright · Vitest + jsdom (`.test.tsx`) / node (`.test.ts`)

**Branch:** `feat/deep-research-phase-d` off `main` (HEAD `2f7809b`).

---

## Constraints, gotchas, and non-negotiables

Before writing any code, internalize these — they are the things this plan is shaped around:

1. **Plate v49 antipatterns (`docs/contributing/llm-antipatterns.md` §8)**
   - Import from `platejs/react`, never `@platejs/core/react`.
   - No bundle exports — use individual plugins.
   - `Plugin.withComponent(Component)` is the only correct way to attach a renderer.
   - `<PlateContent>` is the body slot; `<Plate onValueChange>` not `onChange`.
   - Use `editor.tf.insertNodes(n, { select: true })` (plural).
   - Inline non-void elements **must** render `{children}` or Slate runtime throws.
   - Slash menu auto-registration is forbidden — meta blocks insert via worker only.

2. **Yjs compatibility (Open Question 3, spec §11)**
   - Plate's Yjs bridge serializes any custom node whose value is a JSON-safe object. Void elements with `children: [{ text: "" }]` and primitive-only own-fields are safe. Verified by an explicit `slateNodesToInsertDelta` → `yTextToSlateElement` roundtrip test in this plan (Task 11).
   - **Do not** put functions, `Date`, `undefined`, or sparse arrays inside the `research-meta` element.

3. **SSE on Next.js fetch boundary**
   - Browser-native `EventSource` cannot send credentials cross-origin in some setups but works for same-origin. The web app uses same-origin proxy (`/api/...`) so `EventSource(\`/api/research/runs/${id}/stream\`)` is enough — no auth header juggling.
   - The API stream is **polling-based** (2s tick) — there is no flush-on-write semantics on the server. The client must not assume eventual delivery faster than the poll interval; UI affordances (spinner) reflect that.

4. **Feature flag enforcement (spec §8)**
   - API is already 404'd via the router-level middleware in `apps/api/src/routes/research.ts:52`. Phase D adds:
     - `notFound()` in both `(shell)/research/page.tsx` and `(shell)/research/[runId]/page.tsx` when `FEATURE_DEEP_RESEARCH !== "true"`
     - Sidebar global-nav `<FlaskConical>` link conditionally hidden via a server-resolved prop
   - `FEATURE_MANAGED_DEEP_RESEARCH` off → the New Research dialog hides the Managed radio entirely (so submitting `billingPath: "managed"` is impossible from the UI). The API still rejects with 403 `managed_disabled` if anyone bypasses; the UI just avoids that path.

5. **BYOK key check is NOT in Phase D**
   - Spec §11 leaves BYOK registration UI for Phase E. Phase D submits the run optimistically; the worker fail-fast on invalid key surfaces as an `error` SSE event with `code: "invalid_byok_key"` which the run page renders with a "Settings" link to `/settings/ai`. That link will 404 in Phase D — acceptable per spec §2 non-goals.

6. **`runId` / `workflowId` invariant**
   - `workflowId === runId` (API-enforced at `apps/api/src/routes/research.ts:90`). The web layer never needs to know this — it just tracks `runId`.

7. **Tab integration is automatic**
   - The shell already routes `/w/[slug]/research` → `research_hub` tab kind and `/w/[slug]/research/:id` → `research_run` tab kind via `apps/web/src/lib/tab-url.ts:22-25` + `apps/web/src/hooks/use-url-tab-sync.ts`. Tab `mode` defaults to `"plate"` (`apps/web/src/lib/tab-factory.ts:14`), which means TabShell renders Next.js route children for these — exactly what Phase D wants. **Do not** add a viewer for research kinds.

8. **Internal API note creation already exists**
   - Worker → API note creation goes through `POST /api/internal/notes` (Phase B/C). Phase D **only consumes** the resulting note (renders it via the existing NoteEditor with the new research-meta plugin registered).

9. **i18n and copy rules (CLAUDE.md + `feedback_opencairn_copy.md`)**
   - 존댓말, 경쟁사 직접 언급 금지, 기술 스택 상세 최소화. "Deep Research" / "Deep Research Max" 모델명은 그대로 사용 OK (Google 공식 제품명).
   - All user-facing strings flow through `useTranslations("research")` — no literal strings (eslint-plugin `i18next/no-literal-string` is on).
   - ko parity is required at PR time. Skip en for now? **No.** The Phase D PR must pass `pnpm --filter @opencairn/web i18n:parity`, which compares ko↔en key sets. Translate en at write-time; Phase E will do a copy review pass.

---

## File map

### New files (web)

| Path | Role |
|---|---|
| `apps/web/messages/ko/research.json` | UI copy (ko) for hub, new-run dialog, plan review, progress, errors, research-meta block |
| `apps/web/messages/en/research.json` | UI copy (en) — must be parity-locked with ko |
| `apps/web/src/lib/api-client-research.ts` | Typed wrappers for all 8 `/api/research/*` endpoints + a TanStack Query key factory |
| `apps/web/src/lib/feature-flags.ts` | `isDeepResearchEnabled()` / `isManagedDeepResearchEnabled()` server helpers (read `process.env`) |
| `apps/web/src/hooks/use-research-stream.ts` | EventSource subscription with cleanup, dispatches typed `ResearchStreamEvent` |
| `apps/web/src/hooks/use-research-stream.test.ts` | Unit tests using a fake `EventSource` (jsdom polyfill) |
| `apps/web/src/components/editor/blocks/research-meta/research-meta-types.ts` | `ResearchMetaElement` interface (Plate value type) |
| `apps/web/src/components/editor/blocks/research-meta/research-meta-plugin.ts` | `createPlatePlugin` definition (void, no slash registration) |
| `apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.tsx` | Collapsible component with i18n labels |
| `apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx` | Render test + Yjs roundtrip test |
| `apps/web/src/components/research/NewResearchDialog.tsx` | Modal form (topic / model / projectId / billingPath) |
| `apps/web/src/components/research/NewResearchDialog.test.tsx` | Form validation + submit |
| `apps/web/src/components/research/ResearchHub.tsx` | Hub layout: list + "New" CTA + empty state |
| `apps/web/src/components/research/ResearchHub.test.tsx` | Hub render + list mock |
| `apps/web/src/components/research/ResearchPlanReview.tsx` | Markdown plan view + chat feedback / direct edit / approve |
| `apps/web/src/components/research/ResearchPlanReview.test.tsx` | State-by-state render |
| `apps/web/src/components/research/ResearchProgress.tsx` | Live artifact stream with thinking summaries collapsed |
| `apps/web/src/components/research/ResearchProgress.test.tsx` | Render w/ artifacts |
| `apps/web/src/components/research/ResearchRunView.tsx` | Orchestrator — switches by `run.status` |
| `apps/web/src/components/research/ResearchRunView.test.tsx` | Status-driven branching + done-redirect |
| `apps/web/playwright/research-smoke.spec.ts` | Smoke E2E — submit → plan ready (mocked) → approve → done |

### Modified files (web)

| Path | Change |
|---|---|
| `apps/web/src/i18n.ts` | Register `research` namespace alongside `appShell` etc. |
| `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/page.tsx` | Replace placeholder with `<ResearchHub>` + flag gate |
| `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/[runId]/page.tsx` | Replace placeholder with `<ResearchRunView>` + flag gate |
| `apps/web/src/components/sidebar/global-nav.tsx` | Hide research icon when flag off (server-prop driven) |
| `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/layout.tsx` | Pass `deepResearchEnabled` to `ShellProviders` → `GlobalNav` |
| `apps/web/src/components/shell/shell-providers.tsx` | Forward `deepResearchEnabled` prop to `AppShell` |
| `apps/web/src/components/shell/app-shell.tsx` | Forward to `ShellSidebar` → `GlobalNav` |
| `apps/web/src/components/sidebar/shell-sidebar.tsx` | Same prop drilling |
| `apps/web/messages/ko/app-shell.json` | `routes.research_hub.placeholder` / `routes.research_run.placeholder` no longer used; **delete keys** to avoid stale copy. (Parity script will fail until en is updated too.) |
| `apps/web/messages/en/app-shell.json` | Same delete |
| `apps/web/src/components/editor/NoteEditor.tsx` | Add `researchMetaPlugin` to `basePlugins` |

### Modified files (docs / index)

| Path | Change |
|---|---|
| `docs/contributing/plans-status.md` | Mark Plan "Deep Research Phase D" complete on merge |
| `CLAUDE.md` | Update Plans status block |

---

## Task list

Each task: bite-sized steps, exact paths, full test code, exact commit. Run `opencairn:post-feature` after every task before advancing.

### Task 0: Branch setup

**Files:** none

- [ ] **Step 1: Confirm clean main**

```bash
git status --short          # may show only docker-compose.yml (user WIP — leave alone)
git log -1 --oneline        # expect 2f7809b
```

- [ ] **Step 2: Create the branch**

```bash
git checkout -b feat/deep-research-phase-d
```

- [ ] **Step 3: Sanity smoke**

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web test --run -- --reporter=basic
```

Expected: green. If red, abort and surface to the user — Phase D should not start on a broken main.

---

### Task 1: i18n — `messages/ko/research.json`

**Files:**
- Create: `apps/web/messages/ko/research.json`

- [ ] **Step 1: Write the message catalog**

```json
{
  "hub": {
    "title": "Deep Research",
    "subtitle": "심층 조사를 자동으로 실행하고 결과를 노트로 받아보세요.",
    "new_button": "새 리서치 시작",
    "empty": "아직 시작한 리서치가 없습니다.",
    "list": {
      "topic": "주제",
      "model": "모델",
      "status": "상태",
      "started_at": "시작 시각",
      "completed_at": "완료 시각",
      "open": "열기"
    }
  },
  "model": {
    "deep_research": "Deep Research",
    "deep_research_max": "Deep Research Max",
    "cost_hint": {
      "deep_research": "한 회당 약 $1–3",
      "deep_research_max": "한 회당 약 $3–7"
    }
  },
  "billing_path": {
    "byok": "내 키 (BYOK)",
    "managed": "관리형 크레딧 (PAYG)",
    "byok_help": "직접 등록한 Gemini API 키로 호출합니다. 비용은 Google이 청구합니다.",
    "managed_help": "OpenCairn이 보유한 키로 호출하고, 잔액에서 차감됩니다."
  },
  "new_dialog": {
    "title": "새 리서치 시작",
    "topic_label": "주제",
    "topic_placeholder": "예: 2026년 한국 SaaS 시장 동향",
    "project_label": "결과 노트가 저장될 프로젝트",
    "model_label": "모델",
    "billing_label": "결제 경로",
    "submit": "시작하기",
    "cancel": "취소",
    "submitting": "시작 중…"
  },
  "plan_review": {
    "heading": "조사 계획 검토",
    "explainer": "조사 계획을 확인하고 필요하면 수정하세요. 승인하면 본격 조사가 시작됩니다.",
    "feedback_placeholder": "이 부분을 빼고 저 부분을 추가해주세요…",
    "feedback_send": "수정 요청",
    "edit_direct": "직접 편집",
    "edit_save": "수정 저장",
    "approve": "승인하고 시작",
    "approving": "시작 중…",
    "loading": "계획을 받아오는 중…",
    "iterating": "계획을 다시 작성 중…"
  },
  "progress": {
    "heading": "조사 진행 중",
    "subhead": "최대 약 한 시간이 걸릴 수 있습니다. 이 페이지를 닫아도 진행됩니다.",
    "thinking": "사고 중",
    "writing": "작성 중",
    "image_generating": "이미지 생성 중",
    "no_artifacts_yet": "곧 결과 조각이 나타납니다.",
    "cancel": "취소",
    "cancelling": "취소 중…"
  },
  "completed": {
    "heading": "조사 완료",
    "open_note": "노트 열기",
    "redirecting": "노트로 이동 중…"
  },
  "status": {
    "planning": "계획 작성 중",
    "awaiting_approval": "승인 대기",
    "researching": "조사 중",
    "completed": "완료됨",
    "failed": "실패",
    "cancelled": "취소됨"
  },
  "error": {
    "invalid_byok": "Gemini API 키가 유효하지 않습니다.",
    "invalid_byok_cta": "키 설정으로 이동",
    "quota_exceeded": "Google 계정 쿼터를 초과했습니다.",
    "managed_credits_short": "관리형 경로를 사용하려면 크레딧 충전이 필요합니다.",
    "managed_credits_cta": "결제로 이동",
    "managed_disabled": "관리형 경로는 아직 준비 중입니다.",
    "generic_failed": "조사가 실패했습니다.",
    "concurrent_write": "동시 수정이 감지되었어요. 잠시 후 다시 시도해주세요.",
    "feature_disabled": "Deep Research가 현재 비활성화되어 있습니다."
  },
  "meta": {
    "label": "Deep Research 메타데이터",
    "expand": "펼치기",
    "collapse": "접기",
    "model_label": "모델",
    "plan": "조사 계획",
    "sources": "출처",
    "thought_summaries": "사고 요약",
    "cost_approx": "추정 비용",
    "cost_disclaimer": "추정치이며 실제 청구는 결제 경로에 따라 다릅니다."
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/messages/ko/research.json
git commit -m "feat(web): add ko research.json i18n catalog"
```

---

### Task 2: i18n — `messages/en/research.json` + parity

**Files:**
- Create: `apps/web/messages/en/research.json`

- [ ] **Step 1: Write the en catalog (parity-matched to ko)**

```json
{
  "hub": {
    "title": "Deep Research",
    "subtitle": "Run automated deep-dive research and receive the result as a note.",
    "new_button": "New research",
    "empty": "You have no research runs yet.",
    "list": {
      "topic": "Topic",
      "model": "Model",
      "status": "Status",
      "started_at": "Started",
      "completed_at": "Completed",
      "open": "Open"
    }
  },
  "model": {
    "deep_research": "Deep Research",
    "deep_research_max": "Deep Research Max",
    "cost_hint": {
      "deep_research": "approx. $1–3 per run",
      "deep_research_max": "approx. $3–7 per run"
    }
  },
  "billing_path": {
    "byok": "Bring your own key (BYOK)",
    "managed": "Managed credits (PAYG)",
    "byok_help": "Calls Google with the key you registered. Google bills you directly.",
    "managed_help": "OpenCairn calls Google with its key and deducts from your credit balance."
  },
  "new_dialog": {
    "title": "Start a new research",
    "topic_label": "Topic",
    "topic_placeholder": "e.g. Korean SaaS market trends in 2026",
    "project_label": "Project to save the resulting note in",
    "model_label": "Model",
    "billing_label": "Billing path",
    "submit": "Start",
    "cancel": "Cancel",
    "submitting": "Starting…"
  },
  "plan_review": {
    "heading": "Review the research plan",
    "explainer": "Check the plan and tweak it if needed. Approving kicks off the deep dive.",
    "feedback_placeholder": "Remove this part and add that part…",
    "feedback_send": "Send feedback",
    "edit_direct": "Edit directly",
    "edit_save": "Save edits",
    "approve": "Approve and start",
    "approving": "Starting…",
    "loading": "Fetching the plan…",
    "iterating": "Re-writing the plan…"
  },
  "progress": {
    "heading": "Research in progress",
    "subhead": "This can take up to about an hour. You can close this page — it keeps running.",
    "thinking": "Thinking",
    "writing": "Writing",
    "image_generating": "Generating image",
    "no_artifacts_yet": "Result fragments will appear shortly.",
    "cancel": "Cancel",
    "cancelling": "Cancelling…"
  },
  "completed": {
    "heading": "Research complete",
    "open_note": "Open the note",
    "redirecting": "Taking you to the note…"
  },
  "status": {
    "planning": "Planning",
    "awaiting_approval": "Awaiting approval",
    "researching": "Researching",
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled"
  },
  "error": {
    "invalid_byok": "Your Gemini API key is invalid.",
    "invalid_byok_cta": "Go to key settings",
    "quota_exceeded": "Your Google quota has been exceeded.",
    "managed_credits_short": "Managed mode requires a credit top-up.",
    "managed_credits_cta": "Go to billing",
    "managed_disabled": "Managed mode is not yet available.",
    "generic_failed": "The research failed.",
    "concurrent_write": "A concurrent edit was detected. Please retry in a moment.",
    "feature_disabled": "Deep Research is currently disabled."
  },
  "meta": {
    "label": "Deep Research metadata",
    "expand": "Expand",
    "collapse": "Collapse",
    "model_label": "Model",
    "plan": "Plan",
    "sources": "Sources",
    "thought_summaries": "Thought summaries",
    "cost_approx": "Estimated cost",
    "cost_disclaimer": "This is an estimate; actual billing depends on the billing path."
  }
}
```

- [ ] **Step 2: Run parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: `research.json parity OK (N keys)` for some N. If not, iterate until the key sets match.

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/en/research.json
git commit -m "feat(web): add en research.json i18n catalog (parity)"
```

---

### Task 3: Register `research` namespace in `i18n.ts`

**Files:**
- Modify: `apps/web/src/i18n.ts`

- [ ] **Step 1: Add the destructured slot + import**

Edit `apps/web/src/i18n.ts`:

Find the destructure list (`const [common, landing, ..., appShell] = await Promise.all([...]);`) and add `research` at the end:

```typescript
  const [
    common,
    landing,
    dashboard,
    sidebar,
    app,
    editor,
    auth,
    collab,
    importMessages,
    onboarding,
    appShell,
    research,
  ] = await Promise.all([
    import(`../messages/${locale}/common.json`).then((m) => m.default),
    import(`../messages/${locale}/landing.json`).then((m) => m.default),
    import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
    import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
    import(`../messages/${locale}/app.json`).then((m) => m.default),
    import(`../messages/${locale}/editor.json`).then((m) => m.default),
    import(`../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../messages/${locale}/collab.json`).then((m) => m.default),
    import(`../messages/${locale}/import.json`).then((m) => m.default),
    import(`../messages/${locale}/onboarding.json`).then((m) => m.default),
    import(`../messages/${locale}/app-shell.json`).then((m) => m.default),
    import(`../messages/${locale}/research.json`).then((m) => m.default),
  ]);
```

And add to the returned `messages` object:

```typescript
    messages: {
      common,
      landing,
      dashboard,
      sidebar,
      app,
      editor,
      auth,
      collab,
      import: importMessages,
      onboarding,
      appShell,
      research,
    },
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @opencairn/web typecheck
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/i18n.ts
git commit -m "feat(web): register research i18n namespace in next-intl loader"
```

---

### Task 4: Web feature flag helper

**Files:**
- Create: `apps/web/src/lib/feature-flags.ts`
- Test: `apps/web/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/feature-flags.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDeepResearchEnabled,
  isManagedDeepResearchEnabled,
} from "./feature-flags";

describe("feature-flags", () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
  });
  afterEach(() => {
    process.env = saved;
  });

  it("isDeepResearchEnabled defaults false", () => {
    delete process.env.FEATURE_DEEP_RESEARCH;
    expect(isDeepResearchEnabled()).toBe(false);
  });

  it("isDeepResearchEnabled returns true for 'true' (case-insensitive)", () => {
    process.env.FEATURE_DEEP_RESEARCH = "True";
    expect(isDeepResearchEnabled()).toBe(true);
  });

  it("isDeepResearchEnabled is false for any non-true value", () => {
    process.env.FEATURE_DEEP_RESEARCH = "1";
    expect(isDeepResearchEnabled()).toBe(false);
  });

  it("isManagedDeepResearchEnabled defaults false", () => {
    delete process.env.FEATURE_MANAGED_DEEP_RESEARCH;
    expect(isManagedDeepResearchEnabled()).toBe(false);
  });

  it("isManagedDeepResearchEnabled true for 'true'", () => {
    process.env.FEATURE_MANAGED_DEEP_RESEARCH = "true";
    expect(isManagedDeepResearchEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/lib/feature-flags.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/feature-flags.ts`:

```typescript
// Mirrors apps/api/src/routes/research.ts:37-46 — case-insensitive 'true'
// only. These are read on the SERVER (route page or layout). Don't import
// from a "use client" component; thread the result down via props instead.

export function isDeepResearchEnabled(): boolean {
  return (
    (process.env.FEATURE_DEEP_RESEARCH ?? "false").toLowerCase() === "true"
  );
}

export function isManagedDeepResearchEnabled(): boolean {
  return (
    (process.env.FEATURE_MANAGED_DEEP_RESEARCH ?? "false").toLowerCase() ===
    "true"
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/lib/feature-flags.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/feature-flags.ts apps/web/src/lib/feature-flags.test.ts
git commit -m "feat(web): add feature flag helpers for FEATURE_DEEP_RESEARCH"
```

---

### Task 5: Research API client

**Files:**
- Create: `apps/web/src/lib/api-client-research.ts`
- Test: `apps/web/src/lib/api-client-research.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/api-client-research.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  researchApi,
  researchKeys,
} from "./api-client-research";

describe("researchApi", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("createRun POSTs to /api/research/runs", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r1" }), { status: 201 }),
    );
    const res = await researchApi.createRun({
      workspaceId: "w1",
      projectId: "p1",
      topic: "x",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
    });
    expect(res).toEqual({ runId: "r1" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/research\/runs$/);
    expect(init?.method).toBe("POST");
  });

  it("listRuns GETs with workspaceId query param", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ runs: [] }), { status: 200 }),
    );
    await researchApi.listRuns("w1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/research\/runs\?workspaceId=w1/);
  });

  it("getRun GETs /runs/:id", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "r1" }), { status: 200 }),
    );
    await researchApi.getRun("r1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/research\/runs\/r1$/);
  });

  it("addTurn POSTs feedback", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ turnId: "t" }), { status: 202 }),
    );
    await researchApi.addTurn("r1", "feedback");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/turns$/);
    expect(JSON.parse(init?.body as string)).toEqual({ feedback: "feedback" });
  });

  it("updatePlan PATCHes /runs/:id/plan", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ turnId: "t" }), { status: 200 }),
    );
    await researchApi.updatePlan("r1", "edited");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/plan$/);
    expect(init?.method).toBe("PATCH");
  });

  it("approve POSTs to /runs/:id/approve", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ approved: true }), { status: 202 }),
    );
    await researchApi.approve("r1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/approve$/);
  });

  it("cancel POSTs to /runs/:id/cancel", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ cancelled: true }), { status: 202 }),
    );
    await researchApi.cancel("r1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/cancel$/);
  });

  it("researchKeys produces deterministic query keys", () => {
    expect(researchKeys.list("w1")).toEqual(["research", "list", "w1"]);
    expect(researchKeys.detail("r1")).toEqual(["research", "detail", "r1"]);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/lib/api-client-research.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/api-client-research.ts`:

```typescript
import { apiClient } from "./api-client";
import type {
  CreateResearchRunInput,
  ResearchRunDetail,
  ResearchRunSummary,
  ResearchApproveResponse,
  ResearchCancelResponse,
} from "@opencairn/shared";

export const researchApi = {
  createRun: (body: CreateResearchRunInput) =>
    apiClient<{ runId: string }>(`/research/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listRuns: (workspaceId: string, limit = 50) =>
    apiClient<{ runs: ResearchRunSummary[] }>(
      `/research/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=${limit}`,
    ),
  getRun: (id: string) =>
    apiClient<ResearchRunDetail>(`/research/runs/${id}`),
  addTurn: (id: string, feedback: string) =>
    apiClient<{ turnId: string }>(`/research/runs/${id}/turns`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    }),
  updatePlan: (id: string, editedText: string) =>
    apiClient<{ turnId: string }>(`/research/runs/${id}/plan`, {
      method: "PATCH",
      body: JSON.stringify({ editedText }),
    }),
  approve: (id: string, finalPlanText?: string) =>
    apiClient<ResearchApproveResponse>(`/research/runs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(finalPlanText ? { finalPlanText } : {}),
    }),
  cancel: (id: string) =>
    apiClient<ResearchCancelResponse>(`/research/runs/${id}/cancel`, {
      method: "POST",
    }),
};

export const researchKeys = {
  all: ["research"] as const,
  list: (workspaceId: string) => ["research", "list", workspaceId] as const,
  detail: (runId: string) => ["research", "detail", runId] as const,
};
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/lib/api-client-research.test.ts
```

Expected: 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client-research.ts apps/web/src/lib/api-client-research.test.ts
git commit -m "feat(web): add typed research API client + query key factory"
```

---

### Task 6: SSE hook `useResearchStream`

**Files:**
- Create: `apps/web/src/hooks/use-research-stream.ts`
- Test: `apps/web/src/hooks/use-research-stream.test.tsx` (jsdom; .tsx required for `renderHook`)

- [ ] **Step 1: Write the failing test**

`apps/web/src/hooks/use-research-stream.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResearchStream } from "./use-research-stream";
import type { ResearchStreamEvent } from "@opencairn/shared";

// Minimal EventSource fake — just enough surface for the hook's contract.
class FakeES {
  static lastInstance: FakeES | null = null;
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeES.lastInstance = this;
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}

describe("useResearchStream", () => {
  let originalES: typeof EventSource | undefined;
  beforeEach(() => {
    originalES = (globalThis as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      FakeES as unknown as typeof EventSource;
  });
  afterEach(() => {
    if (originalES) {
      (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
        originalES;
    }
  });

  it("opens an EventSource targeting /api/research/runs/:id/stream", () => {
    renderHook(() => useResearchStream("r1", () => {}));
    expect(FakeES.lastInstance?.url).toMatch(
      /\/api\/research\/runs\/r1\/stream$/,
    );
  });

  it("dispatches typed events", () => {
    const events: ResearchStreamEvent[] = [];
    renderHook(() =>
      useResearchStream("r1", (ev) => events.push(ev)),
    );
    act(() => {
      FakeES.lastInstance?.emit({ type: "status", status: "researching" });
    });
    expect(events).toEqual([{ type: "status", status: "researching" }]);
  });

  it("ignores malformed JSON without throwing", () => {
    renderHook(() => useResearchStream("r1", () => {}));
    expect(() => {
      FakeES.lastInstance?.onmessage?.(
        new MessageEvent("message", { data: "{not json" }),
      );
    }).not.toThrow();
  });

  it("closes on unmount", () => {
    const { unmount } = renderHook(() =>
      useResearchStream("r1", () => {}),
    );
    expect(FakeES.lastInstance?.closed).toBe(false);
    unmount();
    expect(FakeES.lastInstance?.closed).toBe(true);
  });

  it("does nothing when runId is null", () => {
    FakeES.lastInstance = null;
    renderHook(() => useResearchStream(null, () => {}));
    expect(FakeES.lastInstance).toBeNull();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/hooks/use-research-stream.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/hooks/use-research-stream.ts`:

```typescript
"use client";
import { useEffect, useRef } from "react";
import type { ResearchStreamEvent } from "@opencairn/shared";

// Subscribes to /api/research/runs/:id/stream for the lifetime of the hook.
// `onEvent` is called from the EventSource message handler — keep it light;
// the API ticks at ~2s and a heavy handler will lag the UI. Returning a
// closure (rather than state) keeps re-renders out of the wire path.
//
// Re-creates the EventSource on runId change. SSR-safe: short-circuits when
// `EventSource` is undefined (no-op on server pre-hydration).
export function useResearchStream(
  runId: string | null,
  onEvent: (ev: ResearchStreamEvent) => void,
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!runId) return;
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/research/runs/${runId}/stream`);
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as ResearchStreamEvent;
        handlerRef.current(parsed);
      } catch {
        // Server is supposed to emit valid JSON. Swallow rather than crash
        // the UI — the polling tick will resync state on the next event.
      }
    };
    return () => {
      es.close();
    };
  }, [runId]);
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/hooks/use-research-stream.test.tsx
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-research-stream.ts apps/web/src/hooks/use-research-stream.test.tsx
git commit -m "feat(web): add useResearchStream SSE hook"
```

---

### Task 7: research-meta types

**Files:**
- Create: `apps/web/src/components/editor/blocks/research-meta/research-meta-types.ts`

- [ ] **Step 1: Write types**

```typescript
import type { TElement } from "platejs";

// Plate v49 void custom element. Worker-generated. Slate runtime requires
// `children: [{ text: "" }]` for void blocks.
//
// All own-fields are JSON-safe primitives or arrays of primitive-only
// objects so Yjs can serialize the node verbatim through the Plate ↔ Yjs
// bridge (see ResearchMetaElement.test.tsx for the roundtrip pin).

export const RESEARCH_META_KEY = "research-meta" as const;

export type ResearchMetaModel =
  | "deep-research-preview-04-2026"
  | "deep-research-max-preview-04-2026";

export interface ResearchMetaSource {
  title: string;
  url: string;
  seq: number;
}

export interface ResearchMetaElement extends TElement {
  type: typeof RESEARCH_META_KEY;
  runId: string;
  model: ResearchMetaModel;
  plan: string;
  sources: ResearchMetaSource[];
  thoughtSummaries?: string[];
  costUsdCents?: number;
  children: [{ text: "" }];
}

export function isResearchMetaElement(
  node: unknown,
): node is ResearchMetaElement {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === RESEARCH_META_KEY
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @opencairn/web typecheck
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/blocks/research-meta/research-meta-types.ts
git commit -m "feat(web): add research-meta Plate element types"
```

---

### Task 8: research-meta plugin

**Files:**
- Create: `apps/web/src/components/editor/blocks/research-meta/research-meta-plugin.ts`

- [ ] **Step 1: Implement plugin**

```typescript
import { createPlatePlugin } from "platejs/react";
import { RESEARCH_META_KEY } from "./research-meta-types";
import { ResearchMetaElement } from "./ResearchMetaElement";

// Void block — content is read-only metadata. Worker is the only producer
// (persist_report_activity inserts this as the first node of the report
// note). Intentionally NOT registered with the slash menu: users cannot
// insert it manually.
//
// `withComponent` is the v49-correct way to attach a renderer (see
// docs/contributing/llm-antipatterns.md §8). Do NOT use `kit({ components })`
// or `editor.tf.toggleBlock` — those APIs do not exist in v49.
export const researchMetaPlugin = createPlatePlugin({
  key: RESEARCH_META_KEY,
  node: {
    type: RESEARCH_META_KEY,
    isElement: true,
    isVoid: true,
  },
}).withComponent(ResearchMetaElement);
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @opencairn/web typecheck
```

Expected: green (the test for the component is in Task 9).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/blocks/research-meta/research-meta-plugin.ts
git commit -m "feat(web): add research-meta Plate v49 plugin (void, withComponent)"
```

---

### Task 9: research-meta component

**Files:**
- Create: `apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.tsx`
- Test: `apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx`

- [ ] **Step 1: Write the failing render test**

`ResearchMetaElement.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ResearchMetaElement } from "./ResearchMetaElement";
import type { ResearchMetaElement as ResearchMetaElementType } from "./research-meta-types";

// Use real next-intl messages (not a mock) so the test catches missing keys.
import koMessages from "../../../../../messages/ko/research.json";

const baseElement: ResearchMetaElementType = {
  type: "research-meta",
  runId: "r1",
  model: "deep-research-preview-04-2026",
  plan: "1) Search\n2) Synthesize",
  sources: [
    { title: "OpenAI", url: "https://openai.com", seq: 0 },
    { title: "Google", url: "https://google.com", seq: 1 },
  ],
  thoughtSummaries: ["Reasoning A", "Reasoning B"],
  costUsdCents: 230,
  children: [{ text: "" }],
};

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
      {node}
    </NextIntlClientProvider>
  );
}

// Plate provides `attributes` / `nodeProps` props at runtime. For unit
// rendering we hand-roll a minimal subset — Plate's PlateElementProps
// expects more, so cast at the test boundary.
function renderMeta(
  el: ResearchMetaElementType = baseElement,
) {
  return render(
    withIntl(
      <ResearchMetaElement
        attributes={{ "data-slate-node": "element", ref: vi.fn() } as never}
        element={el}
      >
        {""}
      </ResearchMetaElement>,
    ),
  );
}

describe("ResearchMetaElement", () => {
  it("renders the label", () => {
    renderMeta();
    expect(screen.getByText("Deep Research 메타데이터")).toBeInTheDocument();
  });

  it("starts collapsed (plan / sources hidden)", () => {
    renderMeta();
    expect(screen.queryByText("1) Search")).not.toBeInTheDocument();
  });

  it("expands on toggle click", () => {
    renderMeta();
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    expect(screen.getByText(/1\) Search/)).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("renders cost when present", () => {
    renderMeta();
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    // 230 cents -> $2.30
    expect(screen.getByText(/\$2\.30/)).toBeInTheDocument();
  });

  it("omits cost block when undefined", () => {
    renderMeta({ ...baseElement, costUsdCents: undefined });
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    expect(screen.queryByText(/추정 비용/)).not.toBeInTheDocument();
  });

  it("omits thought summaries when missing", () => {
    renderMeta({ ...baseElement, thoughtSummaries: undefined });
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    expect(screen.queryByText(/사고 요약/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`ResearchMetaElement.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PlateElement, type PlateElementProps } from "platejs/react";
import {
  isResearchMetaElement,
  type ResearchMetaElement as ResearchMetaElementType,
  type ResearchMetaModel,
} from "./research-meta-types";

const MODEL_LABEL: Record<ResearchMetaModel, string> = {
  "deep-research-preview-04-2026": "Deep Research",
  "deep-research-max-preview-04-2026": "Deep Research Max",
};

function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Void Plate element — never editable, always read-only metadata. Renders
// `children` once after the body so Plate's selection / void-block contract
// stays honored (see Plate v49 antipatterns: voids still need to render
// their phantom child wrapper).
export function ResearchMetaElement(
  props: PlateElementProps,
) {
  const t = useTranslations("research.meta");
  const [open, setOpen] = useState(false);
  const element = props.element;

  if (!isResearchMetaElement(element)) {
    // Defensive: if this renderer somehow gets a foreign node type it must
    // not crash the editor. Render an empty element so Plate's void contract
    // (children rendered once) holds.
    return <PlateElement {...props}>{props.children}</PlateElement>;
  }

  const meta: ResearchMetaElementType = element;
  const hasCost = typeof meta.costUsdCents === "number";
  const hasThoughts =
    Array.isArray(meta.thoughtSummaries) &&
    meta.thoughtSummaries.length > 0;

  return (
    <PlateElement
      {...props}
      contentEditable={false}
      className="my-3 rounded border border-border bg-muted/30 p-3 text-sm"
    >
      <div data-testid="research-meta-block">
        <div className="flex items-center justify-between">
          <span className="font-medium">{t("label")}</span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            {open ? t("collapse") : t("expand")}
          </button>
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {t("model_label")}: {MODEL_LABEL[meta.model]}
        </div>
        {open && (
          <div className="mt-2 space-y-3">
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide">
                {t("plan")}
              </h4>
              <pre className="whitespace-pre-wrap text-xs">{meta.plan}</pre>
            </section>
            {meta.sources.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide">
                  {t("sources")}
                </h4>
                <ol className="ml-4 list-decimal text-xs">
                  {meta.sources.map((s) => (
                    <li key={s.seq}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {hasThoughts && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide">
                  {t("thought_summaries")}
                </h4>
                <ul className="ml-4 list-disc text-xs">
                  {meta.thoughtSummaries!.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
            {hasCost && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide">
                  {t("cost_approx")}
                </h4>
                <p className="text-xs">
                  {formatUsdCents(meta.costUsdCents!)}
                  <span className="text-muted-foreground ml-2">
                    {t("cost_disclaimer")}
                  </span>
                </p>
              </section>
            )}
          </div>
        )}
        {props.children}
      </div>
    </PlateElement>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx
```

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/blocks/research-meta
git commit -m "feat(web): add research-meta collapsible Plate component"
```

---

### Task 10: research-meta Yjs roundtrip pin (Open Question 3)

**Files:**
- Modify: `apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx` (append a new `describe` block)

> Why this matters: spec §11 Open Question 3 asks "is `research-meta` Plate-Yjs-safe?". Plate's Yjs bridge round-trips any JSON-safe element. We pin that contract here so future schema changes (e.g. adding a `Date` field — which would break it) trip the test rather than corrupting prod docs.

- [ ] **Step 1: Append the Yjs roundtrip test**

Add to `ResearchMetaElement.test.tsx`:

```typescript
import * as Y from "yjs";
import {
  slateNodesToInsertDelta,
  yTextToSlateElement,
} from "@slate-yjs/core";

describe("ResearchMetaElement — Yjs serialization", () => {
  // Same canonical key apps/hocuspocus and the Plate Yjs plugin agree on.
  // See docs/contributing/llm-antipatterns.md §11.
  const ROOT_KEY = "content";

  it("survives a round-trip through Yjs", () => {
    const original: ResearchMetaElementType = {
      type: "research-meta",
      runId: "r1",
      model: "deep-research-max-preview-04-2026",
      plan: "Step 1\nStep 2",
      sources: [
        { title: "S1", url: "https://example.com/1", seq: 0 },
        { title: "S2", url: "https://example.com/2", seq: 1 },
      ],
      thoughtSummaries: ["t1", "t2"],
      costUsdCents: 500,
      children: [{ text: "" }],
    };

    // Wrap in a paragraph + meta block — y-slate root must contain at least
    // one block; the Plate ↔ Yjs bridge then serializes each child as a
    // sub-XmlText.
    const slateRoot = [original];

    const ydoc = new Y.Doc();
    const ytext = ydoc.get(ROOT_KEY, Y.XmlText) as Y.XmlText;
    ytext.applyDelta(slateNodesToInsertDelta(slateRoot));

    const restored = yTextToSlateElement(ytext);
    expect(restored.children).toHaveLength(1);
    const restoredMeta = restored.children[0] as ResearchMetaElementType;
    expect(restoredMeta.type).toBe("research-meta");
    expect(restoredMeta.runId).toBe("r1");
    expect(restoredMeta.model).toBe("deep-research-max-preview-04-2026");
    expect(restoredMeta.plan).toBe("Step 1\nStep 2");
    expect(restoredMeta.sources).toEqual(original.sources);
    expect(restoredMeta.thoughtSummaries).toEqual(["t1", "t2"]);
    expect(restoredMeta.costUsdCents).toBe(500);
  });

  it("survives round-trip when optional fields are absent", () => {
    const original: ResearchMetaElementType = {
      type: "research-meta",
      runId: "r2",
      model: "deep-research-preview-04-2026",
      plan: "p",
      sources: [],
      children: [{ text: "" }],
    };
    const ydoc = new Y.Doc();
    const ytext = ydoc.get("content", Y.XmlText) as Y.XmlText;
    ytext.applyDelta(slateNodesToInsertDelta([original]));
    const restored = yTextToSlateElement(ytext);
    const restoredMeta = restored.children[0] as ResearchMetaElementType;
    expect(restoredMeta.thoughtSummaries).toBeUndefined();
    expect(restoredMeta.costUsdCents).toBeUndefined();
    expect(restoredMeta.sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — should pass (no implementation needed; the contract is the Yjs library + types from Task 7)**

```bash
pnpm --filter @opencairn/web test --run src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx
```

Expected: 8/8 PASS (6 from Task 9 + 2 new).

If a roundtrip drops a field, `research-meta-types.ts` includes a non-JSON-safe value somewhere — investigate before changing the test.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.test.tsx
git commit -m "test(web): pin research-meta Yjs roundtrip (spec §11 Q3)"
```

---

### Task 11: Register research-meta in NoteEditor

**Files:**
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Add the import**

Edit `apps/web/src/components/editor/NoteEditor.tsx`. Add to the imports block (alongside `latexPlugins`):

```typescript
import { researchMetaPlugin } from "./blocks/research-meta/research-meta-plugin";
```

- [ ] **Step 2: Add to `basePlugins`**

Find `const basePlugins = [...]` (around `NoteEditor.tsx:49`). Add `researchMetaPlugin` at the end (preserving existing order):

```typescript
const basePlugins = [
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin,
  ListPlugin,
  ...latexPlugins,
  researchMetaPlugin,
];
```

- [ ] **Step 3: Run NoteEditor existing tests**

```bash
pnpm --filter @opencairn/web test --run src/components/editor/NoteEditor
```

Expected: existing tests still pass. The new plugin only activates for `type: "research-meta"` nodes; legacy notes don't render any.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): register research-meta plugin in NoteEditor basePlugins"
```

---

### Task 12: NewResearchDialog component

**Files:**
- Create: `apps/web/src/components/research/NewResearchDialog.tsx`
- Test: `apps/web/src/components/research/NewResearchDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

`NewResearchDialog.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { NewResearchDialog } from "./NewResearchDialog";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";

vi.mock("@/lib/api-client-research", () => ({
  researchApi: { createRun: vi.fn() },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

function setup({ managedEnabled = false }: { managedEnabled?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  const onClose = vi.fn();
  return {
    onCreated,
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
          <NewResearchDialog
            open
            onClose={onClose}
            onCreated={onCreated}
            workspaceId="w1"
            projects={[
              { id: "p1", name: "Project One" },
              { id: "p2", name: "Project Two" },
            ]}
            managedEnabled={managedEnabled}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("NewResearchDialog", () => {
  it("disables submit until topic + project are filled", () => {
    setup();
    const submit = screen.getByRole("button", { name: /시작하기/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: "trends" },
    });
    fireEvent.change(screen.getByLabelText(/프로젝트/), {
      target: { value: "p1" },
    });
    expect(submit).toBeEnabled();
  });

  it("hides Managed billing path when managedEnabled is false", () => {
    setup({ managedEnabled: false });
    expect(screen.queryByLabelText(/관리형 크레딧/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/내 키 \(BYOK\)/)).toBeInTheDocument();
  });

  it("shows Managed when flag is on", () => {
    setup({ managedEnabled: true });
    expect(screen.getByLabelText(/관리형 크레딧/)).toBeInTheDocument();
  });

  it("submits and calls onCreated with the runId", async () => {
    vi.mocked(researchApi.createRun).mockResolvedValueOnce({ runId: "r-new" });
    const { onCreated } = setup();
    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: "topic" },
    });
    fireEvent.change(screen.getByLabelText(/프로젝트/), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /시작하기/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("r-new"));
    expect(researchApi.createRun).toHaveBeenCalledWith({
      workspaceId: "w1",
      projectId: "p1",
      topic: "topic",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
    });
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/components/research/NewResearchDialog.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`NewResearchDialog.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { researchApi } from "@/lib/api-client-research";
import type {
  CreateResearchRunInput,
  ResearchRunSummary,
} from "@opencairn/shared";

export interface NewResearchDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (runId: string) => void;
  workspaceId: string;
  projects: { id: string; name: string }[];
  managedEnabled: boolean;
}

type Model = ResearchRunSummary["model"];
type BillingPath = ResearchRunSummary["billingPath"];

export function NewResearchDialog({
  open,
  onClose,
  onCreated,
  workspaceId,
  projects,
  managedEnabled,
}: NewResearchDialogProps) {
  const t = useTranslations("research");
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [model, setModel] = useState<Model>("deep-research-preview-04-2026");
  const [billingPath, setBillingPath] = useState<BillingPath>("byok");
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (input: CreateResearchRunInput) => researchApi.createRun(input),
    onSuccess: ({ runId }) => onCreated(runId),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (!open) return null;

  const canSubmit = topic.trim().length > 0 && projectId.length > 0;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("new_dialog.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background w-[480px] max-w-[90vw] rounded-md border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold">{t("new_dialog.title")}</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || createMut.isPending) return;
            setError(null);
            createMut.mutate({
              workspaceId,
              projectId,
              topic: topic.trim(),
              model,
              billingPath,
            });
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block">{t("new_dialog.topic_label")}</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("new_dialog.topic_placeholder")}
              className="w-full rounded border border-border px-2 py-1"
              data-testid="research-topic"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block">{t("new_dialog.project_label")}</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded border border-border px-2 py-1"
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="text-sm">
            <legend className="mb-1">{t("new_dialog.model_label")}</legend>
            <label className="mr-4">
              <input
                type="radio"
                name="model"
                checked={model === "deep-research-preview-04-2026"}
                onChange={() => setModel("deep-research-preview-04-2026")}
              />{" "}
              {t("model.deep_research")}
              <span className="text-muted-foreground ml-1 text-xs">
                ({t("model.cost_hint.deep_research")})
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="model"
                checked={model === "deep-research-max-preview-04-2026"}
                onChange={() => setModel("deep-research-max-preview-04-2026")}
              />{" "}
              {t("model.deep_research_max")}
              <span className="text-muted-foreground ml-1 text-xs">
                ({t("model.cost_hint.deep_research_max")})
              </span>
            </label>
          </fieldset>

          <fieldset className="text-sm">
            <legend className="mb-1">{t("new_dialog.billing_label")}</legend>
            <label className="mr-4 block">
              <input
                type="radio"
                name="billing"
                checked={billingPath === "byok"}
                onChange={() => setBillingPath("byok")}
              />{" "}
              {t("billing_path.byok")}
              <span className="text-muted-foreground ml-1 block text-xs">
                {t("billing_path.byok_help")}
              </span>
            </label>
            {managedEnabled && (
              <label className="block">
                <input
                  type="radio"
                  name="billing"
                  checked={billingPath === "managed"}
                  onChange={() => setBillingPath("managed")}
                />{" "}
                {t("billing_path.managed")}
                <span className="text-muted-foreground ml-1 block text-xs">
                  {t("billing_path.managed_help")}
                </span>
              </label>
            )}
          </fieldset>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1 text-sm"
            >
              {t("new_dialog.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit || createMut.isPending}
              className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm disabled:opacity-50"
            >
              {createMut.isPending
                ? t("new_dialog.submitting")
                : t("new_dialog.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/components/research/NewResearchDialog.test.tsx
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research
git commit -m "feat(web): add NewResearchDialog with topic/project/model/billing form"
```

---

### Task 13: ResearchHub component

**Files:**
- Create: `apps/web/src/components/research/ResearchHub.tsx`
- Test: `apps/web/src/components/research/ResearchHub.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchHub } from "./ResearchHub";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client-research", () => ({
  researchApi: {
    listRuns: vi.fn(),
    createRun: vi.fn(),
  },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchHub
          wsSlug="acme"
          workspaceId="w1"
          projects={[{ id: "p1", name: "P1" }]}
          managedEnabled={false}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchHub", () => {
  it("renders the title and CTA", async () => {
    vi.mocked(researchApi.listRuns).mockResolvedValueOnce({ runs: [] });
    setup();
    expect(screen.getByText("Deep Research")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/아직 시작한 리서치가 없습니다/)).toBeInTheDocument(),
    );
  });

  it("renders the run list", async () => {
    vi.mocked(researchApi.listRuns).mockResolvedValueOnce({
      runs: [
        {
          id: "r1",
          topic: "Topic A",
          model: "deep-research-preview-04-2026",
          status: "completed",
          billingPath: "byok",
          createdAt: "2026-04-25T00:00:00Z",
          updatedAt: "2026-04-25T00:00:00Z",
          completedAt: "2026-04-25T00:30:00Z",
          totalCostUsdCents: 200,
          noteId: "n1",
        },
      ],
    });
    setup();
    await waitFor(() =>
      expect(screen.getByText("Topic A")).toBeInTheDocument(),
    );
  });

  it("opens the dialog when clicking the new button", async () => {
    vi.mocked(researchApi.listRuns).mockResolvedValueOnce({ runs: [] });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /새 리서치 시작/ }));
    expect(
      screen.getByRole("dialog", { name: /새 리서치 시작/ }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchHub.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`ResearchHub.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import { NewResearchDialog } from "./NewResearchDialog";

export interface ResearchHubProps {
  wsSlug: string;
  workspaceId: string;
  projects: { id: string; name: string }[];
  managedEnabled: boolean;
}

export function ResearchHub({
  wsSlug,
  workspaceId,
  projects,
  managedEnabled,
}: ResearchHubProps) {
  const t = useTranslations("research");
  const locale = useLocale();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: researchKeys.list(workspaceId),
    queryFn: () => researchApi.listRuns(workspaceId),
  });

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("hub.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("hub.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm"
        >
          {t("hub.new_button")}
        </button>
      </header>

      {isLoading ? null : !data || data.runs.length === 0 ? (
        <div className="text-muted-foreground rounded border border-dashed border-border p-8 text-center text-sm">
          {t("hub.empty")}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b border-border text-left text-xs">
            <tr>
              <th className="py-2">{t("hub.list.topic")}</th>
              <th>{t("hub.list.model")}</th>
              <th>{t("hub.list.status")}</th>
              <th>{t("hub.list.started_at")}</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr
                key={r.id}
                className="hover:bg-muted/30 cursor-pointer border-b border-border"
                onClick={() =>
                  router.push(`/${locale}/app/w/${wsSlug}/research/${r.id}`)
                }
                data-testid="research-row"
              >
                <td className="py-2">{r.topic}</td>
                <td>
                  {r.model === "deep-research-max-preview-04-2026"
                    ? t("model.deep_research_max")
                    : t("model.deep_research")}
                </td>
                <td>{t(`status.${r.status}`)}</td>
                <td className="text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString(locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewResearchDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(runId) => {
          setDialogOpen(false);
          router.push(`/${locale}/app/w/${wsSlug}/research/${runId}`);
        }}
        workspaceId={workspaceId}
        projects={projects}
        managedEnabled={managedEnabled}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchHub.test.tsx
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research/ResearchHub.tsx apps/web/src/components/research/ResearchHub.test.tsx
git commit -m "feat(web): add ResearchHub list + new button"
```

---

### Task 14: ResearchPlanReview component

**Files:**
- Create: `apps/web/src/components/research/ResearchPlanReview.tsx`
- Test: `apps/web/src/components/research/ResearchPlanReview.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchPlanReview } from "./ResearchPlanReview";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";

vi.mock("@/lib/api-client-research", () => ({
  researchApi: {
    addTurn: vi.fn(),
    updatePlan: vi.fn(),
    approve: vi.fn(),
  },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

function setup({ planText = "1) Step\n2) Step" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchPlanReview runId="r1" planText={planText} status="awaiting_approval" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchPlanReview", () => {
  it("renders the plan text", () => {
    setup();
    expect(screen.getByText(/1\) Step/)).toBeInTheDocument();
  });

  it("calls addTurn with feedback when sending feedback", async () => {
    vi.mocked(researchApi.addTurn).mockResolvedValueOnce({ turnId: "t" });
    setup();
    fireEvent.change(screen.getByPlaceholderText(/이 부분을 빼고/), {
      target: { value: "less depth" },
    });
    fireEvent.click(screen.getByRole("button", { name: /수정 요청/ }));
    await waitFor(() =>
      expect(researchApi.addTurn).toHaveBeenCalledWith("r1", "less depth"),
    );
  });

  it("calls approve when approving", async () => {
    vi.mocked(researchApi.approve).mockResolvedValueOnce({ approved: true });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /승인하고 시작/ }));
    await waitFor(() => expect(researchApi.approve).toHaveBeenCalledWith("r1"));
  });

  it("toggles direct edit and calls updatePlan on save", async () => {
    vi.mocked(researchApi.updatePlan).mockResolvedValueOnce({ turnId: "t" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /직접 편집/ }));
    const ta = screen.getByDisplayValue(/1\) Step/);
    fireEvent.change(ta, { target: { value: "edited plan" } });
    fireEvent.click(screen.getByRole("button", { name: /수정 저장/ }));
    await waitFor(() =>
      expect(researchApi.updatePlan).toHaveBeenCalledWith("r1", "edited plan"),
    );
  });

  it("shows iterating message during planning", () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
          <ResearchPlanReview runId="r1" planText="" status="planning" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/계획을 받아오는 중|계획을 다시 작성 중/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchPlanReview.test.tsx
```

- [ ] **Step 3: Implement**

`ResearchPlanReview.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import type { ResearchRunSummary } from "@opencairn/shared";

export interface ResearchPlanReviewProps {
  runId: string;
  planText: string;
  status: ResearchRunSummary["status"];
}

export function ResearchPlanReview({
  runId,
  planText,
  status,
}: ResearchPlanReviewProps) {
  const t = useTranslations("research.plan_review");
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(planText);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: researchKeys.detail(runId) });

  const sendFeedback = useMutation({
    mutationFn: (text: string) => researchApi.addTurn(runId, text),
    onSuccess: () => {
      setFeedback("");
      invalidate();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const saveEdits = useMutation({
    mutationFn: (text: string) => researchApi.updatePlan(runId, text),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const approve = useMutation({
    mutationFn: () => researchApi.approve(runId),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (status === "planning" && !planText) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h2 className="mb-2 text-xl font-semibold">{t("heading")}</h2>
      <p className="text-muted-foreground mb-4 text-sm">{t("explainer")}</p>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-64 w-full rounded border border-border p-2 font-mono text-sm"
        />
      ) : (
        <pre className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
          {planText}
        </pre>
      )}

      {status === "planning" && planText && (
        <p className="text-muted-foreground mt-2 text-xs">{t("iterating")}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (editing) {
              saveEdits.mutate(draft);
            } else {
              setDraft(planText);
              setEditing(true);
            }
          }}
          className="rounded border border-border px-3 py-1 text-sm"
        >
          {editing ? t("edit_save") : t("edit_direct")}
        </button>
        <button
          type="button"
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm"
        >
          {approve.isPending ? t("approving") : t("approve")}
        </button>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t("feedback_placeholder")}
          className="w-full rounded border border-border p-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => sendFeedback.mutate(feedback)}
            disabled={!feedback.trim() || sendFeedback.isPending}
            className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            {t("feedback_send")}
          </button>
        </div>
      </div>
      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchPlanReview.test.tsx
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research/ResearchPlanReview.tsx apps/web/src/components/research/ResearchPlanReview.test.tsx
git commit -m "feat(web): add ResearchPlanReview (chat / edit / approve)"
```

---

### Task 15: ResearchProgress component

**Files:**
- Create: `apps/web/src/components/research/ResearchProgress.tsx`
- Test: `apps/web/src/components/research/ResearchProgress.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchProgress } from "./ResearchProgress";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";
import type { ResearchArtifact } from "@opencairn/shared";

vi.mock("@/lib/api-client-research", () => ({
  researchApi: { cancel: vi.fn() },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

const sample: ResearchArtifact[] = [
  {
    id: "a1",
    seq: 0,
    kind: "thought_summary",
    payload: { text: "Considering options" },
    createdAt: "",
  },
  {
    id: "a2",
    seq: 1,
    kind: "text_delta",
    payload: { text: "Writing summary…" },
    createdAt: "",
  },
];

function setup(artifacts: ResearchArtifact[] = sample) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchProgress runId="r1" artifacts={artifacts} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchProgress", () => {
  it("renders heading + subhead", () => {
    setup();
    expect(screen.getByText(/조사 진행 중/)).toBeInTheDocument();
  });

  it("groups thought_summary vs text_delta", () => {
    setup();
    expect(screen.getByText("Considering options")).toBeInTheDocument();
    expect(screen.getByText("Writing summary…")).toBeInTheDocument();
  });

  it("shows the no-artifacts state when empty", () => {
    setup([]);
    expect(screen.getByText(/곧 결과 조각이 나타납니다/)).toBeInTheDocument();
  });

  it("calls cancel when cancel button clicked", async () => {
    vi.mocked(researchApi.cancel).mockResolvedValueOnce({ cancelled: true });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /취소/ }));
    await waitFor(() => expect(researchApi.cancel).toHaveBeenCalledWith("r1"));
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchProgress.test.tsx
```

- [ ] **Step 3: Implement**

`ResearchProgress.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import type { ResearchArtifact } from "@opencairn/shared";

export interface ResearchProgressProps {
  runId: string;
  artifacts: ResearchArtifact[];
}

function payloadText(payload: Record<string, unknown>): string {
  const t = payload.text;
  return typeof t === "string" ? t : JSON.stringify(payload);
}

function payloadImageUrl(payload: Record<string, unknown>): string | null {
  const u = payload.image_url ?? payload.url;
  return typeof u === "string" ? u : null;
}

export function ResearchProgress({ runId, artifacts }: ResearchProgressProps) {
  const t = useTranslations("research.progress");
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => researchApi.cancel(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: researchKeys.detail(runId) }),
  });

  const thoughts = artifacts.filter((a) => a.kind === "thought_summary");
  const texts = artifacts.filter((a) => a.kind === "text_delta");
  const images = artifacts.filter((a) => a.kind === "image");

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-4">
        <h2 className="text-xl font-semibold">{t("heading")}</h2>
        <p className="text-muted-foreground text-sm">{t("subhead")}</p>
      </header>

      {artifacts.length === 0 ? (
        <div className="text-muted-foreground rounded border border-dashed border-border p-6 text-sm">
          {t("no_artifacts_yet")}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {thoughts.length > 0 && (
            <details>
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t("thinking")} ({thoughts.length})
              </summary>
              <ul className="mt-1 space-y-1">
                {thoughts.map((a) => (
                  <li key={a.id} className="text-muted-foreground">
                    {payloadText(a.payload)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {texts.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase">{t("writing")}</h3>
              <pre className="whitespace-pre-wrap text-sm">
                {texts.map((a) => payloadText(a.payload)).join("")}
              </pre>
            </section>
          )}
          {images.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase">
                {t("image_generating")}
              </h3>
              {images.map((a) => {
                const url = payloadImageUrl(a.payload);
                return url ? (
                  <img
                    key={a.id}
                    src={url}
                    alt=""
                    className="max-w-full rounded border border-border"
                  />
                ) : null;
              })}
            </section>
          )}
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="rounded border border-border px-3 py-1 text-sm"
        >
          {cancel.isPending ? t("cancelling") : t("cancel")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchProgress.test.tsx
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research/ResearchProgress.tsx apps/web/src/components/research/ResearchProgress.test.tsx
git commit -m "feat(web): add ResearchProgress (live artifact stream + cancel)"
```

---

### Task 16: ResearchRunView orchestrator

**Files:**
- Create: `apps/web/src/components/research/ResearchRunView.tsx`
- Test: `apps/web/src/components/research/ResearchRunView.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchRunView } from "./ResearchRunView";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";
import type { ResearchRunDetail } from "@opencairn/shared";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

vi.mock("@/lib/api-client-research", () => ({
  researchApi: {
    getRun: vi.fn(),
    addTurn: vi.fn(),
    updatePlan: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
  },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

vi.mock("@/hooks/use-research-stream", () => ({
  useResearchStream: vi.fn(),
}));

function detail(over: Partial<ResearchRunDetail>): ResearchRunDetail {
  return {
    id: "r1",
    workspaceId: "w1",
    projectId: "p1",
    topic: "T",
    model: "deep-research-preview-04-2026",
    status: "planning",
    billingPath: "byok",
    currentInteractionId: null,
    approvedPlanText: null,
    error: null,
    totalCostUsdCents: null,
    noteId: null,
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    completedAt: null,
    turns: [],
    artifacts: [],
    ...over,
  };
}

function setup(d: ResearchRunDetail) {
  vi.mocked(researchApi.getRun).mockResolvedValueOnce(d);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchRunView runId="r1" wsSlug="acme" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchRunView", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("renders ResearchPlanReview when awaiting_approval", async () => {
    setup(
      detail({
        status: "awaiting_approval",
        turns: [
          {
            id: "t",
            seq: 0,
            role: "agent",
            kind: "plan_proposal",
            interactionId: null,
            content: "Plan body",
            createdAt: "",
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/조사 계획 검토/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Plan body/)).toBeInTheDocument();
  });

  it("renders ResearchProgress when researching", async () => {
    setup(detail({ status: "researching" }));
    await waitFor(() =>
      expect(screen.getByText(/조사 진행 중/)).toBeInTheDocument(),
    );
  });

  it("redirects to the note when completed and noteId set", async () => {
    setup(detail({ status: "completed", noteId: "n1" }));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/app\/w\/acme\/n\/n1$/),
      );
    });
  });

  it("renders failure state when failed", async () => {
    setup(
      detail({
        status: "failed",
        error: { code: "invalid_byok_key", message: "x", retryable: false },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Gemini API 키가 유효하지 않습니다/),
      ).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchRunView.test.tsx
```

- [ ] **Step 3: Implement**

`ResearchRunView.tsx`:

```tsx
"use client";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import { useResearchStream } from "@/hooks/use-research-stream";
import { ResearchPlanReview } from "./ResearchPlanReview";
import { ResearchProgress } from "./ResearchProgress";
import type { ResearchTurn } from "@opencairn/shared";

export interface ResearchRunViewProps {
  runId: string;
  wsSlug: string;
}

// Picks the freshest approved-or-edited-or-proposed plan text. Mirrors the
// API's approve-resolution rule (apps/api/src/routes/research.ts:441-468)
// so what the user sees matches what `approve` will commit if they click.
function latestPlanText(turns: ResearchTurn[]): string {
  const order: ResearchTurn["kind"][] = [
    "user_edit",
    "plan_proposal",
  ];
  for (const kind of order) {
    const candidates = turns
      .filter((t) => t.kind === kind)
      .sort((a, b) => b.seq - a.seq);
    if (candidates[0]) return candidates[0].content;
  }
  return "";
}

export function ResearchRunView({ runId, wsSlug }: ResearchRunViewProps) {
  const t = useTranslations("research");
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: researchKeys.detail(runId),
    queryFn: () => researchApi.getRun(runId),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 5_000;
      const terminal =
        d.status === "completed" ||
        d.status === "failed" ||
        d.status === "cancelled";
      return terminal ? false : 5_000;
    },
  });

  // SSE invalidates the detail cache on every event. The query refetch ms
  // above is a backstop for missed events / network drops.
  useResearchStream(runId, () => {
    qc.invalidateQueries({ queryKey: researchKeys.detail(runId) });
  });

  const planText = useMemo(
    () => (data ? latestPlanText(data.turns) : ""),
    [data],
  );

  // Auto-redirect on completion. We don't unmount on `useEffect` cleanup
  // (router navigation does that) so the spinner state is fine if the push
  // takes a tick.
  useEffect(() => {
    if (data?.status === "completed" && data.noteId) {
      router.push(`/${locale}/app/w/${wsSlug}/n/${data.noteId}`);
    }
  }, [data?.status, data?.noteId, locale, wsSlug, router]);

  if (isLoading || !data) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("plan_review.loading")}
      </div>
    );
  }

  if (data.status === "failed") {
    const code = data.error?.code ?? "generic_failed";
    const message =
      code === "invalid_byok_key"
        ? t("error.invalid_byok")
        : code === "quota_exceeded"
        ? t("error.quota_exceeded")
        : t("error.generic_failed");
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-sm">
        <h2 className="mb-2 text-xl font-semibold">
          {t("status.failed")}
        </h2>
        <p>{message}</p>
        {code === "invalid_byok_key" && (
          <a
            href={`/${locale}/app/settings/ai`}
            className="text-primary mt-2 inline-block underline"
          >
            {t("error.invalid_byok_cta")}
          </a>
        )}
      </div>
    );
  }

  if (data.status === "cancelled") {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("status.cancelled")}
      </div>
    );
  }

  if (data.status === "completed") {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("completed.redirecting")}
      </div>
    );
  }

  if (data.status === "researching") {
    return <ResearchProgress runId={runId} artifacts={data.artifacts} />;
  }

  // planning | awaiting_approval
  return (
    <ResearchPlanReview
      runId={runId}
      planText={planText}
      status={data.status}
    />
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm --filter @opencairn/web test --run src/components/research/ResearchRunView.test.tsx
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research/ResearchRunView.tsx apps/web/src/components/research/ResearchRunView.test.tsx
git commit -m "feat(web): add ResearchRunView orchestrator with status-driven branches"
```

---

### Task 17: Replace `(shell)/research/page.tsx` placeholder

**Files:**
- Modify: `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/page.tsx`

> Server Component. Reads `FEATURE_DEEP_RESEARCH` server-side, fetches projects via the API client (using cookies passed-through), and hands the workspace context down to `<ResearchHub>`.

- [ ] **Step 1: Find a server-side helper for resolving workspaceId from wsSlug + project list**

Quick check: search `apps/web/src/app/[locale]/app/w/[wsSlug]` for an existing pattern that does workspace+projects resolution server-side. The dashboard page is a likely template.

```bash
grep -rn "workspaceId\|projects" "apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/page.tsx" 2>/dev/null
```

Use the same pattern (likely `apiClient<{...}>` calls with cookies forwarded by Next 16 server fetch, or a `loadWorkspace` helper if one exists). If none exists, inline the call here:

```typescript
import { apiClient } from "@/lib/api-client";

interface WorkspaceLite { id: string; slug: string }
interface ProjectLite { id: string; name: string }

async function loadHubData(wsSlug: string) {
  // Endpoints already exist (Plan 1 / App Shell Phase 2). Use the same
  // shape the dashboard server page uses.
  const ws = await apiClient<WorkspaceLite>(`/workspaces/by-slug/${wsSlug}`);
  const projects = await apiClient<ProjectLite[]>(
    `/projects/by-workspace/${ws.id}`,
  );
  return { ws, projects };
}
```

If those endpoints don't exist or use a different shape, **stop and read** `apps/api/src/routes/workspaces.ts` and `apps/api/src/routes/projects.ts` first to find the right path. The plan does not invent endpoint contracts.

- [ ] **Step 2: Replace the page**

```tsx
import { notFound } from "next/navigation";
import { isDeepResearchEnabled, isManagedDeepResearchEnabled } from "@/lib/feature-flags";
import { ResearchHub } from "@/components/research/ResearchHub";
import { apiClient } from "@/lib/api-client";

interface WorkspaceLite { id: string; slug: string }
interface ProjectLite { id: string; name: string }

export default async function ResearchHubPage({
  params,
}: {
  params: Promise<{ wsSlug: string }>;
}) {
  if (!isDeepResearchEnabled()) notFound();
  const { wsSlug } = await params;

  const ws = await apiClient<WorkspaceLite>(`/workspaces/by-slug/${wsSlug}`);
  const projects = await apiClient<ProjectLite[]>(
    `/projects/by-workspace/${ws.id}`,
  );

  return (
    <ResearchHub
      wsSlug={wsSlug}
      workspaceId={ws.id}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      managedEnabled={isManagedDeepResearchEnabled()}
    />
  );
}
```

> If the actual `/workspaces/by-slug/:slug` or `/projects/by-workspace/:wsId` endpoints differ, adjust the calls. The plan's job here is the wiring shape, not the contract.

- [ ] **Step 3: Type-check + smoke run**

```bash
pnpm --filter @opencairn/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/page.tsx"
git commit -m "feat(web): wire ResearchHub into /research route + flag gate"
```

---

### Task 18: Replace `(shell)/research/[runId]/page.tsx` placeholder

**Files:**
- Modify: `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/[runId]/page.tsx`

- [ ] **Step 1: Replace**

```tsx
import { notFound } from "next/navigation";
import { isDeepResearchEnabled } from "@/lib/feature-flags";
import { ResearchRunView } from "@/components/research/ResearchRunView";

export default async function ResearchRunPage({
  params,
}: {
  params: Promise<{ wsSlug: string; runId: string }>;
}) {
  if (!isDeepResearchEnabled()) notFound();
  const { wsSlug, runId } = await params;
  return <ResearchRunView runId={runId} wsSlug={wsSlug} />;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @opencairn/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/[runId]/page.tsx"
git commit -m "feat(web): wire ResearchRunView into /research/[runId] + flag gate"
```

---

### Task 19: Sidebar gate — hide research icon when flag off

**Files:**
- Modify: `apps/web/src/components/sidebar/global-nav.tsx`
- Modify: `apps/web/src/components/sidebar/shell-sidebar.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx`
- Modify: `apps/web/src/components/shell/shell-providers.tsx`
- Modify: `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/layout.tsx`

> Threading: `layout.tsx` (server) reads the env → passes to `ShellProviders` → `AppShell` → `ShellSidebar` → `GlobalNav`. Each gets a `deepResearchEnabled: boolean` prop.

- [ ] **Step 1: Update `GlobalNav` signature**

```typescript
export interface GlobalNavProps {
  wsSlug: string;
  deepResearchEnabled: boolean;
}

export function GlobalNav({ wsSlug, deepResearchEnabled }: GlobalNavProps) {
  // …
  const items = [
    { href: `${base}/`, label: t("dashboard"), Icon: Home },
    ...(deepResearchEnabled
      ? [{ href: `${base}/research`, label: t("research"), Icon: FlaskConical } as const]
      : []),
    { href: `${base}/import`, label: t("import"), Icon: DownloadCloud },
  ] as const;
  // (rest unchanged)
}
```

- [ ] **Step 2: Thread the prop through `ShellSidebar`, `AppShell`, `ShellProviders`**

Each gets a `deepResearchEnabled: boolean` prop and forwards it down. Skim each file first to find the right insertion point and prop spreading site (most of these only own a children pass-through).

- [ ] **Step 3: Update `(shell)/layout.tsx` to read the flag**

```tsx
import { ShellProviders } from "@/components/shell/shell-providers";
import { isDeepResearchEnabled } from "@/lib/feature-flags";

export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  return (
    <ShellProviders
      wsSlug={wsSlug}
      deepResearchEnabled={isDeepResearchEnabled()}
    >
      {children}
    </ShellProviders>
  );
}
```

- [ ] **Step 4: Update existing tests for `GlobalNav`**

The existing test file may render `<GlobalNav>` directly. Add the new prop:

```bash
grep -rn "<GlobalNav" apps/web/src --include="*.tsx" --include="*.ts"
```

Update each call site to include `deepResearchEnabled={true}` (or `false` to assert the hidden case in a new test). Add a single new test asserting the hidden behavior:

```typescript
it("hides research icon when deepResearchEnabled is false", () => {
  render(/* … */ <GlobalNav wsSlug="acme" deepResearchEnabled={false} />);
  expect(screen.queryByLabelText(/Deep Research/)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run web tests**

```bash
pnpm --filter @opencairn/web test --run
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/sidebar apps/web/src/components/shell "apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/layout.tsx"
git commit -m "feat(web): hide sidebar research icon when FEATURE_DEEP_RESEARCH off"
```

---

### Task 20: Drop stale app-shell placeholder copy

**Files:**
- Modify: `apps/web/messages/ko/app-shell.json`
- Modify: `apps/web/messages/en/app-shell.json`

> The `appShell.routes.research_hub` and `appShell.routes.research_run` keys were the placeholder copy strings. Phase D's real pages no longer use them. Leaving them around invites future drift; remove now.

- [ ] **Step 1: Drop the keys in both locales**

Edit `apps/web/messages/ko/app-shell.json`: remove the `routes.research_hub` and `routes.research_run` entries. Same for `en/app-shell.json`.

- [ ] **Step 2: Verify nothing still uses them**

```bash
grep -rn "appShell.routes.research" apps/web/src --include="*.tsx" --include="*.ts"
```

Expected: zero matches (the placeholder pages were already replaced in Tasks 17/18). If there are matches, fix the call sites before continuing.

- [ ] **Step 3: Parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages
git commit -m "chore(web): drop unused app-shell research placeholder keys"
```

---

### Task 21: Playwright smoke

**Files:**
- Create: `apps/web/playwright/research-smoke.spec.ts`

> Mocks `/api/research/*` so the test runs deterministically without Google API. Drives the full UX path.

- [ ] **Step 1: Read existing playwright config + an existing spec for the helpers**

```bash
ls apps/web/playwright/
cat apps/web/playwright.config.ts | head -40
```

Identify the auth bootstrap helper (storageState, login flow) and reuse it. If existing specs use a `loginAs` helper, this spec should too.

- [ ] **Step 2: Write the smoke spec**

```typescript
import { test, expect } from "@playwright/test";

// Smoke test for Deep Research Phase D. Mocks every /api/research/* endpoint
// so we can drive the full flow without hitting Google. Uses the auth
// fixture pattern already in place for note specs (loginAs / storageState).

test.describe("Deep Research smoke", () => {
  test("submit topic → plan → approve → completed redirect", async ({
    page,
    context,
  }) => {
    // Mock listRuns: empty initially.
    await context.route("**/api/research/runs?workspaceId=*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      });
    });

    // Mock createRun.
    await context.route("**/api/research/runs", async (route, request) => {
      if (request.method() !== "POST") return route.continue();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ runId: "r-smoke" }),
      });
    });

    // Mock getRun: return awaiting_approval first, then completed on a
    // second invocation. Playwright keeps the route active across navigations.
    let getCount = 0;
    await context.route("**/api/research/runs/r-smoke", async (route) => {
      getCount += 1;
      const status = getCount <= 1 ? "awaiting_approval" : "completed";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "r-smoke",
          workspaceId: "FIXME-ws-id",
          projectId: "FIXME-proj-id",
          topic: "Smoke topic",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
          status,
          currentInteractionId: null,
          approvedPlanText: status === "completed" ? "Plan body" : null,
          error: null,
          totalCostUsdCents: null,
          noteId: status === "completed" ? "n-smoke" : null,
          createdAt: "2026-04-25T00:00:00Z",
          updatedAt: "2026-04-25T00:00:00Z",
          completedAt: status === "completed" ? "2026-04-25T00:30:00Z" : null,
          turns: [
            {
              id: "t1",
              seq: 0,
              role: "agent",
              kind: "plan_proposal",
              interactionId: null,
              content: "1) Step\n2) Step",
              createdAt: "2026-04-25T00:00:00Z",
            },
          ],
          artifacts: [],
        }),
      });
    });

    // Mock approve.
    await context.route("**/api/research/runs/r-smoke/approve", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ approved: true }),
      });
    });

    // Mock the SSE stream — empty body is fine; the query's refetchInterval
    // will pick up the second getRun response.
    await context.route("**/api/research/runs/r-smoke/stream", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
    });

    // Mock the eventual note read so the post-redirect page renders.
    await context.route("**/api/notes/n-smoke", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "n-smoke",
          projectId: "FIXME-proj-id",
          workspaceId: "FIXME-ws-id",
          folderId: null,
          inheritParent: false,
          title: "Smoke topic",
          content: [
            {
              type: "research-meta",
              runId: "r-smoke",
              model: "deep-research-preview-04-2026",
              plan: "Plan body",
              sources: [],
              children: [{ text: "" }],
            },
            { type: "p", children: [{ text: "Report body" }] },
          ],
          contentText: "Report body",
          type: "note",
          sourceType: null,
          sourceFileKey: null,
          sourceUrl: null,
          mimeType: null,
          isAuto: true,
          createdAt: "2026-04-25T00:30:00Z",
          updatedAt: "2026-04-25T00:30:00Z",
          deletedAt: null,
        }),
      });
    });

    // Navigate. Replace `acme` with the test fixture workspace slug used in
    // sibling specs.
    await page.goto("/ko/app/w/acme/research");
    await expect(page.getByText("Deep Research")).toBeVisible();
    await page.getByRole("button", { name: /새 리서치 시작/ }).click();
    await page.getByTestId("research-topic").fill("Smoke topic");
    // Project select — first non-empty option.
    await page
      .locator("select")
      .first()
      .selectOption({ index: 1 });
    await page.getByRole("button", { name: /시작하기/ }).click();

    // Plan review screen.
    await expect(page.getByText(/조사 계획 검토/)).toBeVisible();
    await expect(page.getByText(/1\) Step/)).toBeVisible();

    await page.getByRole("button", { name: /승인하고 시작/ }).click();

    // After completion, we redirect to /n/n-smoke. Wait for that.
    await page.waitForURL(/\/n\/n-smoke/);
    await expect(page.getByText("Smoke topic")).toBeVisible();
  });
});
```

> The `FIXME-*` placeholders mark fields the smoke does not assert on. Replace `acme` and the project-select index with whatever the existing E2E fixture provides.

- [ ] **Step 3: Run the smoke**

```bash
FEATURE_DEEP_RESEARCH=true pnpm --filter @opencairn/web test:e2e -- research-smoke
```

If the spec relies on auth bootstrap that isn't in scope here, mark this task **deferred** in the PR description (Phase E will own the full E2E). The spec file lands; a green run is preferred but not mandatory if auth bootstrap is the blocker.

- [ ] **Step 4: Commit**

```bash
git add apps/web/playwright/research-smoke.spec.ts
git commit -m "test(web): add Deep Research happy-path Playwright smoke (mocked API)"
```

---

### Task 22: Final verification + post-feature loop

**Files:** none (verification only)

- [ ] **Step 1: Run all web checks**

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web test --run
pnpm --filter @opencairn/web build
```

Expected: all green. Fix any new lint failures introduced by Phase D files (especially `i18next/no-literal-string` — ensure no user-facing strings escaped as literals).

- [ ] **Step 2: Run the full repo check that CI runs (smoke)**

```bash
pnpm typecheck
pnpm lint
```

Address only failures introduced by this branch. If a pre-existing failure surfaces, note it in the PR description; do not fix unrelated issues here.

- [ ] **Step 3: Use `opencairn:post-feature` skill to do the final review pass**

Invoke `opencairn:post-feature` and follow its checklist (verification, review, docs update, commit). Specifically:
- Update `docs/contributing/plans-status.md` — mark "Deep Research Phase D" complete with branch + commit count.
- Update the `Plans` block in `CLAUDE.md` if the active row needs to flip.

- [ ] **Step 4: Commit docs**

```bash
git add docs/contributing/plans-status.md CLAUDE.md
git commit -m "docs: mark Deep Research Phase D complete"
```

---

### Task 23: Open PR

**Files:** none

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/deep-research-phase-d
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --base main --head feat/deep-research-phase-d \
  --title "feat(web): Deep Research Phase D — /research UI + research-meta block" \
  --body "$(cat <<'EOF'
## Summary
- Adds the full `/research` web UI: hub (list + new run dialog), per-run page (plan review · progress · completed redirect), and a Plate v49 `research-meta` block registered in `NoteEditor` so worker-generated reports render with collapsible plan/sources/cost metadata.
- Gates the routes and the sidebar icon behind `FEATURE_DEEP_RESEARCH`, mirroring `apps/api/src/routes/research.ts:52`.
- Pins Yjs roundtrip compatibility for `research-meta` (spec §11 Open Question 3).
- Phase E (i18n polish · full E2E · prod release · BYOK registration UI) explicitly out of scope.

## Spec / Plan
- Spec: `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md`
- Plan: `docs/superpowers/plans/2026-04-25-deep-research-phase-d-web.md`

## Phase A/B/C base
- A: `8910563` (PR #4)
- B: `3b03154` (PR #3)
- C: `a838524` (PRs #6/#7/#8/#9)

## Test plan
- [x] `pnpm --filter @opencairn/web typecheck`
- [x] `pnpm --filter @opencairn/web test --run`
- [x] `pnpm --filter @opencairn/web i18n:parity`
- [x] `pnpm --filter @opencairn/web build`
- [ ] Playwright smoke (`research-smoke.spec.ts`) — see PR comment if auth-bootstrap deferred

## Phase E handoff
- Translate `messages/en/research.json` with a native review pass (currently AI-translated, parity-locked but copy unverified).
- Wire `/settings/ai` for BYOK registration so the failure-state CTA in `ResearchRunView` actually lands.
- Full Playwright with real auth fixture; flip `FEATURE_DEEP_RESEARCH=true` in prod after sign-off.
- Plan 9b → flip `FEATURE_MANAGED_DEEP_RESEARCH=true`; `NewResearchDialog` already shows the Managed radio when the flag is on.
EOF
)"
```

- [ ] **Step 3: Confirm PR URL with the user.**

---

## Self-review

Before declaring this plan ready, verify against the spec section by section.

### Spec coverage

| Spec section | Plan task | Notes |
|---|---|---|
| §3 Architecture · web layer | 17, 18 | Route pages call into client components; no Server Actions, no DB import in web. |
| §4.2 web routes (hub + run) | 13, 16, 17, 18 | |
| §4.3 research-meta block | 7, 8, 9, 10, 11 | Type, plugin, component, Yjs pin, NoteEditor registration. |
| §5.1 planning data flow | 12, 13 | Form submit → POST /runs → redirect to run page. |
| §5.2 plan editing 3-way | 14 | Chat feedback / direct edit / approve. |
| §5.3 research execution | 15, 16 | Progress view + auto redirect on completion. |
| §6 error handling — invalid_byok | 16 | Failed-state branch with `/settings/ai` CTA. |
| §6 error — concurrent_write | (covered) | `apiClient` propagates 409 → `ApiError.message` → component error display. |
| §7 access/billing paths (UI) | 12 | BYOK default; Managed only when flag on. |
| §8 i18n + feature flag | 1, 2, 3, 4, 17, 18, 19 | ko + en parity, register namespace, flag gate routes + sidebar. |
| §9.4 Playwright smoke | 21 | Mocked happy path. |
| §11 Open Question 3 (Yjs) | 10 | Roundtrip pin. |

### Placeholder scan

- "TBD"/"TODO"/"implement later": none.
- "Add appropriate error handling": none — error handling is spelled out per task.
- "Similar to Task N": each task carries its own code blocks.
- Functions referenced but not defined: `apiClient` (existing), `latestPlanText` (defined in Task 16), `payloadText` / `payloadImageUrl` (defined in Task 15), `slateNodesToInsertDelta` / `yTextToSlateElement` (existing `@slate-yjs/core` exports).

### Type consistency check

- `researchApi` method names: `createRun` / `listRuns` / `getRun` / `addTurn` / `updatePlan` / `approve` / `cancel`. Used identically in Tasks 5, 12, 13, 14, 15, 16, 21.
- `researchKeys.list(workspaceId)` / `researchKeys.detail(runId)` — consistent across Tasks 5, 13, 14, 15, 16.
- `ResearchMetaElement` type vs component: type defined Task 7, component imports it in Task 9, Yjs test uses it in Task 10, NoteEditor registers the **plugin** (Task 8) — not the component directly. ✓
- Plate v49 idioms: `withComponent`, `createPlatePlugin`, `PlateElement`, `<Plate>` not `<Plate onChange>`. ✓

### Known unknowns to resolve during execution

- Exact server-side endpoint paths for "load workspace by slug" + "list projects by workspace". Task 17 instructs the executor to read `apps/api/src/routes/workspaces.ts` + `apps/api/src/routes/projects.ts` if the assumed paths don't exist — do not invent contracts.
- Playwright auth bootstrap. Task 21's spec may need the existing `storageState` setup; Step 1 of that task instructs reading the config first.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-deep-research-phase-d-web.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
