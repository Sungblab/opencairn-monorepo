# Plan 2D — Chat Renderer + Editor Block Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plate v49 에디터에 5종 블록 (Mermaid · Callout · Toggle · Table · Columns)을 추가하고, Agent Panel 채팅을 react-markdown 기반 리치 렌더로 업그레이드하며, `save_suggestion` SSE 페이로드를 활성 노트에 Plate AST로 삽입한다.

**Architecture:** 2-track 렌더링 (chat은 react-markdown, save 시점에 `@platejs/markdown`으로 Plate AST 변환), 1개 공유 모듈 (`lib/markdown/`), 신규 zustand 스토어로 활성 에디터 인스턴스 관리, 기존 SaveSuggestionCard 재배선.

**Tech Stack:** Plate v49 (`platejs@^49`, `@platejs/{callout,toggle,table,layout,code-block}@^49`, `@platejs/markdown`), `react-markdown@^9` + `remark-gfm`/`remark-math`/`rehype-katex`/`rehype-raw`, `mermaid@^11` (lazy), `react-syntax-highlighter@^15` (Prism), `isomorphic-dompurify`, `zustand`.

**Spec:** `docs/superpowers/specs/2026-04-26-plan-2d-chat-renderer-design.md`

---

## File Structure

```
apps/web/
├── package.json                                      (modify: deps)
├── messages/{en,ko}/editor.json                      (modify: 5 block keys)
├── messages/{en,ko}/agent-panel.json                 (modify: 2 save_suggestion keys)
├── messages/{en,ko}/chat.json                        (CREATE: chat renderer keys)
├── src/
│   ├── components/
│   │   ├── editor/
│   │   │   ├── NoteEditor.tsx                        (modify: add 5 plugins + register store)
│   │   │   ├── plugins/
│   │   │   │   ├── slash.tsx                         (modify: 5 new commands)
│   │   │   │   └── mermaid-fence.tsx                 (CREATE: autoformat)
│   │   │   ├── blocks/
│   │   │   │   ├── mermaid/
│   │   │   │   │   ├── mermaid-plugin.tsx            (CREATE)
│   │   │   │   │   ├── mermaid-element.tsx           (CREATE)
│   │   │   │   │   └── mermaid-element.test.tsx      (CREATE)
│   │   │   │   ├── callout/
│   │   │   │   │   ├── callout-plugin.tsx            (CREATE)
│   │   │   │   │   ├── callout-element.tsx           (CREATE)
│   │   │   │   │   └── callout-element.test.tsx     (CREATE)
│   │   │   │   ├── toggle/
│   │   │   │   │   ├── toggle-plugin.tsx             (CREATE)
│   │   │   │   │   ├── toggle-element.tsx            (CREATE)
│   │   │   │   │   └── toggle-element.test.tsx     (CREATE)
│   │   │   │   ├── table/
│   │   │   │   │   ├── table-plugin.tsx              (CREATE)
│   │   │   │   │   └── table-element.tsx            (CREATE)
│   │   │   │   └── columns/
│   │   │   │       ├── columns-plugin.tsx            (CREATE)
│   │   │   │       └── columns-element.tsx           (CREATE)
│   │   ├── chat/
│   │   │   ├── chat-message-renderer.tsx             (CREATE)
│   │   │   ├── chat-message-renderer.test.tsx       (CREATE)
│   │   │   ├── streaming-text.tsx                    (CREATE)
│   │   │   └── renderers/
│   │   │       ├── code-block.tsx                    (CREATE)
│   │   │       ├── mermaid-chat.tsx                  (CREATE)
│   │   │       ├── callout-blockquote.tsx            (CREATE)
│   │   │       └── prose-table.tsx                   (CREATE)
│   │   └── agent-panel/
│   │       ├── message-bubble.tsx                    (modify: use ChatMessageRenderer + onSave)
│   │       └── agent-panel.tsx                       (modify: provide onSaveSuggestion handler)
│   ├── hooks/
│   │   └── useMermaidRender.ts                      (CREATE: shared by editor + chat)
│   ├── lib/
│   │   ├── markdown/
│   │   │   ├── markdown-to-plate.ts                  (CREATE)
│   │   │   ├── markdown-to-plate.test.ts             (CREATE)
│   │   │   ├── shared-prose.ts                       (CREATE)
│   │   │   └── sanitize-html.ts                      (CREATE: DOMPurify wrapper)
│   │   └── notes/
│   │       ├── insert-from-markdown.ts               (CREATE)
│   │       └── insert-from-markdown.test.ts         (CREATE)
│   └── stores/
│       └── activeEditorStore.ts                      (CREATE: zustand)
├── e2e/plan-2d/
│   ├── editor-blocks.spec.ts                         (CREATE)
│   ├── chat-renderer.spec.ts                         (CREATE)
│   └── save-suggestion.spec.ts                       (CREATE)
apps/api/src/
├── lib/agent-pipeline.ts                             (modify: env-flagged save_suggestion emit)
└── routes/threads.test.ts                            (modify: add save_suggestion case)
packages/shared/src/
└── agent.ts                                          (CREATE or modify: saveSuggestionSchema)
```

---

## Phase A — Foundation

### Task 1: Install dependencies + register code-block plugin

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx:50-63` (basePlugins array)
- Modify: `pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Add dependencies to apps/web/package.json**

Open `apps/web/package.json` and add to `dependencies` (alphabetical order):

```jsonc
"@platejs/callout": "^49",
"@platejs/code-block": "^49",
"@platejs/layout": "^49",
"@platejs/markdown": "^49",
"@platejs/table": "^49",
"@platejs/toggle": "^49",
"isomorphic-dompurify": "^2.27.0",
"katex": "^0.16.10",
"mermaid": "^11.12.0",
"react-markdown": "^9.0.3",
"react-syntax-highlighter": "^15.6.6",
"rehype-katex": "^7.0.1",
"rehype-raw": "^7.0.0",
"remark-gfm": "^4.0.1",
"remark-math": "^6.0.0",
"zustand": "^5.0.8"
```

Add to `devDependencies`:

```jsonc
"@types/react-syntax-highlighter": "^15.5.13"
```

- [ ] **Step 2: Install**

Run from monorepo root:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updated, no peer-dep errors.

- [ ] **Step 3: Update basePlugins to include code-block**

In `apps/web/src/components/editor/NoteEditor.tsx`, replace the import block (lines 3-15) and `basePlugins` array (lines 50-63):

```tsx
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { CodeBlockPlugin, CodeLinePlugin } from "@platejs/code-block/react";
import { ListPlugin } from "@platejs/list/react";
import { toggleList } from "@platejs/list";

// ...

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
  CodeBlockPlugin,
  CodeLinePlugin,
  ...latexPlugins,
  researchMetaPlugin,
];
```

- [ ] **Step 4: Verify NoteEditor still renders + tests pass**

Run:

```bash
pnpm --filter @opencairn/web test --run
```

Expected: All existing tests pass (8+ tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/editor/NoteEditor.tsx
git commit -m "chore(web): install Plan 2D deps + register code-block plugin"
```

---

### Task 2: i18n keys for editor blocks + chat renderer

**Files:**
- Modify: `apps/web/messages/ko/editor.json`
- Modify: `apps/web/messages/en/editor.json`
- Modify: `apps/web/messages/ko/agent-panel.json`
- Modify: `apps/web/messages/en/agent-panel.json`
- Create: `apps/web/messages/ko/chat.json`
- Create: `apps/web/messages/en/chat.json`
- Modify: `apps/web/src/i18n/messages.ts` (or wherever messages namespace is registered)

- [ ] **Step 1: Find messages namespace registration**

Run:

```bash
grep -rn "messages/" apps/web/src/i18n/ apps/web/i18n.ts apps/web/src/i18n.ts 2>/dev/null | head -10
```

Open the file that imports JSON files (likely `apps/web/src/i18n/request.ts` or similar). Note which namespaces are loaded.

- [ ] **Step 2: Add editor block keys (both locales)**

In both `apps/web/messages/ko/editor.json` and `apps/web/messages/en/editor.json`, add to the `slash` object (4 new entries) and add a new top-level `blocks` object.

For `ko/editor.json`, add inside existing `slash` (alongside `heading_1` etc.):

```json
"mermaid": "다이어그램",
"callout": "알림 박스",
"toggle": "토글",
"table": "표",
"columns": "다단"
```

And add a sibling top-level key:

```json
"blocks": {
  "mermaid": {
    "placeholder": "여기에 mermaid 코드를 입력하세요…",
    "error_title": "다이어그램 오류",
    "error_help": "구문을 확인하거나 코드를 다시 작성해 주세요.",
    "show_source": "코드 보기",
    "hide_source": "코드 숨기기"
  },
  "callout": {
    "info": "정보",
    "warn": "주의",
    "tip": "팁",
    "danger": "경고"
  },
  "toggle": {
    "placeholder": "제목을 입력하세요"
  },
  "table": {
    "row_add_above": "위에 행 추가",
    "row_add_below": "아래에 행 추가",
    "col_add_left": "왼쪽에 열 추가",
    "col_add_right": "오른쪽에 열 추가",
    "row_delete": "행 삭제",
    "col_delete": "열 삭제",
    "header_toggle": "첫 행을 헤더로"
  },
  "columns": {
    "two": "2단",
    "three": "3단"
  }
}
```

For `en/editor.json`, the equivalent English values:

```json
"mermaid": "Diagram",
"callout": "Callout",
"toggle": "Toggle",
"table": "Table",
"columns": "Columns"
```

```json
"blocks": {
  "mermaid": {
    "placeholder": "Enter mermaid code here…",
    "error_title": "Diagram error",
    "error_help": "Check the syntax or rewrite the code.",
    "show_source": "Show source",
    "hide_source": "Hide source"
  },
  "callout": {
    "info": "Info",
    "warn": "Warn",
    "tip": "Tip",
    "danger": "Danger"
  },
  "toggle": {
    "placeholder": "Enter a heading"
  },
  "table": {
    "row_add_above": "Add row above",
    "row_add_below": "Add row below",
    "col_add_left": "Add column left",
    "col_add_right": "Add column right",
    "row_delete": "Delete row",
    "col_delete": "Delete column",
    "header_toggle": "Use first row as header"
  },
  "columns": {
    "two": "Two columns",
    "three": "Three columns"
  }
}
```

- [ ] **Step 3: Add agent-panel save target keys**

In both `apps/web/messages/ko/agent-panel.json` and `.../en/agent-panel.json`, add inside the existing `bubble` object:

For `ko`:

```json
"save_suggestion_inserted_active": "현재 노트에 추가했어요",
"save_suggestion_target_prompt": "이 채팅을 어디에 저장할까요?",
"save_suggestion_create_new": "새 노트로 만들기",
"save_suggestion_cancel": "취소",
"save_suggestion_failed": "저장에 실패했어요. 다시 시도해 주세요."
```

For `en`:

```json
"save_suggestion_inserted_active": "Added to the current note",
"save_suggestion_target_prompt": "Where should I save this conversation?",
"save_suggestion_create_new": "Create new note",
"save_suggestion_cancel": "Cancel",
"save_suggestion_failed": "Save failed. Please try again."
```

- [ ] **Step 4: Create chat namespace**

Create `apps/web/messages/ko/chat.json`:

```json
{
  "renderer": {
    "copy": "복사",
    "copied": "복사됨",
    "mermaid_loading": "다이어그램을 그리는 중…",
    "mermaid_error": "다이어그램을 그릴 수 없습니다",
    "code_language_label": "{lang}"
  }
}
```

Create `apps/web/messages/en/chat.json`:

```json
{
  "renderer": {
    "copy": "Copy",
    "copied": "Copied",
    "mermaid_loading": "Rendering diagram…",
    "mermaid_error": "Cannot render diagram",
    "code_language_label": "{lang}"
  }
}
```

- [ ] **Step 5: Register the chat namespace**

Locate the i18n loader (likely `apps/web/src/i18n/request.ts` — search for `agent-panel.json`). Add `chat` to the namespace list. For example, if the file imports namespaces by listing them:

```ts
const namespaces = ["app", "common", "editor", "agent-panel", "chat", /* ... */];
```

If it uses dynamic imports, add a parallel `import` for `chat.json`.

- [ ] **Step 6: Run i18n parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: PASS (key counts match between ko and en).

- [ ] **Step 7: Commit**

```bash
git add apps/web/messages/ apps/web/src/i18n/
git commit -m "i18n(web): add Plan 2D editor blocks + chat renderer keys"
```

---

### Task 3: saveSuggestionSchema in packages/shared

**Files:**
- Modify or create: `packages/shared/src/agent.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Test: `packages/shared/src/agent.test.ts`

- [ ] **Step 1: Find existing agent-related shared types**

```bash
ls packages/shared/src/
grep -l "agent" packages/shared/src/*.ts 2>/dev/null
```

If `agent.ts` exists, append. If not, create new.

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { saveSuggestionSchema } from "./agent";

describe("saveSuggestionSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "My note",
      body_markdown: "# Hello\n\nworld",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional source_message_id", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "T",
      body_markdown: "x",
      source_message_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "",
      body_markdown: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty body_markdown", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "T",
      body_markdown: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "x".repeat(201),
      body_markdown: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid source_message_id", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "T",
      body_markdown: "x",
      source_message_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @opencairn/shared test --run agent
```

Expected: FAIL with `Cannot find module './agent'` or similar.

- [ ] **Step 4: Implement schema**

Create or append to `packages/shared/src/agent.ts`:

```ts
import { z } from "zod";

/**
 * Plan 2D — `save_suggestion` SSE chunk payload schema.
 *
 * Emitted by the agent runtime when it detects the conversation has
 * produced content worth persisting as a note. The web client renders
 * the existing `<SaveSuggestionCard>` and, on Save, runs the markdown
 * through `markdownToPlate` and inserts into the active note.
 *
 * `source_message_id` is optional because the stub generator (env-flagged)
 * doesn't track real message ids in the same shape.
 */
export const saveSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  body_markdown: z.string().min(1),
  source_message_id: z.string().uuid().optional(),
});

export type SaveSuggestion = z.infer<typeof saveSuggestionSchema>;
```

- [ ] **Step 5: Re-export from index**

Open `packages/shared/src/index.ts` and add (in alphabetical order with existing exports):

```ts
export { saveSuggestionSchema, type SaveSuggestion } from "./agent";
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @opencairn/shared test --run agent
```

Expected: 6 passing.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/agent.ts packages/shared/src/agent.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add saveSuggestionSchema for Plan 2D"
```

---

### Task 4: Active editor instance store

**Files:**
- Create: `apps/web/src/stores/activeEditorStore.ts`
- Test: `apps/web/src/stores/activeEditorStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/stores/activeEditorStore.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useActiveEditorStore } from "./activeEditorStore";

describe("activeEditorStore", () => {
  beforeEach(() => {
    useActiveEditorStore.setState({ editors: new Map() });
  });

  it("registers an editor by noteId", () => {
    const fakeEditor = { id: "ed-1" } as never;
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);
    expect(useActiveEditorStore.getState().getEditor("note-1")).toBe(fakeEditor);
  });

  it("returns undefined for an unknown noteId", () => {
    expect(useActiveEditorStore.getState().getEditor("missing")).toBeUndefined();
  });

  it("removes an editor", () => {
    const fakeEditor = { id: "ed-1" } as never;
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);
    useActiveEditorStore.getState().removeEditor("note-1");
    expect(useActiveEditorStore.getState().getEditor("note-1")).toBeUndefined();
  });

  it("supports multiple concurrent editors", () => {
    const a = { id: "a" } as never;
    const b = { id: "b" } as never;
    useActiveEditorStore.getState().setEditor("n-a", a);
    useActiveEditorStore.getState().setEditor("n-b", b);
    expect(useActiveEditorStore.getState().getEditor("n-a")).toBe(a);
    expect(useActiveEditorStore.getState().getEditor("n-b")).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run activeEditorStore
```

Expected: FAIL — `Cannot find module './activeEditorStore'`.

- [ ] **Step 3: Implement store**

Create `apps/web/src/stores/activeEditorStore.ts`:

```ts
import { create } from "zustand";
import type { PlateEditor } from "platejs/react";

// Plan 2D — registry of currently mounted Plate editors keyed by noteId.
// Used by `insertFromSaveSuggestion` to grab the editor for the active
// tab without prop-drilling through the agent panel. Each NoteEditor
// registers on mount and removes on unmount; leaks would surface as a
// growing Map (the test guards against that).
interface ActiveEditorState {
  editors: Map<string, PlateEditor>;
  setEditor: (noteId: string, editor: PlateEditor) => void;
  getEditor: (noteId: string) => PlateEditor | undefined;
  removeEditor: (noteId: string) => void;
}

export const useActiveEditorStore = create<ActiveEditorState>((set, get) => ({
  editors: new Map(),
  setEditor: (noteId, editor) => {
    const next = new Map(get().editors);
    next.set(noteId, editor);
    set({ editors: next });
  },
  getEditor: (noteId) => get().editors.get(noteId),
  removeEditor: (noteId) => {
    const next = new Map(get().editors);
    next.delete(noteId);
    set({ editors: next });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run activeEditorStore
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/activeEditorStore.ts apps/web/src/stores/activeEditorStore.test.ts
git commit -m "feat(web): add active editor store for save_suggestion routing"
```

---

## Phase B — Markdown Utility

### Task 5: markdown-to-plate skeleton + GFM tests

**Files:**
- Create: `apps/web/src/lib/markdown/markdown-to-plate.ts`
- Test: `apps/web/src/lib/markdown/markdown-to-plate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/markdown/markdown-to-plate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markdownToPlate } from "./markdown-to-plate";

describe("markdownToPlate — GFM basics", () => {
  it("returns a single empty paragraph for empty input", () => {
    const result = markdownToPlate("");
    expect(result).toEqual([{ type: "p", children: [{ text: "" }] }]);
  });

  it("converts a heading", () => {
    const result = markdownToPlate("# Hello");
    expect(result[0]).toMatchObject({ type: "h1" });
    expect(result[0].children?.[0]?.text).toBe("Hello");
  });

  it("converts a paragraph", () => {
    const result = markdownToPlate("Hello world");
    expect(result[0]).toMatchObject({ type: "p" });
    expect(result[0].children?.[0]?.text).toBe("Hello world");
  });

  it("converts a fenced code block (no lang)", () => {
    const result = markdownToPlate("```\nconst x = 1;\n```");
    expect(result[0]).toMatchObject({ type: "code_block" });
  });

  it("converts a bulleted list", () => {
    const result = markdownToPlate("- a\n- b");
    // @platejs/markdown produces indent-based list elements; both items
    // surface as paragraphs with `listStyleType: "disc"`.
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("does not throw on malformed markdown", () => {
    expect(() => markdownToPlate("# Heading\n```js\nunterminated")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run markdown-to-plate
```

Expected: FAIL — `Cannot find module './markdown-to-plate'`.

- [ ] **Step 3: Implement skeleton**

Create `apps/web/src/lib/markdown/markdown-to-plate.ts`:

```ts
import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor } from "platejs";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes";
import { CodeBlockPlugin, CodeLinePlugin } from "@platejs/code-block";
import { ListPlugin } from "@platejs/list";

// Plan 2D — Markdown → Plate v49 Value converter.
//
// Used by:
//   1. The chat → editor save_suggestion flow (insert markdown body
//      from a chat into the active Plate editor).
//   2. Future: import flow for Notion ZIP / Drive .md files.
//
// The deserializer is a one-shot Slate editor we throw away after each
// call — no UI dependency, so this can run inside server actions /
// non-DOM tests without jsdom. Custom post-processing (mermaid /
// callout) runs after the standard Plate AST is built, walking the
// tree exactly once.
//
// Returns Plate `Value` (Element[]). Always has at least one element
// (empty paragraph for empty/blank input) so callers don't need to
// special-case "did the parse return nothing?".

type PlateNode = {
  type?: string;
  lang?: string;
  children?: PlateNode[];
  text?: string;
  [key: string]: unknown;
};

const deserializerPlugins = [
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
  CodeBlockPlugin,
  CodeLinePlugin,
  MarkdownPlugin,
];

export function markdownToPlate(markdown: string): PlateNode[] {
  if (!markdown || !markdown.trim()) {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  let value: PlateNode[] = [];
  try {
    const editor = createSlateEditor({
      plugins: deserializerPlugins,
      value: [{ type: "p", children: [{ text: "" }] }],
    });
    value = editor.api.markdown.deserialize(markdown) as PlateNode[];
  } catch {
    // Defensive: the deserializer can throw on extreme malformed input
    // (unbalanced HTML, exotic punctuation). Fall back to a single
    // paragraph holding the raw text rather than crashing the caller.
    return [{ type: "p", children: [{ text: markdown }] }];
  }

  if (!value || value.length === 0) {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run markdown-to-plate
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/markdown/markdown-to-plate.ts apps/web/src/lib/markdown/markdown-to-plate.test.ts
git commit -m "feat(web): add markdown-to-plate GFM converter"
```

---

### Task 6: markdown-to-plate mermaid post-processing

**Files:**
- Modify: `apps/web/src/lib/markdown/markdown-to-plate.ts`
- Modify: `apps/web/src/lib/markdown/markdown-to-plate.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `markdown-to-plate.test.ts`:

```ts
describe("markdownToPlate — mermaid post-processing", () => {
  it("converts a ```mermaid fenced code block to a mermaid element", () => {
    const result = markdownToPlate("```mermaid\ngraph TD\nA --> B\n```");
    expect(result[0]).toMatchObject({
      type: "mermaid",
      code: "graph TD\nA --> B",
    });
    expect(result[0].children).toEqual([{ text: "" }]);
  });

  it("leaves non-mermaid code blocks untouched", () => {
    const result = markdownToPlate("```js\nconst x = 1;\n```");
    expect(result[0]).toMatchObject({ type: "code_block" });
    expect(result[0].type).not.toBe("mermaid");
  });

  it("handles multiple mermaid blocks interleaved with prose", () => {
    const md = "intro\n\n```mermaid\nA-->B\n```\n\nmiddle\n\n```mermaid\nC-->D\n```";
    const result = markdownToPlate(md);
    const mermaidBlocks = result.filter((n) => n.type === "mermaid");
    expect(mermaidBlocks).toHaveLength(2);
    expect(mermaidBlocks[0].code).toBe("A-->B");
    expect(mermaidBlocks[1].code).toBe("C-->D");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run markdown-to-plate
```

Expected: 3 new tests FAIL (the 6 GFM still pass).

- [ ] **Step 3: Implement post-processing**

In `markdown-to-plate.ts`, add a private helper and call it before returning:

```ts
function joinCodeLines(node: PlateNode): string {
  // Plate code_block has children of type code_line, each with a single text leaf.
  if (!node.children) return "";
  return node.children
    .map((line) => line.children?.[0]?.text ?? "")
    .join("\n");
}

function postprocessMermaid(nodes: PlateNode[]): PlateNode[] {
  return nodes.map((n) => {
    if (n.type === "code_block" && (n.lang === "mermaid" || n.lang === "Mermaid")) {
      return {
        type: "mermaid",
        code: joinCodeLines(n),
        children: [{ text: "" }],
      };
    }
    return n;
  });
}
```

Update the `markdownToPlate` function — change the final return to:

```ts
  return postprocessMermaid(value);
```

- [ ] **Step 4: Run test to verify all pass**

```bash
pnpm --filter @opencairn/web test --run markdown-to-plate
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/markdown/markdown-to-plate.ts apps/web/src/lib/markdown/markdown-to-plate.test.ts
git commit -m "feat(web): convert ```mermaid fences into mermaid elements"
```

---

### Task 7: markdown-to-plate callout post-processing

**Files:**
- Modify: `apps/web/src/lib/markdown/markdown-to-plate.ts`
- Modify: `apps/web/src/lib/markdown/markdown-to-plate.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `markdown-to-plate.test.ts`:

```ts
describe("markdownToPlate — callout post-processing", () => {
  it("converts > [!info] blockquote to a callout element with kind=info", () => {
    const result = markdownToPlate("> [!info] hello");
    expect(result[0]).toMatchObject({ type: "callout", kind: "info" });
  });

  it("supports warn / tip / danger kinds", () => {
    const warn = markdownToPlate("> [!warn] caution");
    expect(warn[0]).toMatchObject({ type: "callout", kind: "warn" });

    const tip = markdownToPlate("> [!tip] hot tip");
    expect(tip[0]).toMatchObject({ type: "callout", kind: "tip" });

    const danger = markdownToPlate("> [!danger] do not");
    expect(danger[0]).toMatchObject({ type: "callout", kind: "danger" });
  });

  it("strips the [!kind] prefix from the first child paragraph", () => {
    const result = markdownToPlate("> [!info] hello world");
    const firstPara = result[0].children?.[0];
    const text = firstPara?.children?.[0]?.text;
    expect(text).toBe("hello world");
  });

  it("leaves a plain blockquote unchanged", () => {
    const result = markdownToPlate("> just a quote");
    expect(result[0].type).toBe("blockquote");
  });

  it("normalizes unknown kinds to 'info'", () => {
    const result = markdownToPlate("> [!whatever] hi");
    expect(result[0]).toMatchObject({ type: "callout", kind: "info" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run markdown-to-plate
```

Expected: 5 new tests FAIL.

- [ ] **Step 3: Implement post-processing**

In `markdown-to-plate.ts`, add another helper:

```ts
const CALLOUT_KINDS = ["info", "warn", "tip", "danger"] as const;
type CalloutKind = (typeof CALLOUT_KINDS)[number];

const CALLOUT_PREFIX_RE = /^\s*\[!(\w+)\]\s?(.*)$/;

function extractCalloutKind(node: PlateNode): {
  kind: CalloutKind;
  strippedFirstChild: PlateNode;
} | null {
  if (node.type !== "blockquote") return null;
  const firstChild = node.children?.[0];
  if (!firstChild) return null;
  const firstLeaf = firstChild.children?.[0];
  const text = firstLeaf?.text;
  if (typeof text !== "string") return null;
  const match = text.match(CALLOUT_PREFIX_RE);
  if (!match) return null;

  const rawKind = match[1].toLowerCase();
  const kind: CalloutKind = (CALLOUT_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as CalloutKind)
    : "info";
  const remaining = match[2];

  // Rebuild the first child with the prefix stripped.
  const newChildren = [
    { ...firstLeaf, text: remaining },
    ...(firstChild.children?.slice(1) ?? []),
  ];
  const strippedFirstChild: PlateNode = {
    ...firstChild,
    children: newChildren,
  };

  return { kind, strippedFirstChild };
}

function postprocessCallout(nodes: PlateNode[]): PlateNode[] {
  return nodes.map((n) => {
    const detected = extractCalloutKind(n);
    if (!detected) return n;
    const { kind, strippedFirstChild } = detected;
    const otherChildren = n.children?.slice(1) ?? [];
    return {
      type: "callout",
      kind,
      children: [strippedFirstChild, ...otherChildren],
    };
  });
}
```

Update the final return chain:

```ts
  return postprocessCallout(postprocessMermaid(value));
```

- [ ] **Step 4: Run test to verify all pass**

```bash
pnpm --filter @opencairn/web test --run markdown-to-plate
```

Expected: 14 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/markdown/markdown-to-plate.ts apps/web/src/lib/markdown/markdown-to-plate.test.ts
git commit -m "feat(web): convert > [!kind] blockquotes into callout elements"
```

---

### Task 8: shared-prose Tailwind tokens + sanitizeHtml

**Files:**
- Create: `apps/web/src/lib/markdown/shared-prose.ts`
- Create: `apps/web/src/lib/markdown/sanitize-html.ts`
- Test: `apps/web/src/lib/markdown/sanitize-html.test.ts`

- [ ] **Step 1: Create shared-prose.ts**

```ts
// Plan 2D — Tailwind class tokens shared between the editor's read view
// and the chat message renderer so blockquotes, code, tables, etc. look
// identical in both places. Keep this file dependency-free.

export const proseClasses = {
  /** Block-level paragraph spacing — applied at the renderer container. */
  body: "prose prose-sm dark:prose-invert max-w-none",
  /** Code block wrapper (NOT inline code). */
  codeBlock:
    "rounded-md border border-[color:var(--border)] bg-[color:var(--bg-muted)] text-xs font-mono leading-relaxed overflow-x-auto",
  /** Inline code mark. */
  codeInline:
    "rounded bg-[color:var(--bg-muted)] px-1 py-0.5 text-[0.85em] font-mono",
  /** Blockquote (default — no callout prefix). */
  blockquote:
    "border-l-2 border-[color:var(--border)] pl-3 italic text-[color:var(--fg-muted)]",
  /** GFM table wrapper. */
  table:
    "border-collapse text-sm [&_th]:border [&_th]:px-3 [&_th]:py-1 [&_td]:border [&_td]:px-3 [&_td]:py-1",
  /** Mermaid diagram container. */
  mermaidContainer:
    "my-2 flex items-center justify-center rounded border border-[color:var(--border)] bg-[color:var(--bg-base)] p-2",
  /** Callout per-kind border classes. */
  calloutBorder: {
    info: "border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/30",
    warn: "border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30",
    tip: "border-l-4 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
    danger: "border-l-4 border-red-400 bg-red-50 dark:bg-red-950/30",
  },
} as const;

export type CalloutKind = keyof typeof proseClasses.calloutBorder;
```

- [ ] **Step 2: Write the sanitize-html failing test**

Create `apps/web/src/lib/markdown/sanitize-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("removes <script> tags", () => {
    expect(sanitizeHtml("<script>alert(1)</script>hi")).toBe("hi");
  });

  it("removes inline event handlers", () => {
    expect(sanitizeHtml('<a href="x" onclick="bad()">link</a>')).not.toContain(
      "onclick",
    );
  });

  it("removes <iframe>", () => {
    expect(sanitizeHtml("<iframe src=evil></iframe>x")).toBe("x");
  });

  it("preserves common GFM markup", () => {
    const out = sanitizeHtml("<strong>bold</strong> <em>i</em>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<em>");
  });

  it("preserves whitelisted SVG", () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
    const out = sanitizeHtml(svg);
    expect(out).toContain("<svg");
    expect(out).toContain("<circle");
  });

  it("strips javascript: protocol from href", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run sanitize-html
```

Expected: FAIL — `Cannot find module './sanitize-html'`.

- [ ] **Step 4: Implement sanitize-html**

Create `apps/web/src/lib/markdown/sanitize-html.ts`:

```ts
import DOMPurify from "isomorphic-dompurify";

// Plan 2D — DOMPurify wrapper used by the chat renderer before
// react-markdown processes the body. We keep a small whitelist of GFM
// tags + SVG (no <script>, <iframe>, <object>, <embed>, no inline
// event handlers, no javascript: hrefs).
//
// Why not let react-markdown do this on its own? `react-markdown`
// doesn't render raw HTML by default, but `rehype-raw` (which we need
// for inline SVG and HTML embedded in agent responses) does. So we
// sanitize the input string before it ever reaches the markdown
// pipeline — defense in depth on top of `rehype-raw`'s own filter.

const ALLOWED_TAGS = [
  // GFM
  "p", "br", "strong", "em", "u", "s", "del", "code", "pre",
  "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "hr", "a",
  "table", "thead", "tbody", "tr", "th", "td",
  // Inline math (KaTeX wraps in span)
  "span", "div",
  // SVG
  "svg", "g", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "title", "desc",
  "defs", "linearGradient", "radialGradient", "stop", "use",
  "symbol", "marker", "clipPath", "mask", "pattern",
  "foreignObject",
];

const ALLOWED_ATTRS = [
  // Common
  "class", "id", "role", "aria-label", "aria-hidden",
  "data-language", "data-katex",
  // Anchor
  "href", "target", "rel",
  // SVG
  "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "transform", "opacity", "fill-opacity", "stroke-opacity",
  "text-anchor", "dominant-baseline",
  "preserveAspectRatio", "xmlns", "xmlns:xlink",
];

export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#|\/):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    USE_PROFILES: { svg: true, html: true },
  });
}
```

- [ ] **Step 5: Run test to verify all pass**

```bash
pnpm --filter @opencairn/web test --run sanitize-html
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/markdown/shared-prose.ts apps/web/src/lib/markdown/sanitize-html.ts apps/web/src/lib/markdown/sanitize-html.test.ts
git commit -m "feat(web): add shared prose tokens + DOMPurify sanitizer"
```

---

## Phase C — Editor Blocks

### Task 9: Mermaid block + useMermaidRender hook

**Files:**
- Create: `apps/web/src/hooks/useMermaidRender.ts`
- Create: `apps/web/src/components/editor/blocks/mermaid/mermaid-plugin.tsx`
- Create: `apps/web/src/components/editor/blocks/mermaid/mermaid-element.tsx`
- Test: `apps/web/src/components/editor/blocks/mermaid/mermaid-element.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/components/editor/blocks/mermaid/mermaid-element.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/editor.json";
import { MermaidElement } from "./mermaid-element";

vi.mock("@/hooks/useMermaidRender", () => ({
  useMermaidRender: (code: string) => ({
    svg: code === "BAD" ? null : `<svg data-testid="rendered-svg">${code}</svg>`,
    error: code === "BAD" ? new Error("parse fail") : null,
    loading: false,
  }),
}));

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
    {ui}
  </NextIntlClientProvider>
);

describe("MermaidElement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders SVG when code parses", async () => {
    render(
      wrap(
        <MermaidElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{ type: "mermaid", code: "graph TD\nA --> B", children: [{ text: "" }] }}
        >
          <span />
        </MermaidElement>,
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId("rendered-svg")).toBeInTheDocument();
    });
  });

  it("renders error UI when parse fails", () => {
    render(
      wrap(
        <MermaidElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{ type: "mermaid", code: "BAD", children: [{ text: "" }] }}
        >
          <span />
        </MermaidElement>,
      ),
    );
    expect(screen.getByText(/다이어그램 오류/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run mermaid-element
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement useMermaidRender hook**

Create `apps/web/src/hooks/useMermaidRender.ts`:

```ts
"use client";
import { useEffect, useState, useRef } from "react";

// Plan 2D — Lazy mermaid loader + render. Used by both the editor's
// MermaidElement and the chat MermaidChat renderer so visual output
// is identical in both places.
//
// Mermaid is heavy (~250kB gzipped) and SSR-hostile (touches `window`
// during init), so we never import it eagerly. The first call to this
// hook in the page lifecycle resolves a singleton import promise.

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import("mermaid").then((mod) => {
    const m = mod.default;
    m.initialize({
      startOnLoad: false,
      theme:
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
          ? "dark"
          : "default",
      securityLevel: "strict",
    });
    return m;
  });
  return mermaidPromise;
}

interface UseMermaidResult {
  svg: string | null;
  error: Error | null;
  loading: boolean;
}

export function useMermaidRender(code: string): UseMermaidResult {
  const [state, setState] = useState<UseMermaidResult>({
    svg: null,
    error: null,
    loading: true,
  });
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    setState({ svg: null, error: null, loading: true });

    if (!code.trim()) {
      setState({ svg: null, error: null, loading: false });
      return;
    }

    loadMermaid()
      .then((m) => m.render(idRef.current, code))
      .then((res) => {
        if (cancelled) return;
        setState({ svg: res.svg, error: null, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          svg: null,
          error: err instanceof Error ? err : new Error("render failed"),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  return state;
}
```

- [ ] **Step 4: Implement MermaidElement**

Create `apps/web/src/components/editor/blocks/mermaid/mermaid-element.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlateElementProps } from "platejs/react";
import { useMermaidRender } from "@/hooks/useMermaidRender";
import { proseClasses } from "@/lib/markdown/shared-prose";

interface MermaidElementProps extends PlateElementProps {
  element: {
    type: "mermaid";
    code: string;
    children: [{ text: "" }];
  };
}

export function MermaidElement({
  attributes,
  children,
  element,
}: MermaidElementProps) {
  const t = useTranslations("editor.blocks.mermaid");
  const [showSource, setShowSource] = useState(false);
  const { svg, error, loading } = useMermaidRender(element.code);

  return (
    <div
      {...attributes}
      contentEditable={false}
      className="my-2 group relative"
      data-testid="mermaid-block"
    >
      {/* Slate requires void elements to render `children` for selection. */}
      <span style={{ display: "none" }}>{children}</span>

      {error ? (
        <div
          className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950/30"
          data-testid="mermaid-error"
        >
          <div className="font-medium text-red-700 dark:text-red-300">
            {t("error_title")}
          </div>
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">
            {t("error_help")}
          </div>
          <pre className="mt-2 overflow-x-auto text-xs">
            <code>{element.code}</code>
          </pre>
        </div>
      ) : loading ? (
        <div className={proseClasses.mermaidContainer}>
          <span className="text-xs text-[color:var(--fg-muted)]">…</span>
        </div>
      ) : (
        <div
          className={proseClasses.mermaidContainer}
          dangerouslySetInnerHTML={{ __html: svg ?? "" }}
        />
      )}

      <button
        type="button"
        onClick={() => setShowSource((v) => !v)}
        className="absolute right-1 top-1 rounded bg-[color:var(--bg-base)] px-2 py-0.5 text-xs opacity-0 group-hover:opacity-100"
        data-testid="mermaid-toggle-source"
      >
        {showSource ? t("hide_source") : t("show_source")}
      </button>

      {showSource && (
        <pre className="mt-2 overflow-x-auto rounded bg-[color:var(--bg-muted)] p-2 text-xs">
          <code>{element.code}</code>
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement MermaidPlugin**

Create `apps/web/src/components/editor/blocks/mermaid/mermaid-plugin.tsx`:

```tsx
"use client";
import { createPlatePlugin } from "platejs/react";
import { MermaidElement } from "./mermaid-element";

// Plan 2D — Mermaid void block.
//
// Element shape: { type: 'mermaid', code: string, children: [{ text: '' }] }
//
// Insert via `editor.tf.insertNodes({ type: 'mermaid', code: '', children: [{ text: '' }] })`
// from the slash menu (Task 13) or the markdown fence autoformat (Task 14).
export const MermaidPlugin = createPlatePlugin({
  key: "mermaid",
  node: { isElement: true, isVoid: true, type: "mermaid" },
}).withComponent(MermaidElement);
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run mermaid-element
```

Expected: 2 passing.

- [ ] **Step 7: Register plugin in NoteEditor**

In `apps/web/src/components/editor/NoteEditor.tsx`, add the import and append to `basePlugins`:

```tsx
import { MermaidPlugin } from "./blocks/mermaid/mermaid-plugin";

// ...
const basePlugins = [
  // ... existing ...
  MermaidPlugin,
];
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hooks/useMermaidRender.ts apps/web/src/components/editor/blocks/mermaid/ apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): add Mermaid block plugin + lazy render hook"
```

---

### Task 10: Callout block (4-type cycle toggle)

**Files:**
- Create: `apps/web/src/components/editor/blocks/callout/callout-plugin.tsx`
- Create: `apps/web/src/components/editor/blocks/callout/callout-element.tsx`
- Test: `apps/web/src/components/editor/blocks/callout/callout-element.test.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx` (register plugin)

- [ ] **Step 1: Write failing test**

Create `apps/web/src/components/editor/blocks/callout/callout-element.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/editor.json";
import { CalloutElement } from "./callout-element";

const setNodes = vi.fn();
vi.mock("platejs/react", async () => {
  const real = await vi.importActual<typeof import("platejs/react")>(
    "platejs/react",
  );
  return {
    ...real,
    useEditorRef: () => ({
      tf: { setNodes },
      api: { findPath: () => [0] },
    }),
  };
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
    {ui}
  </NextIntlClientProvider>
);

describe("CalloutElement", () => {
  it("renders kind=info icon by default", () => {
    render(
      wrap(
        <CalloutElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{
            type: "callout",
            kind: "info",
            children: [{ type: "p", children: [{ text: "x" }] }],
          }}
        >
          <p>x</p>
        </CalloutElement>,
      ),
    );
    expect(screen.getByTestId("callout-kind-button")).toHaveAttribute(
      "data-kind",
      "info",
    );
  });

  it("cycles to next kind on icon click (info → warn)", () => {
    setNodes.mockClear();
    render(
      wrap(
        <CalloutElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{
            type: "callout",
            kind: "info",
            children: [{ type: "p", children: [{ text: "x" }] }],
          }}
        >
          <p>x</p>
        </CalloutElement>,
      ),
    );
    fireEvent.mouseDown(screen.getByTestId("callout-kind-button"));
    expect(setNodes).toHaveBeenCalledWith(
      { kind: "warn" },
      expect.objectContaining({ at: [0] }),
    );
  });

  it("cycles danger → info (wraps)", () => {
    setNodes.mockClear();
    render(
      wrap(
        <CalloutElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{
            type: "callout",
            kind: "danger",
            children: [{ type: "p", children: [{ text: "x" }] }],
          }}
        >
          <p>x</p>
        </CalloutElement>,
      ),
    );
    fireEvent.mouseDown(screen.getByTestId("callout-kind-button"));
    expect(setNodes).toHaveBeenCalledWith(
      { kind: "info" },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run callout-element
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement CalloutElement**

Create `apps/web/src/components/editor/blocks/callout/callout-element.tsx`:

```tsx
"use client";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { proseClasses, type CalloutKind } from "@/lib/markdown/shared-prose";

const ICONS: Record<CalloutKind, LucideIcon> = {
  info: Info,
  warn: AlertTriangle,
  tip: Lightbulb,
  danger: AlertOctagon,
};

const CYCLE: CalloutKind[] = ["info", "warn", "tip", "danger"];

interface CalloutElementProps extends PlateElementProps {
  element: {
    type: "callout";
    kind: CalloutKind;
    children: unknown[];
  };
}

export function CalloutElement({
  attributes,
  children,
  element,
}: CalloutElementProps) {
  const t = useTranslations("editor.blocks.callout");
  const editor = useEditorRef();
  const Icon = ICONS[element.kind];

  const cycle = () => {
    const idx = CYCLE.indexOf(element.kind);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    const path = editor.api.findPath(element as never);
    editor.tf.setNodes({ kind: next }, { at: path });
  };

  return (
    <div
      {...attributes}
      className={`my-2 flex gap-2 rounded p-3 ${proseClasses.calloutBorder[element.kind]}`}
      data-testid={`callout-${element.kind}`}
    >
      <button
        type="button"
        contentEditable={false}
        onMouseDown={(e) => {
          // Prevent selection loss before mutating.
          e.preventDefault();
          cycle();
        }}
        aria-label={t(element.kind)}
        data-testid="callout-kind-button"
        data-kind={element.kind}
        className="mt-0.5 shrink-0 hover:opacity-70"
      >
        <Icon className="h-4 w-4" />
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Implement CalloutPlugin**

Create `apps/web/src/components/editor/blocks/callout/callout-plugin.tsx`:

```tsx
"use client";
import { createPlatePlugin } from "platejs/react";
import { CalloutElement } from "./callout-element";

// Plan 2D — Callout block (info / warn / tip / danger).
// Element shape: { type: 'callout', kind: CalloutKind, children: [...] }
export const CalloutPlugin = createPlatePlugin({
  key: "callout",
  node: { isElement: true, type: "callout" },
}).withComponent(CalloutElement);
```

- [ ] **Step 5: Register in NoteEditor**

Add to `basePlugins`:

```tsx
import { CalloutPlugin } from "./blocks/callout/callout-plugin";
// ...
const basePlugins = [
  // ...
  CalloutPlugin,
];
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run callout-element
```

Expected: 3 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/blocks/callout/ apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): add Callout block with 4-kind cycle toggle"
```

---

### Task 11: Toggle block (collapsible)

**Files:**
- Create: `apps/web/src/components/editor/blocks/toggle/toggle-plugin.tsx`
- Create: `apps/web/src/components/editor/blocks/toggle/toggle-element.tsx`
- Test: `apps/web/src/components/editor/blocks/toggle/toggle-element.test.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/components/editor/blocks/toggle/toggle-element.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleElement } from "./toggle-element";

const setNodes = vi.fn();
vi.mock("platejs/react", async () => {
  const real = await vi.importActual<typeof import("platejs/react")>(
    "platejs/react",
  );
  return {
    ...real,
    useEditorRef: () => ({
      tf: { setNodes },
      api: { findPath: () => [0] },
    }),
  };
});

describe("ToggleElement", () => {
  it("hides body when open=false", () => {
    render(
      <ToggleElement
        attributes={{ "data-slate-node": "element" } as never}
        element={{
          type: "toggle",
          open: false,
          children: [
            { type: "p", children: [{ text: "summary" }] },
            { type: "p", children: [{ text: "body" }] },
          ],
        }}
      >
        <p>summary</p>
        <p>body</p>
      </ToggleElement>,
    );
    expect(screen.queryByTestId("toggle-body")).toBeNull();
  });

  it("shows body when open=true", () => {
    render(
      <ToggleElement
        attributes={{ "data-slate-node": "element" } as never}
        element={{
          type: "toggle",
          open: true,
          children: [
            { type: "p", children: [{ text: "summary" }] },
            { type: "p", children: [{ text: "body" }] },
          ],
        }}
      >
        <p>summary</p>
        <p>body</p>
      </ToggleElement>,
    );
    expect(screen.getByTestId("toggle-body")).toBeInTheDocument();
  });

  it("toggles on chevron click", () => {
    setNodes.mockClear();
    render(
      <ToggleElement
        attributes={{ "data-slate-node": "element" } as never}
        element={{
          type: "toggle",
          open: false,
          children: [{ type: "p", children: [{ text: "x" }] }],
        }}
      >
        <p>x</p>
      </ToggleElement>,
    );
    fireEvent.mouseDown(screen.getByTestId("toggle-chevron"));
    expect(setNodes).toHaveBeenCalledWith(
      { open: true },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run toggle-element
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ToggleElement**

Create `apps/web/src/components/editor/blocks/toggle/toggle-element.tsx`:

```tsx
"use client";
import { ChevronRight } from "lucide-react";
import { useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { Children, isValidElement, type ReactNode } from "react";

interface ToggleElementProps extends PlateElementProps {
  element: {
    type: "toggle";
    open?: boolean;
    children: unknown[];
  };
}

export function ToggleElement({
  attributes,
  children,
  element,
}: ToggleElementProps) {
  const editor = useEditorRef();
  const isOpen = element.open ?? false;

  const toggle = () => {
    const path = editor.api.findPath(element as never);
    editor.tf.setNodes({ open: !isOpen }, { at: path });
  };

  // Slate passes one child per element child as a React element. The first
  // entry is the summary, the rest are the body. Splitting via Children.toArray
  // keeps Slate's selection wiring intact (we never render outside `children`).
  const childArray = Children.toArray(children) as ReactNode[];
  const [summary, ...body] = childArray;

  return (
    <div {...attributes} className="my-1 group" data-testid="toggle-block">
      <div className="flex items-start gap-1">
        <button
          type="button"
          contentEditable={false}
          onMouseDown={(e) => {
            e.preventDefault();
            toggle();
          }}
          data-testid="toggle-chevron"
          aria-expanded={isOpen}
          className="mt-1 shrink-0 hover:bg-[color:var(--bg-muted)] rounded p-0.5"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </button>
        <div className="flex-1">{summary}</div>
      </div>
      {isOpen && body.length > 0 && (
        <div data-testid="toggle-body" className="ml-5 border-l border-[color:var(--border)] pl-3 mt-1">
          {body.map((child, i) =>
            isValidElement(child) ? <div key={i}>{child}</div> : child,
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement TogglePlugin**

Create `apps/web/src/components/editor/blocks/toggle/toggle-plugin.tsx`:

```tsx
"use client";
import { createPlatePlugin } from "platejs/react";
import { ToggleElement } from "./toggle-element";

export const TogglePlugin = createPlatePlugin({
  key: "toggle",
  node: { isElement: true, type: "toggle" },
}).withComponent(ToggleElement);
```

- [ ] **Step 5: Register in NoteEditor**

Add to imports and `basePlugins`:

```tsx
import { TogglePlugin } from "./blocks/toggle/toggle-plugin";
// ...
const basePlugins = [
  // ...
  TogglePlugin,
];
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run toggle-element
```

Expected: 3 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/blocks/toggle/ apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): add Toggle block (collapsible summary + body)"
```

---

### Task 12: Table block (@platejs/table wrapper)

**Files:**
- Create: `apps/web/src/components/editor/blocks/table/table-plugin.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Implement TablePlugin**

`@platejs/table` ships a fully working table — we expose it under the existing block conventions.

Create `apps/web/src/components/editor/blocks/table/table-plugin.tsx`:

```tsx
"use client";
import {
  TablePlugin as BaseTablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
} from "@platejs/table/react";

// Plan 2D — Table block. The official @platejs/table plugins handle node
// shape, row/col operations, and selection. We register them as-is for
// now; row/col context menus + header toggle land in a follow-up task.
export const tablePlugins = [
  BaseTablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
];
```

- [ ] **Step 2: Register in NoteEditor**

```tsx
import { tablePlugins } from "./blocks/table/table-plugin";

const basePlugins = [
  // ...
  ...tablePlugins,
];
```

- [ ] **Step 3: Verify build still works**

```bash
pnpm --filter @opencairn/web test --run NoteEditor
pnpm --filter @opencairn/web build 2>&1 | tail -20
```

Expected: tests pass, build completes (or catches a Plate compatibility issue early).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/blocks/table/ apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): register @platejs/table plugins for table block"
```

---

### Task 13: Columns block (@platejs/layout wrapper)

**Files:**
- Create: `apps/web/src/components/editor/blocks/columns/columns-plugin.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Inspect @platejs/layout exports**

Run:

```bash
cat node_modules/@platejs/layout/dist/react/index.d.ts 2>/dev/null | head -40
```

Expected: an export list including `ColumnPlugin`, `ColumnGroupPlugin` (or similar). If the package layout differs, adjust the import in Step 2.

- [ ] **Step 2: Implement ColumnsPlugin**

Create `apps/web/src/components/editor/blocks/columns/columns-plugin.tsx`:

```tsx
"use client";
import { ColumnPlugin, ColumnGroupPlugin } from "@platejs/layout/react";

// Plan 2D — Columns layout block. @platejs/layout already provides the
// element types and transforms; we expose them as a single registration
// array, mirroring the table-plugin pattern.
//
// Insert via the slash menu (Task 14) which calls
//   editor.tf.insertNodes({
//     type: 'column-group',
//     children: [<column>, <column>],
//   })
export const columnsPlugins = [ColumnGroupPlugin, ColumnPlugin];
```

- [ ] **Step 3: Register in NoteEditor**

```tsx
import { columnsPlugins } from "./blocks/columns/columns-plugin";

const basePlugins = [
  // ...
  ...columnsPlugins,
];
```

- [ ] **Step 4: Verify build**

```bash
pnpm --filter @opencairn/web test --run NoteEditor
pnpm --filter @opencairn/web build 2>&1 | tail -10
```

Expected: tests pass, build completes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/blocks/columns/ apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): register @platejs/layout column plugins"
```

---

## Phase D — Editor Integration

### Task 14: Slash menu — 5 new commands

**Files:**
- Modify: `apps/web/src/components/editor/plugins/slash.tsx`

- [ ] **Step 1: Extend SlashKey + COMMANDS + i18n labelKey union**

In `apps/web/src/components/editor/plugins/slash.tsx`, modify:

Replace the `SlashKey` type (line ~38):

```ts
export type SlashKey =
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "blockquote"
  | "code"
  | "hr"
  | "mermaid"
  | "callout"
  | "toggle"
  | "table"
  | "columns";
```

Replace the `SlashCommandDef.labelKey` union:

```ts
interface SlashCommandDef {
  key: SlashKey;
  labelKey:
    | "heading_1"
    | "heading_2"
    | "heading_3"
    | "bulleted_list"
    | "numbered_list"
    | "quote"
    | "code"
    | "divider"
    | "mermaid"
    | "callout"
    | "toggle"
    | "table"
    | "columns";
}
```

Replace `COMMANDS`:

```ts
const COMMANDS: SlashCommandDef[] = [
  { key: "h1", labelKey: "heading_1" },
  { key: "h2", labelKey: "heading_2" },
  { key: "h3", labelKey: "heading_3" },
  { key: "ul", labelKey: "bulleted_list" },
  { key: "ol", labelKey: "numbered_list" },
  { key: "blockquote", labelKey: "quote" },
  { key: "code", labelKey: "code" },
  { key: "hr", labelKey: "divider" },
  { key: "mermaid", labelKey: "mermaid" },
  { key: "callout", labelKey: "callout" },
  { key: "toggle", labelKey: "toggle" },
  { key: "table", labelKey: "table" },
  { key: "columns", labelKey: "columns" },
];
```

- [ ] **Step 2: Extend SlashEditor type**

Replace the `SlashEditor` interface:

```ts
export interface SlashEditor {
  tf: {
    insertNodes: (
      node: unknown,
      options?: { select?: boolean },
    ) => void;
    insertText?: (text: string) => void;
    deleteBackward: (unit: "character" | "word" | "line" | "block") => void;
    code?: { toggle: () => void };
    h1?: { toggle: () => void };
    h2?: { toggle: () => void };
    h3?: { toggle: () => void };
    blockquote?: { toggle: () => void };
  };
}
```

(No changes needed — we use `insertNodes` for the new blocks. Listed for reference.)

- [ ] **Step 3: Extend the runCommand switch**

In `runCommand` (after the existing `case "hr":` block), add:

```ts
        case "mermaid":
          editor.tf.insertNodes(
            { type: "mermaid", code: "", children: [{ text: "" }] },
            { select: true },
          );
          editor.tf.insertNodes(
            { type: "p", children: [{ text: "" }] },
            { select: true },
          );
          break;
        case "callout":
          editor.tf.insertNodes(
            {
              type: "callout",
              kind: "info",
              children: [{ type: "p", children: [{ text: "" }] }],
            },
            { select: true },
          );
          break;
        case "toggle":
          editor.tf.insertNodes(
            {
              type: "toggle",
              open: true,
              children: [
                { type: "p", children: [{ text: "" }] },
                { type: "p", children: [{ text: "" }] },
              ],
            },
            { select: true },
          );
          break;
        case "table":
          editor.tf.insertNodes(
            {
              type: "table",
              children: [
                {
                  type: "tr",
                  children: [
                    { type: "th", children: [{ type: "p", children: [{ text: "" }] }] },
                    { type: "th", children: [{ type: "p", children: [{ text: "" }] }] },
                    { type: "th", children: [{ type: "p", children: [{ text: "" }] }] },
                  ],
                },
                {
                  type: "tr",
                  children: [
                    { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
                    { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
                    { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
                  ],
                },
                {
                  type: "tr",
                  children: [
                    { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
                    { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
                    { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
                  ],
                },
              ],
            },
            { select: true },
          );
          break;
        case "columns":
          editor.tf.insertNodes(
            {
              type: "column-group",
              children: [
                {
                  type: "column",
                  children: [{ type: "p", children: [{ text: "" }] }],
                },
                {
                  type: "column",
                  children: [{ type: "p", children: [{ text: "" }] }],
                },
              ],
            },
            { select: true },
          );
          break;
```

- [ ] **Step 4: Add visual divider between original 8 and new 5 (optional polish)**

Inside the menu render (the `<ul>` block), insert a separator after the 8th item:

```tsx
        <ul className="max-h-72 overflow-auto py-1">
          {items.map((cmd, i) => (
            <>
              {i === 8 && (
                <li
                  key={`sep-${i}`}
                  className="my-1 border-t border-[color:var(--border)]"
                  aria-hidden="true"
                />
              )}
              <li key={cmd.key}>
                {/* existing button */}
              </li>
            </>
          ))}
        </ul>
```

(Wrap the existing `<button>` in the `<li>` retained.)

- [ ] **Step 5: Run existing slash menu tests**

```bash
pnpm --filter @opencairn/web test --run slash
```

Expected: existing slash tests still pass; if any are pinned to "8 commands" length, update them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/plugins/slash.tsx
git commit -m "feat(web): extend slash menu with 5 Plan 2D blocks"
```

---

### Task 15: Mermaid fence autoformat

**Files:**
- Create: `apps/web/src/components/editor/plugins/mermaid-fence.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Implement the fence-detection plugin**

Create `apps/web/src/components/editor/plugins/mermaid-fence.tsx`:

```tsx
"use client";
import { createPlatePlugin } from "platejs/react";

// Plan 2D — When the user finishes a code block and its language is
// `mermaid`, transform it into our void Mermaid element. The rule fires
// in `change` (post-mutation) so the user can keep editing the block
// shell normally; only when they actually type ```mermaid does the
// swap occur.
//
// Why a custom plugin instead of `@platejs/autoformat`? Autoformat
// works on character triggers in a paragraph, not on whole-block lang
// changes. The simpler approach is a once-per-change scan that:
//   - finds top-level code_block nodes with lang === 'mermaid'
//   - replaces them with { type: 'mermaid', code: <joined lines> }
//
// The replacement is a single `replaceNodes` call so undo lands in one
// step, not three.

interface CodeLineNode {
  children?: { text?: string }[];
}
interface CodeBlockNode {
  type: "code_block";
  lang?: string;
  children?: CodeLineNode[];
}

function isMermaidCodeBlock(n: { type?: string; lang?: string }): n is CodeBlockNode {
  return n.type === "code_block" && (n.lang === "mermaid" || n.lang === "Mermaid");
}

function joinLines(node: CodeBlockNode): string {
  return (node.children ?? [])
    .map((line) => line.children?.[0]?.text ?? "")
    .join("\n");
}

export const MermaidFencePlugin = createPlatePlugin({
  key: "mermaid-fence",
  handlers: {
    onChange: ({ editor }) => {
      // Walk top-level only — mermaid blocks shouldn't appear inside lists
      // or tables, and recursion would slow the per-keystroke handler.
      const value = editor.children as unknown as Array<{
        type?: string;
        lang?: string;
        children?: unknown[];
      }>;
      for (let i = 0; i < value.length; i++) {
        const n = value[i] as CodeBlockNode;
        if (isMermaidCodeBlock(n)) {
          const code = joinLines(n);
          editor.tf.replaceNodes(
            { type: "mermaid", code, children: [{ text: "" }] },
            { at: [i] },
          );
        }
      }
    },
  },
});
```

- [ ] **Step 2: Register in NoteEditor**

```tsx
import { MermaidFencePlugin } from "./plugins/mermaid-fence";

const basePlugins = [
  // ...
  MermaidFencePlugin,
];
```

- [ ] **Step 3: Verify the editor still mounts**

```bash
pnpm --filter @opencairn/web test --run NoteEditor
```

Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/plugins/mermaid-fence.tsx apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): autoformat ```mermaid fences into mermaid blocks"
```

---

## Phase E — Chat Renderer

### Task 16: ChatMessageRenderer + CodeBlock + StreamingText

**Files:**
- Create: `apps/web/src/components/chat/chat-message-renderer.tsx`
- Create: `apps/web/src/components/chat/streaming-text.tsx`
- Create: `apps/web/src/components/chat/renderers/code-block.tsx`
- Test: `apps/web/src/components/chat/chat-message-renderer.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/components/chat/chat-message-renderer.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/chat.json";
import { ChatMessageRenderer } from "./chat-message-renderer";

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ chat: koMessages }}>
    {ui}
  </NextIntlClientProvider>
);

describe("ChatMessageRenderer", () => {
  it("renders a heading", () => {
    render(wrap(<ChatMessageRenderer body="# Hello" />));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("renders a fenced code block with language label", () => {
    render(wrap(<ChatMessageRenderer body="```js\nconst x = 1;\n```" />));
    expect(screen.getByTestId("code-block-lang")).toHaveTextContent("js");
  });

  it("renders a GFM table", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    render(wrap(<ChatMessageRenderer body={md} />));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("strips a <script> tag from raw HTML", () => {
    const md = "<script>alert(1)</script>safe";
    const { container } = render(wrap(<ChatMessageRenderer body={md} />));
    expect(container.innerHTML).not.toContain("<script>");
    expect(container.textContent).toContain("safe");
  });

  it("renders a streaming cursor when streaming=true", () => {
    render(wrap(<ChatMessageRenderer body="hi" streaming />));
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run chat-message-renderer
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement StreamingText**

Create `apps/web/src/components/chat/streaming-text.tsx`:

```tsx
"use client";

export function StreamingCursor() {
  return (
    <span
      data-testid="streaming-cursor"
      aria-hidden="true"
      className="ml-0.5 inline-block w-[2px] h-4 align-middle animate-pulse bg-[color:var(--fg-base)]"
    />
  );
}
```

- [ ] **Step 4: Implement CodeBlock renderer**

Create `apps/web/src/components/chat/renderers/code-block.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { proseClasses } from "@/lib/markdown/shared-prose";
import { MermaidChat } from "./mermaid-chat";

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const t = useTranslations("chat.renderer");
  const [copied, setCopied] = useState(false);

  if (inline) {
    return <code className={proseClasses.codeInline}>{children}</code>;
  }

  // react-markdown passes the language as `language-XXX` in className.
  const lang = (className?.match(/language-(\S+)/)?.[1] ?? "").toLowerCase();
  const code = String(children ?? "").replace(/\n$/, "");

  if (lang === "mermaid") {
    return <MermaidChat code={code} />;
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be denied — fail silently */
    }
  };

  return (
    <div className={`relative my-2 ${proseClasses.codeBlock}`}>
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-2 py-1 text-[0.7rem] text-[color:var(--fg-muted)]">
        <span data-testid="code-block-lang">{lang || "text"}</span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={t("copy")}
          className="inline-flex items-center gap-1 hover:text-[color:var(--fg-base)]"
          data-testid="code-block-copy"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t("copied")}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t("copy")}
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={oneDark}
        customStyle={{ margin: 0, padding: "0.75rem", background: "transparent" }}
        codeTagProps={{ style: { background: "transparent" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
```

- [ ] **Step 5: Stub MermaidChat (full impl in Task 17)**

Create `apps/web/src/components/chat/renderers/mermaid-chat.tsx` with a placeholder:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useMermaidRender } from "@/hooks/useMermaidRender";
import { proseClasses } from "@/lib/markdown/shared-prose";

interface MermaidChatProps {
  code: string;
}

export function MermaidChat({ code }: MermaidChatProps) {
  const t = useTranslations("chat.renderer");
  const { svg, error, loading } = useMermaidRender(code);

  if (loading) {
    return (
      <div className={proseClasses.mermaidContainer}>
        <span className="text-xs text-[color:var(--fg-muted)]">
          {t("mermaid_loading")}
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="rounded border border-red-400 bg-red-50 p-2 text-xs dark:bg-red-950/30"
        data-testid="mermaid-chat-error"
      >
        <div>{t("mermaid_error")}</div>
        <pre className="mt-1 overflow-x-auto">{code}</pre>
      </div>
    );
  }
  return (
    <div
      className={proseClasses.mermaidContainer}
      data-testid="mermaid-chat"
      dangerouslySetInnerHTML={{ __html: svg ?? "" }}
    />
  );
}
```

- [ ] **Step 6: Implement ChatMessageRenderer**

Create `apps/web/src/components/chat/chat-message-renderer.tsx`:

```tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { proseClasses } from "@/lib/markdown/shared-prose";
import { sanitizeHtml } from "@/lib/markdown/sanitize-html";
import { CodeBlock } from "./renderers/code-block";
import { StreamingCursor } from "./streaming-text";

interface ChatMessageRendererProps {
  body: string;
  /** True while the message is mid-stream — appends a blinking cursor. */
  streaming?: boolean;
}

export function ChatMessageRenderer({
  body,
  streaming,
}: ChatMessageRendererProps) {
  const safeBody = sanitizeHtml(body);
  return (
    <div className={proseClasses.body} data-testid="chat-message-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <table className={proseClasses.table}>{children}</table>
          ),
          blockquote: ({ children }) => (
            <blockquote className={proseClasses.blockquote}>{children}</blockquote>
          ),
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {safeBody}
      </ReactMarkdown>
      {streaming && <StreamingCursor />}
    </div>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run chat-message-renderer
```

Expected: 5 passing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/chat/
git commit -m "feat(web): add ChatMessageRenderer with code-block + streaming cursor"
```

---

### Task 17: Callout-aware blockquote (chat side)

> Note: ProseTable styling is already wired into ChatMessageRenderer in Task 16 via the `proseClasses.table` className mapping — no separate component is needed for tables in chat.

**Files:**
- Create: `apps/web/src/components/chat/renderers/callout-blockquote.tsx`
- Modify: `apps/web/src/components/chat/chat-message-renderer.tsx` (use new blockquote)
- Modify: `apps/web/src/components/chat/chat-message-renderer.test.tsx` (add test)

- [ ] **Step 1: Add the failing test**

Append to `chat-message-renderer.test.tsx`:

```tsx
describe("ChatMessageRenderer — callout-aware blockquote", () => {
  it("renders > [!info] as a styled callout", () => {
    render(wrap(<ChatMessageRenderer body="> [!info] hello" />));
    const el = screen.getByTestId("chat-callout-info");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
  });

  it("renders > [!warn] with warn styling", () => {
    render(wrap(<ChatMessageRenderer body="> [!warn] careful" />));
    expect(screen.getByTestId("chat-callout-warn")).toBeInTheDocument();
  });

  it("falls back to a plain blockquote without [!kind] prefix", () => {
    const { container } = render(wrap(<ChatMessageRenderer body="> just a quote" />));
    expect(container.querySelector("blockquote")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-callout-info")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run chat-message-renderer
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement CalloutBlockquote**

Create `apps/web/src/components/chat/renderers/callout-blockquote.tsx`:

```tsx
"use client";
import { Children, isValidElement, type ReactNode } from "react";
import { Info, AlertTriangle, Lightbulb, AlertOctagon } from "lucide-react";
import { proseClasses, type CalloutKind } from "@/lib/markdown/shared-prose";

const ICONS = {
  info: Info,
  warn: AlertTriangle,
  tip: Lightbulb,
  danger: AlertOctagon,
} as const;

const PREFIX_RE = /^\s*\[!(\w+)\]\s?(.*)$/s;

function detectKind(children: ReactNode): {
  kind: CalloutKind;
  withoutPrefix: ReactNode[];
} | null {
  const arr = Children.toArray(children);
  // The first element is usually a <p> wrapping the body. Inspect its first
  // text child for the [!kind] sentinel.
  const first = arr[0];
  if (!isValidElement(first)) return null;
  const innerArr = Children.toArray((first.props as { children?: ReactNode }).children ?? []);
  const firstInner = innerArr[0];
  if (typeof firstInner !== "string") return null;
  const match = firstInner.match(PREFIX_RE);
  if (!match) return null;

  const rawKind = match[1].toLowerCase();
  const validKinds: CalloutKind[] = ["info", "warn", "tip", "danger"];
  const kind: CalloutKind = (validKinds as string[]).includes(rawKind)
    ? (rawKind as CalloutKind)
    : "info";
  const remaining = match[2];

  // Reconstruct the first <p> with prefix stripped, preserving any inline children
  // that came after the leading text (links, code marks, etc.).
  const newInner: ReactNode[] = [remaining, ...innerArr.slice(1)];
  const newFirst = isValidElement(first)
    ? { ...first, props: { ...(first.props as object), children: newInner } }
    : first;
  return { kind, withoutPrefix: [newFirst, ...arr.slice(1)] };
}

interface CalloutBlockquoteProps {
  children?: ReactNode;
}

export function CalloutBlockquote({ children }: CalloutBlockquoteProps) {
  const detected = detectKind(children);
  if (!detected) {
    return <blockquote className={proseClasses.blockquote}>{children}</blockquote>;
  }
  const { kind, withoutPrefix } = detected;
  const Icon = ICONS[kind];
  return (
    <div
      data-testid={`chat-callout-${kind}`}
      className={`my-2 flex gap-2 rounded p-3 ${proseClasses.calloutBorder[kind]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
        {withoutPrefix}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into ChatMessageRenderer**

In `chat-message-renderer.tsx`, replace the existing `blockquote: …` mapping with:

```tsx
import { CalloutBlockquote } from "./renderers/callout-blockquote";

// inside the components prop:
          blockquote: CalloutBlockquote,
```

- [ ] **Step 5: Run test to verify all pass**

```bash
pnpm --filter @opencairn/web test --run chat-message-renderer
```

Expected: 8 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chat/renderers/callout-blockquote.tsx apps/web/src/components/chat/chat-message-renderer.tsx apps/web/src/components/chat/chat-message-renderer.test.tsx
git commit -m "feat(web): render > [!kind] blockquotes as styled callouts in chat"
```

---

### Task 18: Wire ChatMessageRenderer into MessageBubble

**Files:**
- Modify: `apps/web/src/components/agent-panel/message-bubble.tsx`
- Modify (test if exists): `apps/web/src/components/agent-panel/message-bubble.test.tsx`

- [ ] **Step 1: Inspect existing MessageBubble**

```bash
cat apps/web/src/components/agent-panel/message-bubble.tsx | head -120
```

Note the prop interface (especially how `msg.content.body` is accessed) and the existing render structure.

- [ ] **Step 2: Replace the body render with ChatMessageRenderer**

Find the line that outputs the message body (likely something like `<div>{msg.content.body}</div>` or `{body}`). Replace with:

```tsx
import { ChatMessageRenderer } from "../chat/chat-message-renderer";

// where the body is currently rendered:
<ChatMessageRenderer
  body={msg.content.body ?? ""}
  streaming={msg.status === "streaming"}
/>
```

(Adjust the field names to match the actual `msg` shape if different.)

- [ ] **Step 3: Run existing message-bubble tests if any**

```bash
pnpm --filter @opencairn/web test --run message-bubble
```

Expected: existing tests continue to pass (they should — the renderer change is additive).

- [ ] **Step 4: Run web build to catch type drift**

```bash
pnpm --filter @opencairn/web build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agent-panel/message-bubble.tsx
git commit -m "feat(web): render chat messages with ChatMessageRenderer"
```

---

## Phase F — save_suggestion Flow

### Task 19: NoteEditor registers with active editor store

**Files:**
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Find the editor instance creation**

Look for `useCollaborativeEditor(...)` in `NoteEditor.tsx` (around line 217). The returned `editor` is the Plate editor we want to register.

- [ ] **Step 2: Add the register/unregister effect**

Add the imports near the top:

```tsx
import { useActiveEditorStore } from "@/stores/activeEditorStore";
```

After the `editor` is obtained (after `useCollaborativeEditor(...)`), add:

```tsx
  const setEditor = useActiveEditorStore((s) => s.setEditor);
  const removeEditor = useActiveEditorStore((s) => s.removeEditor);

  useEffect(() => {
    if (!editor) return;
    setEditor(noteId, editor);
    return () => {
      removeEditor(noteId);
    };
  }, [editor, noteId, setEditor, removeEditor]);
```

- [ ] **Step 3: Verify the existing tests still pass**

```bash
pnpm --filter @opencairn/web test --run NoteEditor
```

Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): register NoteEditor with active editor store"
```

---

### Task 20: insertFromMarkdown helper + tests

**Files:**
- Create: `apps/web/src/lib/notes/insert-from-markdown.ts`
- Test: `apps/web/src/lib/notes/insert-from-markdown.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/lib/notes/insert-from-markdown.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { insertFromMarkdown } from "./insert-from-markdown";

const insertNodes = vi.fn();
const fakeEditor = {
  tf: { insertNodes },
  api: {
    end: () => [0, 0],
  },
} as never;

const onMissingTarget = vi.fn();
const onSuccess = vi.fn();
const onCreatedNote = vi.fn();
const onError = vi.fn();
const apiCreateNote = vi.fn();

beforeEach(() => {
  useActiveEditorStore.setState({ editors: new Map() });
  insertNodes.mockClear();
  onMissingTarget.mockClear();
  onSuccess.mockClear();
  onCreatedNote.mockClear();
  onError.mockClear();
  apiCreateNote.mockClear();
});

describe("insertFromMarkdown", () => {
  it("inserts into the active editor when the target is a plate note", async () => {
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);

    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-1",
      activeNoteIsPlate: true,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(insertNodes).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onMissingTarget).not.toHaveBeenCalled();
  });

  it("invokes onMissingTarget when activeNoteIsPlate is false", async () => {
    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-1",
      activeNoteIsPlate: false,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onMissingTarget).toHaveBeenCalledTimes(1);
    expect(insertNodes).not.toHaveBeenCalled();
    expect(apiCreateNote).not.toHaveBeenCalled();
  });

  it("invokes onMissingTarget when no active note", async () => {
    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: undefined,
      activeNoteIsPlate: false,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onMissingTarget).toHaveBeenCalledTimes(1);
  });

  it("invokes onMissingTarget when active note has no registered editor", async () => {
    // active note is plate but the store entry is missing
    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-2",
      activeNoteIsPlate: true,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onMissingTarget).toHaveBeenCalledTimes(1);
  });

  it("calls onError when the editor throws", async () => {
    insertNodes.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);

    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-1",
      activeNoteIsPlate: true,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("createNoteFromMarkdown", () => {
  it("calls apiCreateNote with title + content", async () => {
    apiCreateNote.mockResolvedValue({ id: "new-note", title: "T" });
    const { createNoteFromMarkdown } = await import("./insert-from-markdown");

    await createNoteFromMarkdown({
      title: "T",
      markdown: "# Body",
      apiCreateNote,
      onCreated: onCreatedNote,
      onError,
    });

    expect(apiCreateNote).toHaveBeenCalledTimes(1);
    expect(onCreatedNote).toHaveBeenCalledWith({ id: "new-note", title: "T" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test --run insert-from-markdown
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

Create `apps/web/src/lib/notes/insert-from-markdown.ts`:

```ts
import { markdownToPlate } from "@/lib/markdown/markdown-to-plate";
import { useActiveEditorStore } from "@/stores/activeEditorStore";

// Plan 2D — Insert a markdown blob into a Plate editor (or invoke the
// missing-target callback so the caller can offer "create new note").
//
// Decoupled from React/UI: caller passes callbacks for success / missing
// target / error. The save-suggestion-card wires those to toasts and an
// API client; tests inject mocks.

interface CreateNoteApi {
  (input: { title: string; content: unknown[] }): Promise<{
    id: string;
    title: string;
  }>;
}

interface InsertFromMarkdownArgs {
  markdown: string;
  /** The currently active tab's noteId, or undefined if no tab is focused. */
  activeNoteId: string | undefined;
  /** True iff the active tab is rendering a Plate note (mode === 'plate'). */
  activeNoteIsPlate: boolean;
  apiCreateNote: CreateNoteApi;
  onSuccess: () => void;
  onMissingTarget: () => void;
  onCreatedNote: (note: { id: string; title: string }) => void;
  onError: (err: unknown) => void;
}

export async function insertFromMarkdown(args: InsertFromMarkdownArgs) {
  const {
    markdown,
    activeNoteId,
    activeNoteIsPlate,
    onSuccess,
    onMissingTarget,
    onError,
  } = args;

  if (!activeNoteId || !activeNoteIsPlate) {
    onMissingTarget();
    return;
  }
  const editor = useActiveEditorStore.getState().getEditor(activeNoteId);
  if (!editor) {
    onMissingTarget();
    return;
  }

  try {
    const ast = markdownToPlate(markdown);
    const at = editor.api.end?.();
    editor.tf.insertNodes(ast as never, at ? ({ at } as never) : undefined);
    onSuccess();
  } catch (err) {
    onError(err);
  }
}

interface CreateNoteFromMarkdownArgs {
  title: string;
  markdown: string;
  apiCreateNote: CreateNoteApi;
  onCreated: (note: { id: string; title: string }) => void;
  onError: (err: unknown) => void;
}

export async function createNoteFromMarkdown(args: CreateNoteFromMarkdownArgs) {
  const { title, markdown, apiCreateNote, onCreated, onError } = args;
  try {
    const ast = markdownToPlate(markdown);
    const note = await apiCreateNote({ title, content: ast });
    onCreated(note);
  } catch (err) {
    onError(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test --run insert-from-markdown
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notes/insert-from-markdown.ts apps/web/src/lib/notes/insert-from-markdown.test.ts
git commit -m "feat(web): add insertFromMarkdown helper for save_suggestion flow"
```

---

### Task 21: Wire SaveSuggestionCard onSave handler

**Files:**
- Modify: `apps/web/src/components/agent-panel/agent-panel.tsx` (or wherever `onSaveSuggestion` is currently a no-op / TODO)
- Modify: `apps/web/src/components/agent-panel/message-bubble.tsx` (already passes the value; adjust prop signature if needed)

- [ ] **Step 1: Find the current onSaveSuggestion definition**

```bash
grep -rn "onSaveSuggestion" apps/web/src/components/agent-panel/
```

Trace where the prop is defined. It is most likely `agent-panel.tsx` providing a stub that does nothing or logs.

- [ ] **Step 2: Inspect the api-client for note creation**

```bash
grep -n "createNote\|notes\..*create\|notes.add\|patchNote" apps/web/src/lib/api-client.ts | head -10
```

Confirm the function name and shape (likely `api.createNote({ projectId, title })` or similar). If the existing helper does not accept `content`, note that the new flow may need to PATCH after creation. Pick the simpler path:
  1. If `createNote` accepts `content` → pass `content: ast` directly.
  2. Otherwise → call `createNote({ title })` then `api.patchNote(id, { content: ast })`.

- [ ] **Step 3: Find the active-tab signal**

```bash
grep -n "useTabsStore\|activeTab\|tab_mode" apps/web/src/stores/ apps/web/src/components/agent-panel/ | head -20
```

The agent panel already pulls active tab info for scope chips (per the explore agent report). Reuse that store; you should be able to read `activeTab.noteId` and `activeTab.mode`.

- [ ] **Step 4: Implement onSaveSuggestion**

Replace the existing `onSaveSuggestion` callback wherever it is currently passed into `MessageBubble`. The new shape (in `agent-panel.tsx`):

```tsx
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTabsStore } from "@/stores/tabs"; // or actual store path
import { saveSuggestionSchema } from "@opencairn/shared";
import {
  insertFromMarkdown,
  createNoteFromMarkdown,
} from "@/lib/notes/insert-from-markdown";
import { api } from "@/lib/api-client";

// inside the component:
  const t = useTranslations("agentPanel.bubble");
  const activeTab = useTabsStore((s) => s.activeTab);

  const handleSaveSuggestion = useCallback(
    async (raw: unknown) => {
      const parsed = saveSuggestionSchema.safeParse(raw);
      if (!parsed.success) {
        toast.error(t("save_suggestion_failed"));
        return;
      }
      const { title, body_markdown } = parsed.data;

      await insertFromMarkdown({
        markdown: body_markdown,
        activeNoteId: activeTab?.kind === "note" ? activeTab.noteId : undefined,
        activeNoteIsPlate: activeTab?.kind === "note" && activeTab.mode === "plate",
        apiCreateNote: (input) =>
          api.createNote({ title: input.title }) // see Step 2 — adapt as needed
            .then(async (n) => {
              await api.patchNote(n.id, { content: input.content });
              return { id: n.id, title: n.title };
            }),
        onSuccess: () => {
          toast.success(t("save_suggestion_inserted_active"));
        },
        onMissingTarget: () => {
          toast(t("save_suggestion_target_prompt"), {
            action: {
              label: t("save_suggestion_create_new"),
              onClick: async () => {
                await createNoteFromMarkdown({
                  title,
                  markdown: body_markdown,
                  apiCreateNote: (input) =>
                    api.createNote({ title: input.title }).then(async (n) => {
                      await api.patchNote(n.id, { content: input.content });
                      return { id: n.id, title: n.title };
                    }),
                  onCreated: (note) => {
                    // Open the new note as a tab
                    useTabsStore.getState().openTab({
                      kind: "note",
                      noteId: note.id,
                      mode: "plate",
                    });
                  },
                  onError: () => toast.error(t("save_suggestion_failed")),
                });
              },
            },
            cancel: { label: t("save_suggestion_cancel") },
          });
        },
        onCreatedNote: () => {},
        onError: () => toast.error(t("save_suggestion_failed")),
      });
    },
    [activeTab, t],
  );
```

Pass `handleSaveSuggestion` down into `MessageBubble` where it currently consumes `onSaveSuggestion`.

NOTE: the exact shape of `useTabsStore`, `openTab`, and `api.createNote`/`api.patchNote` may differ. Adapt the calls to match the actual store/API surface you find in Step 3 / Step 2 — the structure (validate → insert OR toast-action) stays.

- [ ] **Step 5: Run web tests to catch type drift**

```bash
pnpm --filter @opencairn/web test --run agent-panel
pnpm --filter @opencairn/web build 2>&1 | tail -10
```

Expected: tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agent-panel/
git commit -m "feat(web): wire SaveSuggestionCard onSave to active-editor insertion"
```

---

### Task 22: Stub agent_pipeline emits save_suggestion (env flag)

**Files:**
- Modify: `apps/api/src/lib/agent-pipeline.ts`
- Modify: `apps/api/src/routes/threads.test.ts`

- [ ] **Step 1: Inspect the existing SSE harness**

```bash
grep -n "collectSse\|streamFrames\|consumeSse\|EventSource" apps/api/src/routes/threads.test.ts | head -10
grep -n "POST.*threads.*messages\|/api/threads" apps/api/src/routes/threads.test.ts | head -5
```

Note the exact helper name and call shape. If no helper exists yet, you'll need to write a small one that POSTs to the route and parses `event:`/`data:` frames. The new tests below assume a helper named `collectSseFrames(path, opts)` that returns `{ event, data }[]`.

- [ ] **Step 2: Add the failing API test**

In `apps/api/src/routes/threads.test.ts` (or create a new dedicated case if the file is large), add (replace the helper name in calls if it differs from `collectSseFrames`):

```ts
import { describe, expect, it, vi } from "vitest";
// ... existing imports ...

describe("POST /threads/:id/messages — save_suggestion stub flag", () => {
  it("emits a save_suggestion chunk when /test-save is sent and flag is set", async () => {
    const prev = process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION;
    process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION = "1";
    try {
      // ... existing harness to POST and read SSE frames ...
      // Assert one of the frames is `event: save_suggestion` with a payload
      // matching `{ title, body_markdown }`.
      const frames = await collectSseFrames("/api/threads/<test-id>/messages", {
        body: { content: "hello /test-save", mode: "auto" },
      });
      const savedFrames = frames.filter((f) => f.event === "save_suggestion");
      expect(savedFrames).toHaveLength(1);
      const payload = JSON.parse(savedFrames[0].data);
      expect(payload.title).toBeDefined();
      expect(payload.body_markdown).toContain("# ");
    } finally {
      process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION = prev;
    }
  });

  it("does NOT emit save_suggestion when the flag is not set", async () => {
    delete process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION;
    const frames = await collectSseFrames("/api/threads/<test-id>/messages", {
      body: { content: "hello /test-save", mode: "auto" },
    });
    expect(frames.find((f) => f.event === "save_suggestion")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @opencairn/api test --run threads
```

Expected: 2 new tests FAIL (save_suggestion is never emitted by current stub).

- [ ] **Step 4: Modify the stub generator**

In `apps/api/src/lib/agent-pipeline.ts`, after the existing `for (const ch of body)` loop and before `yield { type: "done", payload: {} };`:

```ts
  if (
    process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION === "1" &&
    opts.userMessage.content.includes("/test-save")
  ) {
    yield {
      type: "save_suggestion",
      payload: {
        title: "Test note from chat",
        body_markdown:
          "# Test note\n\nThis was suggested by the chat.\n\n- item 1\n- item 2\n\n```mermaid\ngraph TD\n  A --> B\n  B --> C\n```\n\n> [!info] Generated by stub flag — not a real LLM output.",
      },
    };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @opencairn/api test --run threads
```

Expected: all tests pass (2 new + existing).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/agent-pipeline.ts apps/api/src/routes/threads.test.ts
git commit -m "feat(api): emit save_suggestion stub chunk under env flag"
```

---

## Phase G — End-to-End Tests

### Task 23: E2E — editor blocks

**Files:**
- Create: `apps/web/e2e/plan-2d/editor-blocks.spec.ts`

- [ ] **Step 1: Inspect the existing E2E harness**

```bash
ls apps/web/e2e/
cat apps/web/playwright.config.ts | head -30
```

Note the locators / `data-testid` conventions used in existing specs (e.g., the slash menu uses `data-testid="slash-menu"` and individual entries use `data-testid="slash-cmd-XXX"` per `plugins/slash.tsx`).

- [ ] **Step 2: Implement the spec**

Create `apps/web/e2e/plan-2d/editor-blocks.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { signInAndOpenNote } from "../helpers/notes"; // existing helper from Plan 2A

test.describe("Plan 2D — editor blocks", () => {
  test("inserts a Mermaid diagram via slash", async ({ page }) => {
    await signInAndOpenNote(page);

    // Open the slash menu inside the editor
    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();
    await editor.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();

    await page.getByTestId("slash-cmd-mermaid").click();

    // The block exists in source-only state with empty code
    await expect(page.getByTestId("mermaid-block")).toBeVisible();
  });

  test("inserts a Callout and cycles its kind", async ({ page }) => {
    await signInAndOpenNote(page);

    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();
    await editor.press("/");
    await page.getByTestId("slash-cmd-callout").click();

    const kindBtn = page.getByTestId("callout-kind-button");
    await expect(kindBtn).toHaveAttribute("data-kind", "info");
    await kindBtn.click();
    await expect(kindBtn).toHaveAttribute("data-kind", "warn");
  });

  test("inserts a Toggle and toggles its body", async ({ page }) => {
    await signInAndOpenNote(page);
    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();
    await editor.press("/");
    await page.getByTestId("slash-cmd-toggle").click();

    await expect(page.getByTestId("toggle-block")).toBeVisible();
    const body = page.getByTestId("toggle-body");
    await expect(body).toBeVisible(); // default open=true

    await page.getByTestId("toggle-chevron").click();
    await expect(page.getByTestId("toggle-body")).toHaveCount(0);
  });

  test("inserts a 3x3 Table", async ({ page }) => {
    await signInAndOpenNote(page);
    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();
    await editor.press("/");
    await page.getByTestId("slash-cmd-table").click();

    await expect(page.locator("table tr")).toHaveCount(3);
  });

  test("inserts a 2-column layout", async ({ page }) => {
    await signInAndOpenNote(page);
    const editor = page.getByRole("textbox", { name: /editor/i });
    await editor.click();
    await editor.press("/");
    await page.getByTestId("slash-cmd-columns").click();

    // @platejs/layout renders columns with role=group or specific class — adjust
    // the selector to match the actual DOM after running once.
    await expect(page.locator(".slate-column-group, [data-slate-type='column-group']")).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the E2E**

```bash
pnpm --filter @opencairn/web exec playwright test e2e/plan-2d/editor-blocks.spec.ts
```

Expected: 5 specs pass. If the `signInAndOpenNote` helper has a different export name, update the import.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/plan-2d/editor-blocks.spec.ts
git commit -m "test(web): add Plan 2D editor blocks E2E"
```

---

### Task 24: E2E — chat renderer

**Files:**
- Create: `apps/web/e2e/plan-2d/chat-renderer.spec.ts`

- [ ] **Step 1: Implement the spec**

Create `apps/web/e2e/plan-2d/chat-renderer.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { signInAndOpenAgentPanel } from "../helpers/agent-panel"; // existing helper

test.describe("Plan 2D — chat renderer", () => {
  test.beforeEach(async ({ page }) => {
    // The stub generator echoes the user message verbatim, so we control the
    // markdown the renderer sees by sending markdown in the user message.
    await signInAndOpenAgentPanel(page);
  });

  test("renders a fenced JS code block with a copy button + lang label", async ({ page }) => {
    await page.getByRole("textbox", { name: /message/i }).fill("```js\nconst x = 1;\n```");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for the agent stub to echo
    await expect(page.getByTestId("code-block-lang")).toContainText("js");
    await expect(page.getByTestId("code-block-copy")).toBeVisible();
  });

  test("renders a mermaid block from a chat message", async ({ page }) => {
    await page.getByRole("textbox", { name: /message/i }).fill("```mermaid\ngraph TD\nA --> B\n```");
    await page.getByRole("button", { name: /send/i }).click();

    // Mermaid is async — wait for either svg or error
    await expect(
      page.getByTestId("mermaid-chat").or(page.getByTestId("mermaid-chat-error")),
    ).toBeVisible({ timeout: 10000 });
  });

  test("renders a GFM table", async ({ page }) => {
    await page.getByRole("textbox", { name: /message/i }).fill("| a | b |\n|---|---|\n| 1 | 2 |");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.locator("[data-testid='chat-message-renderer'] table")).toBeVisible();
  });

  test("strips a <script> tag from raw HTML", async ({ page }) => {
    await page.getByRole("textbox", { name: /message/i }).fill("<script>window.PWN=1</script>safe content");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText("safe content")).toBeVisible();
    const pwn = await page.evaluate(() => (window as Window & { PWN?: unknown }).PWN);
    expect(pwn).toBeUndefined();
  });

  test("renders > [!warn] as a styled callout", async ({ page }) => {
    await page.getByRole("textbox", { name: /message/i }).fill("> [!warn] caution\n\ncontent");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByTestId("chat-callout-warn")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E**

```bash
pnpm --filter @opencairn/web exec playwright test e2e/plan-2d/chat-renderer.spec.ts
```

Expected: 5 specs pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/plan-2d/chat-renderer.spec.ts
git commit -m "test(web): add Plan 2D chat renderer E2E"
```

---

### Task 25: E2E — save_suggestion

**Files:**
- Create: `apps/web/e2e/plan-2d/save-suggestion.spec.ts`
- Modify: `apps/web/playwright.config.ts` (env injection if not yet)

- [ ] **Step 1: Inject AGENT_STUB_EMIT_SAVE_SUGGESTION into playwright env**

In `apps/web/playwright.config.ts`, locate the `webServer` block and add to the `env`:

```ts
webServer: {
  // ...
  env: {
    // ...
    AGENT_STUB_EMIT_SAVE_SUGGESTION: "1",
  },
},
```

If the dev server is launched separately and not via `webServer`, add the flag to whatever launch command the spec uses.

- [ ] **Step 2: Implement the spec**

Create `apps/web/e2e/plan-2d/save-suggestion.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import {
  signInAndOpenNote,
  signInAndOpenAgentPanel,
} from "../helpers"; // existing helpers

test.describe("Plan 2D — save_suggestion flow", () => {
  test("inserts into active plate note when card Save is clicked", async ({ page }) => {
    await signInAndOpenNote(page);
    // The note is now the active tab. Open the agent panel alongside.
    await page.getByRole("button", { name: /agent panel|chat/i }).click();

    await page
      .getByRole("textbox", { name: /message/i })
      .fill("/test-save please");
    await page.getByRole("button", { name: /send/i }).click();

    const card = page.getByText(/Save .* as a note\?|.* 노트로 저장 제안/);
    await expect(card).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /^Save$|^저장$/ }).click();

    // The block from the markdown body should appear in the editor
    await expect(page.getByText(/Test note from chat/i)).toBeVisible();
  });

  test("offers create-new toast when active tab is not a plate note", async ({ page }) => {
    // Open a non-plate tab — e.g., dashboard route — then open agent panel
    await signInAndOpenAgentPanel(page); // assumes dashboard is the default landing

    await page.getByRole("textbox", { name: /message/i }).fill("/test-save please");
    await page.getByRole("button", { name: /send/i }).click();

    const card = page.getByText(/Save .* as a note\?|.* 노트로 저장 제안/);
    await expect(card).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /^Save$|^저장$/ }).click();

    // Toast with "Create new note" action should appear
    await page.getByRole("button", { name: /Create new note|새 노트로 만들기/ }).click();

    // After creating, the new tab should open and contain the markdown content
    await expect(page.getByText(/Test note from chat/i)).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 3: Run the E2E**

```bash
pnpm --filter @opencairn/web exec playwright test e2e/plan-2d/save-suggestion.spec.ts
```

Expected: 2 specs pass. (If env injection didn't take effect, the card never appears — debug by curl-ing the SSE endpoint with the flag set.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/plan-2d/save-suggestion.spec.ts apps/web/playwright.config.ts
git commit -m "test(web): add Plan 2D save_suggestion E2E"
```

---

## Wrap-Up

After all tasks complete, run the full verification:

```bash
pnpm --filter @opencairn/web test --run
pnpm --filter @opencairn/web build
pnpm --filter @opencairn/api test --run
pnpm --filter @opencairn/shared test --run
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web exec playwright test e2e/plan-2d/
```

All must be green before declaring Plan 2D done. Then invoke `opencairn-post-feature` to walk the docs/commit/PR loop.

## Out of Scope (Plan 2E follow-up)

- Plan 11B body: provenance markers, `/summarize` & friends, related-pages panel
- Image and embed blocks (`@platejs/media`)
- Drag-resize column widths
- Pin-to-page UI affordances (drag-from-chat-into-editor visual hand-off)
- Table row/column context menu (insert above/below/left/right, delete row/col, header toggle) — `@platejs/table` is registered, the chrome lands in 2E
- Math input UX for the slash menu (`/math` re-enable) — touched on by `latexPlugins` in NoteEditor; Plan 2D adds no TeX input affordance
