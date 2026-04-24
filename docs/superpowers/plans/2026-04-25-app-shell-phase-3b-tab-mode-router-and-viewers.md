# App Shell Phase 3-B — TabModeRouter + Core Viewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Amendment 2026-04-25 (post-merge drift correction):** Task 7의 `react-pdf` 선택은 `docs/superpowers/specs/2026-04-09-opencairn-design.md:148`가 이미 **`@react-pdf-viewer/core`**를 명시 이유(내장 텍스트 검색·툴바·페이지 네비)와 함께 결정한 뒤의 무근거 drift였고, 구현은 커밋 `f292f74` "swap SourceViewer to @react-pdf-viewer/core (restore spec)"에서 원상 복구되었다. 본 문서 Task 7의 코드 블록은 역사적 기록(초기 PR #27 구현)으로 남기며, 현행 소스는 `apps/web/src/components/tab-shell/viewers/source-viewer.tsx`를 참조.

**Goal:** Replace the Phase 3-A pass-through `TabShell` body (route `children` only) with a `TabModeRouter` that dispatches to four core viewers (`reading`, `source`, `data`, plus `stub` for non-core modes). Add the two backend endpoints the viewers need (`GET /api/notes/:id/file`, `GET /api/notes/:id/data`). Extend `onFirstEdit` preview promotion to mouse-driven authoring (paste + drop). Fix the persisted `Tab.title` locale-lock-in by adding a render-time `titleKey` resolver.

**Architecture:**
- `plate` mode keeps flowing through the existing Next.js route page (`/w/.../n/<id>` → `NoteEditorClient` SSR). TabShell renders `children` for plate + non-note kinds (dashboard, project, research_hub, import, ws_settings) so the SSR auth + meta + role fan-out stays exactly where it is.
- Non-plate modes (`reading`, `source`, `data`, and every unrecognized mode) take the TabModeRouter path. Viewers fetch whatever they need client-side via React Query; no SSR rewrites.
- Mode is entered via (a) `⌘⇧R` toggle (plate↔reading, spec §5.10.1) and (b) new tab context-menu "모드" submenu. Auto-detection of `source` from `notes.source_type='pdf'` is out of scope — deferred to a follow-up.
- `Tab.titleKey` is a new optional field. When set, TabItem/TabOverflowMenu render `t(titleKey, { id })` at render time; `title` remains a cached fallback so persisted tabs created before the migration keep working.
- Viewers: `ReadingViewer` spins up a read-only `Hocuspocus` connection via the existing `useCollaborativeEditor` hook (same content that `NoteEditor` sees, no staleness). `SourceViewer` uses `@react-pdf-viewer/core` against `/api/notes/:id/file` (spec §148 — 내장 검색/툴바). `DataViewer` uses `react-json-view-lite` against `/api/notes/:id/data`.

**Tech Stack:** `@react-pdf-viewer/core` + `@react-pdf-viewer/default-layout` + `pdfjs-dist`, `react-json-view-lite`, existing `@platejs/*` v49 + `useCollaborativeEditor` hook, React Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §5.3 (modes), §5.10 (per-mode detail), §5.6 (`⌘⇧R`).
**Depends on:** Phase 3-A (tabs-store extensions, TabBar/TabItem, context menu, keyboard shortcuts, preview promotion). All green on `main` as of `f02668e`.

---

## File Structure

**New files:**

```
apps/api/src/routes/
└── note-assets.ts                              # new /api/notes/:id/file + /api/notes/:id/data router

apps/api/src/lib/
└── s3-get.ts                                   # getPresignedGetUrl + streamObject helpers

apps/web/src/components/tab-shell/
├── tab-mode-router.tsx                         # dispatches Tab.mode → viewer
└── viewers/
    ├── stub-viewer.tsx                         # fallback for non-core modes
    ├── reading-viewer.tsx                      # readOnly Plate + font slider
    ├── source-viewer.tsx                       # PDF via react-pdf
    └── data-viewer.tsx                         # JSON tree via react-json-view-lite

apps/web/src/hooks/
└── use-tab-mode-shortcut.ts                    # ⌘⇧R plate↔reading toggle

apps/web/src/components/tab-shell/
└── tab-mode-submenu.tsx                        # "모드" submenu inside TabContextMenu

apps/web/src/lib/
└── resolve-tab-title.ts                        # titleKey → translated title at render time
```

**Modified files:**

```
apps/api/src/index.ts                           # mount note-assets router under /api/notes
apps/web/src/stores/tabs-store.ts               # +titleKey?: string on Tab
apps/web/src/lib/tab-factory.ts                 # accept titleKey, keep title as concrete fallback
apps/web/src/hooks/use-url-tab-sync.ts          # emit titleKey for non-note kinds
apps/web/src/components/tab-shell/tab-item.tsx  # render via resolve-tab-title
apps/web/src/components/tab-shell/tab-overflow-menu.tsx  # same
apps/web/src/components/tab-shell/tab-shell.tsx # branch children vs TabModeRouter
apps/web/src/components/tab-shell/tab-context-menu.tsx   # mount TabModeSubmenu
apps/web/src/components/shell/shell-providers.tsx        # mount useTabModeShortcut
apps/web/src/components/editor/NoteEditor.tsx   # onFirstEdit: paste + drop handlers
apps/web/messages/ko/app-shell.json             # tabs.modes.* + modes.shortcut hints
apps/web/messages/en/app-shell.json             # parity
docs/architecture/api-contract.md               # document /api/notes/:id/file + /api/notes/:id/data
docs/contributing/plans-status.md               # mark 3-B complete
```

**Tests:**

```
apps/api/tests/routes/note-assets.test.ts
apps/web/src/components/tab-shell/tab-mode-router.test.tsx
apps/web/src/components/tab-shell/viewers/stub-viewer.test.tsx
apps/web/src/components/tab-shell/viewers/source-viewer.test.tsx
apps/web/src/components/tab-shell/viewers/data-viewer.test.tsx
apps/web/src/components/tab-shell/viewers/reading-viewer.test.tsx
apps/web/src/hooks/use-tab-mode-shortcut.test.tsx
apps/web/src/lib/resolve-tab-title.test.tsx
apps/web/src/components/editor/NoteEditor.onFirstEdit.test.tsx
apps/web/tests/e2e/tab-viewers.spec.ts
```

---

## Task 1: `Tab.titleKey` + render-time resolution (fix locale lock-in)

**Files:**
- Modify: `apps/web/src/stores/tabs-store.ts`
- Create: `apps/web/src/lib/resolve-tab-title.ts`
- Create: `apps/web/src/lib/resolve-tab-title.test.tsx`
- Modify: `apps/web/src/lib/tab-factory.ts`
- Modify: `apps/web/src/hooks/use-url-tab-sync.ts`
- Modify: `apps/web/src/components/tab-shell/tab-item.tsx`
- Modify: `apps/web/src/components/tab-shell/tab-overflow-menu.tsx`

### Step 1.1: Extend `Tab` interface

```ts
// apps/web/src/stores/tabs-store.ts — Tab interface additions
export interface Tab {
  id: string;
  kind: TabKind;
  targetId: string | null;
  mode: TabMode;
  /**
   * Cached resolved title, written at tab creation in the current locale.
   * Retained for: (a) persisted tabs from Phase 3-A that predate titleKey,
   * (b) dynamic titles like note titles from the DB that have no i18n key.
   * Render path prefers `titleKey` when set, falls back to this.
   */
  title: string;
  /**
   * i18n key under `appShell.tabTitles` (or any top-level namespace resolvable
   * by next-intl's `useTranslations`). Set for kinds whose title is static
   * UI copy (dashboard, import, ws_settings, research_hub). Left unset for
   * `note` (title comes from the DB and cannot be translated).
   */
  titleKey?: string;
  /**
   * Interpolation params for `titleKey`. Only `id` is used today
   * (`research_run` → "Research {id}"); kept open for future kinds.
   */
  titleParams?: Record<string, string>;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  splitWith: string | null;
  splitSide: "left" | "right" | null;
  scrollY: number;
}
```

### Step 1.2: Write the failing resolve-tab-title test

```tsx
// apps/web/src/lib/resolve-tab-title.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ResolveTabTitle } from "./resolve-tab-title";
import type { Tab } from "@/stores/tabs-store";

const messages = {
  appShell: {
    tabTitles: {
      dashboard: "대시보드",
      research_run: "Research {id}",
    },
  },
};

const base: Tab = {
  id: "t", kind: "dashboard", targetId: null, mode: "plate",
  title: "FALLBACK_DO_NOT_RENDER",
  pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
};

function wrap(locale: string, children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>,
  );
}

describe("ResolveTabTitle", () => {
  it("renders translated titleKey when present", () => {
    const { container } = wrap(
      "ko",
      <ResolveTabTitle tab={{ ...base, titleKey: "appShell.tabTitles.dashboard" }} />,
    );
    expect(container.textContent).toBe("대시보드");
  });

  it("interpolates titleParams", () => {
    const { container } = wrap(
      "ko",
      <ResolveTabTitle
        tab={{
          ...base,
          kind: "research_run",
          titleKey: "appShell.tabTitles.research_run",
          titleParams: { id: "R-17" },
        }}
      />,
    );
    expect(container.textContent).toBe("Research R-17");
  });

  it("falls back to tab.title when titleKey is absent", () => {
    const { container } = wrap(
      "ko",
      <ResolveTabTitle tab={{ ...base, titleKey: undefined, title: "내 노트" }} />,
    );
    expect(container.textContent).toBe("내 노트");
  });

  it("falls back to tab.title when titleKey points at a missing message", () => {
    const { container } = wrap(
      "ko",
      <ResolveTabTitle
        tab={{ ...base, titleKey: "appShell.tabTitles.nonexistent", title: "오류 폴백" }}
      />,
    );
    expect(container.textContent).toBe("오류 폴백");
  });
});
```

Run: `pnpm --filter @opencairn/web test resolve-tab-title`
Expected: FAIL — module not found.

### Step 1.3: Implement `ResolveTabTitle`

```tsx
// apps/web/src/lib/resolve-tab-title.ts
"use client";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";

/**
 * Render-time title resolver. Splits `titleKey` into (namespace, leaf) so
 * `useTranslations("appShell.tabTitles")` can look up "dashboard" without
 * forcing every caller to pre-split. next-intl's `t(key)` returns the key
 * itself on miss, so we compare against the leaf to detect misses and fall
 * back to `tab.title`.
 */
export function ResolveTabTitle({ tab }: { tab: Tab }) {
  return <>{useResolvedTabTitle(tab)}</>;
}

export function useResolvedTabTitle(tab: Tab): string {
  if (!tab.titleKey) return tab.title;
  const lastDot = tab.titleKey.lastIndexOf(".");
  if (lastDot < 0) return tab.title;
  const ns = tab.titleKey.slice(0, lastDot);
  const leaf = tab.titleKey.slice(lastDot + 1);
  // Hook call is unconditional on purpose — React's rules-of-hooks require
  // it, and `titleKey` presence was checked above before we committed to
  // calling useTranslations on this render path.
  const t = useTranslations(ns);
  const resolved = t(leaf, tab.titleParams ?? {});
  // next-intl returns the key on miss. If the result equals the leaf we
  // treat it as a miss and fall back to the cached `title`.
  return resolved === leaf ? tab.title : resolved;
}
```

Run: `pnpm --filter @opencairn/web test resolve-tab-title`
Expected: PASS (all 4).

### Step 1.4: Thread `titleKey` through tab-factory

```ts
// apps/web/src/lib/tab-factory.ts — NewTabOptions additions
export interface NewTabOptions {
  kind: TabKind;
  targetId: string | null;
  title: string;
  titleKey?: string;
  titleParams?: Record<string, string>;
  mode?: TabMode;
  preview?: boolean;
}

export function newTab(opts: NewTabOptions): Tab {
  return {
    id: genTabId(),
    kind: opts.kind,
    targetId: opts.targetId,
    mode: opts.mode ?? defaultMode(opts.kind),
    title: opts.title,
    titleKey: opts.titleKey,
    titleParams: opts.titleParams,
    pinned: false,
    preview: opts.preview ?? defaultPreview(opts.kind),
    dirty: false,
    splitWith: null,
    splitSide: null,
    scrollY: 0,
  };
}
```

### Step 1.5: Emit `titleKey` from `use-url-tab-sync`

Replace the `resolveDefaultTitle` helper's call site so it also emits a `titleKey` for kinds with static copy. Note tabs stay keyless — their title comes from the DB and is filled in by whatever flow creates the tab (route page → TODO in follow-up, for now note tabs keep the generic "노트" fallback).

```ts
// apps/web/src/hooks/use-url-tab-sync.ts — replace newTab({...}) call in the effect
const { key, params } = tabTitleKey(route.kind, route.targetId);
const tab = newTab({
  kind: route.kind,
  targetId: route.targetId,
  title: resolveDefaultTitle(tabTitle, route.kind, route.targetId),
  titleKey: key,
  titleParams: params,
});

// helper added near the top of the file:
function tabTitleKey(
  kind: TabKind,
  targetId: string | null,
): { key: string | undefined; params: Record<string, string> | undefined } {
  switch (kind) {
    // Note titles come from the DB and have no i18n key; keep titleKey unset.
    case "note":
      return { key: undefined, params: undefined };
    case "research_run":
      return {
        key: "appShell.tabTitles.research_run",
        params: { id: targetId ?? "" },
      };
    default:
      return { key: `appShell.tabTitles.${kind}`, params: undefined };
  }
}
```

### Step 1.6: Use the resolver in `TabItem` + `TabOverflowMenu`

```tsx
// apps/web/src/components/tab-shell/tab-item.tsx — replace the {tab.title} span
import { useResolvedTabTitle } from "@/lib/resolve-tab-title";
// ...
const resolvedTitle = useResolvedTabTitle(tab);
// ...
<span className={`flex-1 truncate ${tab.preview ? "italic" : ""}`}>
  {resolvedTitle}
</span>
```

Repeat the same edit in `tab-overflow-menu.tsx` (the `{t.title}` render in the `DropdownMenuItem`).

### Step 1.7: Run + commit

```bash
pnpm --filter @opencairn/web test resolve-tab-title tab-factory use-url-tab-sync tab-item tab-overflow-menu
pnpm --filter @opencairn/web typecheck
git add apps/web/src/stores/tabs-store.ts \
        apps/web/src/lib/resolve-tab-title.ts \
        apps/web/src/lib/resolve-tab-title.test.tsx \
        apps/web/src/lib/tab-factory.ts \
        apps/web/src/hooks/use-url-tab-sync.ts \
        apps/web/src/components/tab-shell/tab-item.tsx \
        apps/web/src/components/tab-shell/tab-overflow-menu.tsx
git commit -m "feat(web): resolve tab titles at render time via titleKey"
```

---

## Task 2: Extend `onFirstEdit` to paste + drop (mouse-driven authoring)

Phase 3-A fires `onFirstEdit` only for printable keystrokes. Users who start a note by pasting or dragging an image in don't trigger preview promotion — the preview tab silently gets replaced on the next sidebar click and the pasted content vanishes. Fix by widening the trigger surface.

**Files:**
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`
- Create: `apps/web/src/components/editor/NoteEditor.onFirstEdit.test.tsx`

### Step 2.1: Failing test

```tsx
// apps/web/src/components/editor/NoteEditor.onFirstEdit.test.tsx
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
// See NoteEditor.test.tsx for the full provider rig — reuse it.
import { renderNoteEditor } from "./NoteEditor.test-rig";

describe("NoteEditor.onFirstEdit", () => {
  it("fires on paste into the editor body", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit });
    const body = screen.getByTestId("note-body");
    fireEvent.paste(body, { clipboardData: { getData: () => "hello" } });
    expect(onFirstEdit).toHaveBeenCalledOnce();
  });

  it("fires on drop into the editor body", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit });
    const body = screen.getByTestId("note-body");
    fireEvent.drop(body, { dataTransfer: { files: [], types: ["text/plain"] } });
    expect(onFirstEdit).toHaveBeenCalledOnce();
  });

  it("does not fire twice when keystroke + paste happen in sequence", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit });
    const body = screen.getByTestId("note-body");
    fireEvent.keyDown(body, { key: "a" });
    fireEvent.paste(body, { clipboardData: { getData: () => "x" } });
    expect(onFirstEdit).toHaveBeenCalledOnce();
  });

  it("is a no-op in readOnly mode", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit, readOnly: true });
    const body = screen.getByTestId("note-body");
    fireEvent.paste(body, { clipboardData: { getData: () => "x" } });
    expect(onFirstEdit).not.toHaveBeenCalled();
  });
});
```

If `NoteEditor.test-rig` does not yet exist, create a minimal one that renders `<NoteEditor>` with the required collaborative-editor mocks stubbed so the onFirstEdit paths can run headlessly. Look at the existing `NoteEditor.test.tsx` (if any) for the mock set — otherwise create stubs of `useCollaborativeEditor` returning an object with a minimal `tf` shape via Vitest `vi.mock`.

### Step 2.2: Implement

Extend the wrapper in `NoteEditor.tsx`:

```tsx
// NoteEditor.tsx — add paste + drop handlers next to notifyFirstEditOnKey
const notifyFirstEditOnce = useCallback(() => {
  if (firstEditFiredRef.current) return;
  firstEditFiredRef.current = true;
  onFirstEdit?.();
}, [onFirstEdit]);

const notifyFirstEditOnPaste = useCallback(
  (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Only count real paste payloads. Empty clipboardData (some synthetic
    // events in tests) still counts as an edit intent — be permissive.
    notifyFirstEditOnce();
  },
  [notifyFirstEditOnce],
);

const notifyFirstEditOnDrop = useCallback(
  (e: React.DragEvent<HTMLDivElement>) => {
    notifyFirstEditOnce();
  },
  [notifyFirstEditOnce],
);
```

Then wire them into the existing wrapper div:

```tsx
<div
  onKeyDownCapture={readOnly ? undefined : notifyFirstEditOnKey}
  onPasteCapture={readOnly ? undefined : notifyFirstEditOnPaste}
  onDropCapture={readOnly ? undefined : notifyFirstEditOnDrop}
  className="contents"
>
```

Refactor `notifyFirstEditOnKey` to call `notifyFirstEditOnce()` instead of duplicating the `firstEditFiredRef` check so both paths share the same one-shot gate.

### Step 2.3: Run + commit

```bash
pnpm --filter @opencairn/web test NoteEditor.onFirstEdit
git add apps/web/src/components/editor/NoteEditor.tsx \
        apps/web/src/components/editor/NoteEditor.onFirstEdit.test.tsx \
        apps/web/src/components/editor/NoteEditor.test-rig.tsx  # if newly created
git commit -m "feat(web): onFirstEdit fires on paste and drop"
```

---

## Task 3: `GET /api/notes/:id/file` — stream MinIO object

Source-mode viewer needs the raw PDF bytes. Stream through the API so MinIO stays internal-only (no public bucket exposure) and per-request auth + workspace scoping run through the same middleware as the rest of `/api/notes`.

**Files:**
- Create: `apps/api/src/routes/note-assets.ts`
- Create: `apps/api/src/lib/s3-get.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/routes/note-assets.test.ts`

### Step 3.1: Failing test

```ts
// apps/api/tests/routes/note-assets.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { testApp } from "../helpers/app";
import { seedNoteWithSource, seedPlainNote } from "../helpers/fixtures";

vi.mock("../../src/lib/s3-get", () => ({
  streamObject: vi.fn(async (key: string) => ({
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("PDF-BYTES"));
        c.close();
      },
    }),
    contentType: "application/pdf",
    contentLength: 9,
  })),
}));

describe("GET /api/notes/:id/file", () => {
  beforeEach(() => vi.clearAllMocks());

  it("streams the MinIO object for a note with sourceFileKey", async () => {
    const { noteId, cookie } = await seedNoteWithSource({
      mime: "application/pdf",
      key: "uploads/x.pdf",
    });
    const res = await testApp.request(`/api/notes/${noteId}/file`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("PDF-BYTES");
  });

  it("404 when the note has no sourceFileKey", async () => {
    const { noteId, cookie } = await seedPlainNote();
    const res = await testApp.request(`/api/notes/${noteId}/file`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });

  it("403 when user cannot read the note", async () => {
    const { noteId } = await seedNoteWithSource({
      mime: "application/pdf",
      key: "uploads/x.pdf",
    });
    // No cookie → requireAuth will reject. Use the "other-user" cookie from
    // the fixtures helper for a canRead=false flow instead.
    const cookie = await import("../helpers/fixtures").then((m) =>
      m.otherUserCookie(),
    );
    const res = await testApp.request(`/api/notes/${noteId}/file`, {
      headers: { cookie },
    });
    expect(res.status).toBe(403);
  });

  it("400 when id is not a uuid", async () => {
    const cookie = await import("../helpers/fixtures").then((m) =>
      m.primaryUserCookie(),
    );
    const res = await testApp.request(`/api/notes/not-a-uuid/file`, {
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  });
});
```

If `seedNoteWithSource` / `seedPlainNote` / `otherUserCookie` don't exist, add them under `apps/api/tests/helpers/fixtures.ts` using the existing `seed-*` scaffolding for sibling tests (grep `seedPlainNote` — if none, create the function alongside existing `seed*` helpers in the file).

Run: `pnpm --filter @opencairn/api test note-assets`
Expected: FAIL — route not registered.

### Step 3.2: Implement `s3-get` helper

```ts
// apps/api/src/lib/s3-get.ts
import { getS3Client, getBucket } from "./s3";
import type { Readable } from "node:stream";

export interface StreamedObject {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
}

/**
 * Pull an object from MinIO and adapt the Node Readable into a Web
 * ReadableStream so Hono can forward it straight into `c.body(stream, ...)`.
 * Content-Type / Length come from `statObject` so the browser gets accurate
 * headers without us having to store them in Postgres twice.
 */
export async function streamObject(key: string): Promise<StreamedObject> {
  const client = getS3Client();
  const bucket = getBucket();
  const stat = await client.statObject(bucket, key);
  const nodeStream = (await client.getObject(bucket, key)) as Readable;
  return {
    stream: nodeStreamToWebStream(nodeStream),
    contentType: stat.metaData["content-type"] ?? "application/octet-stream",
    contentLength: stat.size,
  };
}

function nodeStreamToWebStream(node: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      node.destroy();
    },
  });
}
```

### Step 3.3: Implement `note-assets` router

```ts
// apps/api/src/routes/note-assets.ts
import { Hono } from "hono";
import { db, notes, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { streamObject } from "../lib/s3-get";
import type { AppEnv } from "../lib/types";

export const noteAssetRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/:id/file", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

    const [note] = await db.select().from(notes).where(eq(notes.id, id));
    if (!note) return c.json({ error: "Not Found" }, 404);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (!note.sourceFileKey) {
      return c.json({ error: "Not Found" }, 404);
    }

    const obj = await streamObject(note.sourceFileKey);
    c.header("Content-Type", obj.contentType);
    c.header("Content-Length", String(obj.contentLength));
    // Downloaded-file name is best-effort — use the note title sans control
    // chars; browsers fall back to URL tail on sketchy values.
    c.header(
      "Content-Disposition",
      `inline; filename="${note.title.replace(/[\r\n"]/g, "_")}"`,
    );
    return c.body(obj.stream);
  })

  .get("/:id/data", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

    const [note] = await db
      .select({ id: notes.id, contentText: notes.contentText })
      .from(notes)
      .where(eq(notes.id, id));
    if (!note) return c.json({ error: "Not Found" }, 404);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // `contentText` is the flat plaintext projection of the Plate value
    // (populated by the editor save path). For data-mode tabs the note's
    // primary content is a JSON blob, so we try to parse it and return the
    // parsed value. Empty or non-JSON content returns `data: null` rather
    // than 500 — the viewer renders "데이터 없음" in that case.
    let data: unknown = null;
    if (note.contentText && note.contentText.trim()) {
      try {
        data = JSON.parse(note.contentText);
      } catch {
        data = null;
      }
    }
    return c.json({ data });
  });
```

### Step 3.4: Mount in `apps/api/src/index.ts`

```ts
import { noteAssetRoutes } from "./routes/note-assets";
// ...
app.route("/api/notes", noteAssetRoutes);
```

**Important:** mount AFTER `noteRoutes` (or interleave so the `/:id/file` and `/:id/data` paths aren't shadowed by the generic `:id` handler in `notes.ts`). Hono matches in declaration order. Verify by reading the existing mount order at the call site — move the new mount to the position the existing `notes` router occupies, or split into two `.route()` calls with `note-assets` first.

### Step 3.5: Update api-contract

Add a new row under the Notes section of `docs/architecture/api-contract.md`:

```markdown
| `GET` | `/api/notes/:id/file` | `canRead(note)` + `sourceFileKey !== null` | Streams the MinIO object bound to the note. Used by source-mode viewer (PDF). 404 on missing / non-source note. |
| `GET` | `/api/notes/:id/data` | `canRead(note)` | Returns `{ data: <JSON> | null }` parsed from `contentText`. Used by data-mode viewer. Non-JSON content yields `null` (not 500). |
```

### Step 3.6: Commit

```bash
pnpm --filter @opencairn/api test note-assets
pnpm --filter @opencairn/api typecheck
git add apps/api/src/routes/note-assets.ts \
        apps/api/src/lib/s3-get.ts \
        apps/api/src/index.ts \
        apps/api/tests/routes/note-assets.test.ts \
        apps/api/tests/helpers/fixtures.ts \
        docs/architecture/api-contract.md
git commit -m "feat(api): add /api/notes/:id/file and /api/notes/:id/data"
```

---

## Task 4: `StubViewer`

Fallback for modes that have no dedicated viewer yet (`diff`, `artifact`, `presentation`, `spreadsheet`, `whiteboard`, `canvas`, `mindmap`, `flashcard`). Shown via TabModeRouter default branch so missing modes never crash the shell.

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/stub-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/stub-viewer.test.tsx`

### Step 4.1: Test

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StubViewer } from "./stub-viewer";

const messages = {
  appShell: {
    viewers: { stub: { comingSoon: "{mode} 뷰어는 다음 Plan 에서 준비됩니다." } },
  },
};

describe("StubViewer", () => {
  it("interpolates the mode name into the coming-soon copy", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <StubViewer mode="whiteboard" />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("whiteboard 뷰어는 다음 Plan 에서 준비됩니다."),
    ).toBeInTheDocument();
  });
});
```

### Step 4.2: Implement

```tsx
// apps/web/src/components/tab-shell/viewers/stub-viewer.tsx
"use client";
import { useTranslations } from "next-intl";

export function StubViewer({ mode }: { mode: string }) {
  const t = useTranslations("appShell.viewers.stub");
  return (
    <div
      data-testid="stub-viewer"
      className="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      {t("comingSoon", { mode })}
    </div>
  );
}
```

### Step 4.3: Commit

```bash
pnpm --filter @opencairn/web test stub-viewer
git add apps/web/src/components/tab-shell/viewers/stub-viewer.tsx \
        apps/web/src/components/tab-shell/viewers/stub-viewer.test.tsx
git commit -m "feat(web): add StubViewer for non-core tab modes"
```

---

## Task 5: `TabModeRouter`

Thin switch on `Tab.mode`. `plate` mode is intentionally **not** in the switch — TabShell handles plate separately by rendering route `children` (see Task 10). This keeps the SSR editor path untouched.

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- Create: `apps/web/src/components/tab-shell/tab-mode-router.test.tsx`

### Step 5.1: Test

```tsx
// apps/web/src/components/tab-shell/tab-mode-router.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { TabModeRouter } from "./tab-mode-router";
import type { Tab } from "@/stores/tabs-store";

// Shallow-mock the heavy viewers; we only assert that dispatch picks the
// right component. Their own tests cover behavior.
vi.mock("./viewers/reading-viewer", () => ({
  ReadingViewer: () => <div data-testid="reading-viewer" />,
}));
vi.mock("./viewers/source-viewer", () => ({
  SourceViewer: () => <div data-testid="source-viewer" />,
}));
vi.mock("./viewers/data-viewer", () => ({
  DataViewer: () => <div data-testid="data-viewer" />,
}));

const mk = (mode: Tab["mode"]): Tab => ({
  id: "t", kind: "note", targetId: "n1", mode,
  title: "T", titleKey: undefined, titleParams: undefined,
  pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
});

const messages = {
  appShell: { viewers: { stub: { comingSoon: "{mode} coming" } } },
};

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("TabModeRouter", () => {
  it("dispatches reading → ReadingViewer", () => {
    wrap(<TabModeRouter tab={mk("reading")} />);
    expect(screen.getByTestId("reading-viewer")).toBeInTheDocument();
  });

  it("dispatches source → SourceViewer", () => {
    wrap(<TabModeRouter tab={mk("source")} />);
    expect(screen.getByTestId("source-viewer")).toBeInTheDocument();
  });

  it("dispatches data → DataViewer", () => {
    wrap(<TabModeRouter tab={mk("data")} />);
    expect(screen.getByTestId("data-viewer")).toBeInTheDocument();
  });

  it("falls back to StubViewer for non-core modes", () => {
    wrap(<TabModeRouter tab={mk("whiteboard")} />);
    expect(screen.getByTestId("stub-viewer")).toBeInTheDocument();
  });

  it("throws when given plate mode (should be routed via children)", () => {
    // plate goes through Next.js route children, not TabModeRouter. Any
    // caller that routes plate here has a bug — fail loudly.
    expect(() => wrap(<TabModeRouter tab={mk("plate")} />)).toThrow(
      /plate.*children/i,
    );
  });
});
```

### Step 5.2: Implement

```tsx
// apps/web/src/components/tab-shell/tab-mode-router.tsx
"use client";
import type { Tab } from "@/stores/tabs-store";
import { ReadingViewer } from "./viewers/reading-viewer";
import { SourceViewer } from "./viewers/source-viewer";
import { DataViewer } from "./viewers/data-viewer";
import { StubViewer } from "./viewers/stub-viewer";

export function TabModeRouter({ tab }: { tab: Tab }) {
  switch (tab.mode) {
    case "reading":
      return <ReadingViewer tab={tab} />;
    case "source":
      return <SourceViewer tab={tab} />;
    case "data":
      return <DataViewer tab={tab} />;
    case "plate":
      // plate renders through the Next.js route page; TabShell should pick
      // children when mode === 'plate'. Reaching here means a caller bypassed
      // that branch.
      throw new Error(
        "TabModeRouter received plate mode — plate is dispatched via route children, not here.",
      );
    default:
      return <StubViewer mode={tab.mode} />;
  }
}

// Helper for TabShell to decide which branch to take (plate/default-kind →
// children; everything else → TabModeRouter). Exported here so TabShell and
// tests share the same predicate.
export function isRoutedByTabModeRouter(tab: Tab): boolean {
  return tab.mode !== "plate";
}
```

### Step 5.3: Commit

```bash
pnpm --filter @opencairn/web test tab-mode-router
git add apps/web/src/components/tab-shell/tab-mode-router.tsx \
        apps/web/src/components/tab-shell/tab-mode-router.test.tsx
git commit -m "feat(web): add TabModeRouter with stub fallback"
```

---

## Task 6: `ReadingViewer` — readOnly Plate + font slider

Re-enters the same `useCollaborativeEditor` hook the main `NoteEditor` uses, with `readOnly: true`. That keeps the view live (any edit in another tab/session shows up immediately via Yjs) without pulling a stale `notes.content` snapshot.

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/reading-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/reading-viewer.test.tsx`

### Step 6.1: Test

```tsx
// viewers/reading-viewer.test.tsx — focus on the non-Plate shell: font slider
// + metadata fetch. Collaborative editor is mocked out.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ReadingViewer } from "./reading-viewer";

vi.mock("@/hooks/useCollaborativeEditor", () => ({
  useCollaborativeEditor: () => ({
    children: [{ type: "p", children: [{ text: "hello" }] }],
    tf: {},
  }),
  colorFor: () => "#000",
}));

vi.mock("platejs/react", () => ({
  Plate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PlateContent: (p: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="plate-content" {...p} />
  ),
}));

const messages = {
  appShell: { viewers: { reading: { readingTime: "약 {min}분", fontSize: "폰트 크기" } } },
};

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const tab = {
  id: "t", kind: "note" as const, targetId: "n1", mode: "reading" as const,
  title: "T", pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
};

describe("ReadingViewer", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/role")) return new Response(JSON.stringify({ role: "viewer" }));
      if (url.includes("/me")) return new Response(JSON.stringify({ userId: "u1", email: "u@x" }));
      if (url.includes("/api/notes/")) return new Response(JSON.stringify({ id: "n1", title: "T", workspaceId: "w1" }));
      return new Response("{}", { status: 404 });
    }) as never;
  });

  it("renders the Plate content area", async () => {
    wrap(<ReadingViewer tab={tab} />);
    await waitFor(() => expect(screen.getByTestId("plate-content")).toBeInTheDocument());
  });

  it("shows a font-size slider and updates the container fontSize", async () => {
    wrap(<ReadingViewer tab={tab} />);
    const slider = await screen.findByLabelText("폰트 크기");
    fireEvent.change(slider, { target: { value: "20" } });
    expect(
      screen.getByTestId("reading-viewer-body").style.fontSize,
    ).toBe("20px");
  });

  it("renders nothing when tab.targetId is null", () => {
    wrap(<ReadingViewer tab={{ ...tab, targetId: null }} />);
    expect(screen.queryByTestId("plate-content")).toBeNull();
  });
});
```

### Step 6.2: Implement

```tsx
// apps/web/src/components/tab-shell/viewers/reading-viewer.tsx
"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plate, PlateContent } from "platejs/react";
import {
  BlockquotePlugin, BoldPlugin, CodePlugin, H1Plugin, H2Plugin, H3Plugin,
  HorizontalRulePlugin, ItalicPlugin, StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { ListPlugin } from "@platejs/list/react";
import {
  useCollaborativeEditor, colorFor,
} from "@/hooks/useCollaborativeEditor";
import { latexPlugins } from "@/components/editor/plugins/latex";
import type { Tab } from "@/stores/tabs-store";

// Same plugin list as NoteEditor minus wiki-link + slash menu — reading
// mode is content-only, so interactive overlays come off. If you find
// yourself copying more plugins here, promote a shared `readingPlugins`
// array in components/editor/plugins/.
const readingPlugins = [
  BoldPlugin, ItalicPlugin, StrikethroughPlugin, CodePlugin,
  H1Plugin, H2Plugin, H3Plugin, BlockquotePlugin, HorizontalRulePlugin,
  ListPlugin, ...latexPlugins,
];

interface NoteMeta {
  id: string;
  title: string;
  workspaceId: string;
}
interface Me {
  userId: string;
  email: string;
  name?: string | null;
}

export function ReadingViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.reading");
  const [size, setSize] = useState(16);

  const { data: note } = useQuery<NoteMeta>({
    queryKey: ["note-meta", tab.targetId],
    enabled: !!tab.targetId,
    queryFn: async () => {
      const r = await fetch(`/api/notes/${tab.targetId}`);
      if (!r.ok) throw new Error(`note ${r.status}`);
      return (await r.json()) as NoteMeta;
    },
  });

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      if (!r.ok) throw new Error(`me ${r.status}`);
      return (await r.json()) as Me;
    },
  });

  if (!tab.targetId) return null;
  if (!note || !me) {
    return (
      <div
        data-testid="reading-viewer"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        ...
      </div>
    );
  }
  return (
    <ReadingViewerBody
      tab={tab}
      note={note}
      me={me}
      size={size}
      setSize={setSize}
      label={{ fontSize: t("fontSize") }}
    />
  );
}

function ReadingViewerBody({
  tab, note, me, size, setSize, label,
}: {
  tab: Tab; note: NoteMeta; me: Me; size: number;
  setSize: (n: number) => void;
  label: { fontSize: string };
}) {
  const editor = useCollaborativeEditor({
    noteId: note.id,
    user: {
      id: me.userId,
      name: me.name ?? me.email ?? "Anonymous",
      color: colorFor(me.userId),
    },
    readOnly: true,
    basePlugins: readingPlugins,
  });

  return (
    <div data-testid="reading-viewer" className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-border bg-background/80 px-4 py-2 backdrop-blur">
        <input
          type="range" min={14} max={22} step={1}
          value={size} onChange={(e) => setSize(Number(e.target.value))}
          aria-label={label.fontSize}
          className="w-32"
        />
      </div>
      <div
        data-testid="reading-viewer-body"
        style={{ fontSize: `${size}px`, lineHeight: 1.7 }}
        className="mx-auto max-w-[720px] px-6 py-8"
      >
        <Plate editor={editor} readOnly>
          <PlateContent
            data-testid="plate-content"
            readOnly
            className="prose prose-stone max-w-none focus:outline-none"
          />
        </Plate>
      </div>
    </div>
  );
}
```

### Step 6.3: Commit

```bash
pnpm --filter @opencairn/web test reading-viewer
git add apps/web/src/components/tab-shell/viewers/reading-viewer.tsx \
        apps/web/src/components/tab-shell/viewers/reading-viewer.test.tsx
git commit -m "feat(web): add ReadingViewer (read-only Plate + font slider)"
```

---

## Task 7: `SourceViewer` (PDF via `react-pdf`)

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/source-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/source-viewer.test.tsx`
- Modify: `apps/web/package.json`

### Step 7.1: Install

```bash
pnpm --filter @opencairn/web add react-pdf pdfjs-dist
```

### Step 7.2: Test

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceViewer } from "./source-viewer";

vi.mock("react-pdf", () => ({
  Document: ({ onLoadSuccess, children }: any) => {
    // Simulate a 2-page PDF so the Page map renders twice.
    onLoadSuccess?.({ numPages: 2 });
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`} />
  ),
  pdfjs: { GlobalWorkerOptions: {} },
}));

const tab = {
  id: "t", kind: "note" as const, targetId: "n1", mode: "source" as const,
  title: "doc.pdf", pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
};

describe("SourceViewer", () => {
  it("points Document at /api/notes/:id/file and renders every page", () => {
    render(<SourceViewer tab={tab} />);
    expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-page-2")).toBeInTheDocument();
  });

  it("renders nothing when targetId is null", () => {
    const { container } = render(
      <SourceViewer tab={{ ...tab, targetId: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

### Step 7.3: Implement

```tsx
// apps/web/src/components/tab-shell/viewers/source-viewer.tsx
"use client";
import { useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { Tab } from "@/stores/tabs-store";

// pdf.js ships its worker as a separate file. Next's new URL + import.meta.url
// pattern produces a stable worker path the browser can fetch at runtime.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

export function SourceViewer({ tab }: { tab: Tab }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const url = useMemo(
    () => (tab.targetId ? `/api/notes/${tab.targetId}/file` : null),
    [tab.targetId],
  );
  if (!url) return null;

  return (
    <div
      data-testid="source-viewer"
      className="h-full overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900"
    >
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div className="p-6 text-sm text-muted-foreground">…</div>}
        error={<div className="p-6 text-sm text-destructive">PDF 로드 실패</div>}
      >
        {Array.from({ length: numPages ?? 0 }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            className="mx-auto my-2 shadow"
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        ))}
      </Document>
    </div>
  );
}
```

### Step 7.4: Commit

```bash
pnpm --filter @opencairn/web test source-viewer
git add apps/web/src/components/tab-shell/viewers/source-viewer.tsx \
        apps/web/src/components/tab-shell/viewers/source-viewer.test.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add SourceViewer (PDF via react-pdf)"
```

---

## Task 8: `DataViewer` (JSON tree)

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/data-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/data-viewer.test.tsx`
- Modify: `apps/web/package.json`

### Step 8.1: Install

```bash
pnpm --filter @opencairn/web add react-json-view-lite
```

### Step 8.2: Test

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { DataViewer } from "./data-viewer";

const messages = { appShell: { viewers: { data: { empty: "데이터 없음" } } } };

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const tab = {
  id: "t", kind: "note" as const, targetId: "n1", mode: "data" as const,
  title: "T", pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
};

describe("DataViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the parsed JSON tree", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: { answer: 42 } })),
    ) as never;
    wrap(<DataViewer tab={tab} />);
    await waitFor(() =>
      expect(screen.getByText(/answer/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("shows empty-state when data is null", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: null })),
    ) as never;
    wrap(<DataViewer tab={tab} />);
    await waitFor(() =>
      expect(screen.getByText("데이터 없음")).toBeInTheDocument(),
    );
  });

  it("renders nothing when targetId is null", () => {
    const { container } = wrap(<DataViewer tab={{ ...tab, targetId: null }} />);
    expect(container.firstChild).toBeNull();
  });
});
```

### Step 8.3: Implement

```tsx
// apps/web/src/components/tab-shell/viewers/data-viewer.tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import type { Tab } from "@/stores/tabs-store";

export function DataViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.data");
  const { data, isLoading } = useQuery<{ data: unknown }>({
    queryKey: ["note-data", tab.targetId],
    enabled: !!tab.targetId,
    queryFn: async () => {
      const r = await fetch(`/api/notes/${tab.targetId}/data`);
      if (!r.ok) throw new Error(`data ${r.status}`);
      return (await r.json()) as { data: unknown };
    },
  });

  if (!tab.targetId) return null;

  return (
    <div data-testid="data-viewer" className="h-full overflow-auto p-4 text-sm">
      {isLoading ? (
        <p className="text-muted-foreground">…</p>
      ) : data?.data == null ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <JsonView data={data.data as object} style={defaultStyles} />
      )}
    </div>
  );
}
```

### Step 8.4: Commit

```bash
pnpm --filter @opencairn/web test data-viewer
git add apps/web/src/components/tab-shell/viewers/data-viewer.tsx \
        apps/web/src/components/tab-shell/viewers/data-viewer.test.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add DataViewer (JSON tree via react-json-view-lite)"
```

---

## Task 9: TabShell branch — children vs TabModeRouter

The existing `TabShell` renders `children` unconditionally. Add the branch: if there's an active tab whose mode should be routed via `TabModeRouter` (see `isRoutedByTabModeRouter`), render the router; otherwise fall through to `children` (plate editor, dashboard pages, etc.).

**Files:**
- Modify: `apps/web/src/components/tab-shell/tab-shell.tsx`
- Create: `apps/web/src/components/tab-shell/tab-shell.test.tsx`

### Step 9.1: Test

```tsx
// apps/web/src/components/tab-shell/tab-shell.test.tsx
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { TabShell } from "./tab-shell";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

// Stub the TabBar + router so we can assert on the branch choice directly.
vi.mock("./tab-bar", () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock("./tab-mode-router", async () => {
  const actual = await vi.importActual<typeof import("./tab-mode-router")>(
    "./tab-mode-router",
  );
  return {
    ...actual,
    TabModeRouter: ({ tab }: { tab: Tab }) => (
      <div data-testid={`router-${tab.mode}`} />
    ),
  };
});

const messages = {};

function wrap(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <TabShell>{children}</TabShell>
    </NextIntlClientProvider>,
  );
}

const mk = (overrides: Partial<Tab>): Tab => ({
  id: "t", kind: "note", targetId: "n1", mode: "plate",
  title: "T", pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0, ...overrides,
});

describe("TabShell", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws");
  });

  it("renders children when active tab is plate-mode", () => {
    act(() => useTabsStore.getState().addTab(mk({ mode: "plate" })));
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("route-child")).toBeInTheDocument();
    expect(screen.queryByTestId(/^router-/)).toBeNull();
  });

  it("renders TabModeRouter when active tab is non-plate", () => {
    act(() => useTabsStore.getState().addTab(mk({ mode: "reading" })));
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("router-reading")).toBeInTheDocument();
    expect(screen.queryByTestId("route-child")).toBeNull();
  });

  it("renders children when there is no active tab", () => {
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("route-child")).toBeInTheDocument();
  });
});
```

### Step 9.2: Implement

```tsx
// apps/web/src/components/tab-shell/tab-shell.tsx
"use client";
import { useTabsStore } from "@/stores/tabs-store";
import { TabBar } from "./tab-bar";
import { TabModeRouter, isRoutedByTabModeRouter } from "./tab-mode-router";

export function TabShell({ children }: { children: React.ReactNode }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);

  return (
    <main
      data-testid="app-shell-main"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <TabBar />
      <div className="flex min-h-0 flex-1 overflow-auto">
        {active && isRoutedByTabModeRouter(active) ? (
          <TabModeRouter tab={active} />
        ) : (
          children
        )}
      </div>
    </main>
  );
}
```

### Step 9.3: Commit

```bash
pnpm --filter @opencairn/web test tab-shell
git add apps/web/src/components/tab-shell/tab-shell.tsx \
        apps/web/src/components/tab-shell/tab-shell.test.tsx
git commit -m "feat(web): TabShell dispatches non-plate modes to TabModeRouter"
```

---

## Task 10: Mode entry points — `⌘⇧R` toggle + context-menu submenu

Users need a way to reach the new viewers. `⌘⇧R` toggles plate↔reading per spec §5.10.1. The context menu adds an explicit "모드" submenu so source and data are reachable without knowing keyboard shortcuts.

**Files:**
- Create: `apps/web/src/hooks/use-tab-mode-shortcut.ts`
- Create: `apps/web/src/hooks/use-tab-mode-shortcut.test.tsx`
- Create: `apps/web/src/components/tab-shell/tab-mode-submenu.tsx`
- Modify: `apps/web/src/components/tab-shell/tab-context-menu.tsx`
- Modify: `apps/web/src/components/shell/shell-providers.tsx`

### Step 10.1: Failing shortcut test

```tsx
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useTabModeShortcut } from "./use-tab-mode-shortcut";
import { useTabsStore } from "@/stores/tabs-store";

// jsdom reports a non-mac `navigator.platform`, so the hook's
// `isMac() ? e.metaKey : e.ctrlKey` check uses ctrlKey. Always set ctrlKey
// here and keep metaKey piggybacked so the press also works if someone
// flips jsdom's platform in CI config. Do NOT invert the two — firing with
// only metaKey leaves ctrlKey=false and the hook bails.
function press(key: string, mods: { shift?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      metaKey: true,
      ctrlKey: true,
      shiftKey: !!mods.shift,
    }),
  );
}

describe("useTabModeShortcut", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws");
  });

  it("Cmd+Shift+R toggles plate → reading", () => {
    useTabsStore.getState().addTab({
      id: "a", kind: "note", targetId: "n", mode: "plate",
      title: "N", pinned: false, preview: false, dirty: false,
      splitWith: null, splitSide: null, scrollY: 0,
    });
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { shift: true }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("reading");
  });

  it("Cmd+Shift+R toggles reading → plate", () => {
    useTabsStore.getState().addTab({
      id: "a", kind: "note", targetId: "n", mode: "reading",
      title: "N", pinned: false, preview: false, dirty: false,
      splitWith: null, splitSide: null, scrollY: 0,
    });
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { shift: true }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("plate");
  });

  it("no-op when active tab is source/data/stub", () => {
    useTabsStore.getState().addTab({
      id: "a", kind: "note", targetId: "n", mode: "source",
      title: "N", pinned: false, preview: false, dirty: false,
      splitWith: null, splitSide: null, scrollY: 0,
    });
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { shift: true }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("source");
  });
});
```

### Step 10.2: Implement the hook

```ts
// apps/web/src/hooks/use-tab-mode-shortcut.ts
"use client";
import { useEffect } from "react";
import { useTabsStore } from "@/stores/tabs-store";

function isMac() {
  return (
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)
  );
}

export function useTabModeShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "r") return;
      const s = useTabsStore.getState();
      const active = s.tabs.find((t) => t.id === s.activeId);
      if (!active) return;
      // Only plate ↔ reading toggles. Other modes intentionally ignore
      // ⌘⇧R so the shortcut doesn't trap users in source/data.
      if (active.mode === "plate") {
        e.preventDefault();
        s.updateTab(active.id, { mode: "reading" });
      } else if (active.mode === "reading") {
        e.preventDefault();
        s.updateTab(active.id, { mode: "plate" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

### Step 10.3: Mount in `shell-providers.tsx`

Add near the other `useTabKeyboard()` call:

```ts
import { useTabModeShortcut } from "@/hooks/use-tab-mode-shortcut";
// ...
useTabModeShortcut();
```

### Step 10.4: `TabModeSubmenu` inside the tab context menu

```tsx
// apps/web/src/components/tab-shell/tab-mode-submenu.tsx
"use client";
import { useTranslations } from "next-intl";
import {
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  ContextMenuRadioGroup, ContextMenuRadioItem,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab, type TabMode } from "@/stores/tabs-store";

const MODES: TabMode[] = ["plate", "reading", "source", "data"];

export function TabModeSubmenu({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.tabs.menu.mode");
  const updateTab = useTabsStore((s) => s.updateTab);

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t("trigger")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup
          value={tab.mode}
          onValueChange={(v) => updateTab(tab.id, { mode: v as TabMode })}
        >
          {MODES.map((m) => (
            <ContextMenuRadioItem key={m} value={m}>
              {t(`options.${m}`)}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
```

Then mount inside `tab-context-menu.tsx` above the separator before "Close":

```tsx
import { TabModeSubmenu } from "./tab-mode-submenu";
// ...
<ContextMenuSeparator />
<TabModeSubmenu tab={tab} />
<ContextMenuSeparator />
<ContextMenuItem onSelect={() => closeTab(tab.id)}>...</ContextMenuItem>
```

Add the minimum `ContextMenuSub` / `ContextMenuSubTrigger` / `ContextMenuSubContent` / `ContextMenuRadioGroup` / `ContextMenuRadioItem` exports to `@/components/ui/context-menu` if they're not yet wired (shadcn's Radix ContextMenu has them upstream — check the existing file first; extend only if missing).

### Step 10.5: Commit

```bash
pnpm --filter @opencairn/web test use-tab-mode-shortcut
git add apps/web/src/hooks/use-tab-mode-shortcut.ts \
        apps/web/src/hooks/use-tab-mode-shortcut.test.tsx \
        apps/web/src/components/tab-shell/tab-mode-submenu.tsx \
        apps/web/src/components/tab-shell/tab-context-menu.tsx \
        apps/web/src/components/shell/shell-providers.tsx \
        apps/web/src/components/ui/context-menu.tsx   # only if extended
git commit -m "feat(web): mode entry points (⌘⇧R + tab context submenu)"
```

---

## Task 11: i18n keys + parity

**Files:**
- Modify: `apps/web/messages/ko/app-shell.json`
- Modify: `apps/web/messages/en/app-shell.json`

### Step 11.1: ko keys

Add under `appShell.viewers` and extend `appShell.tabs.menu`:

```json
{
  "viewers": {
    "stub": {
      "comingSoon": "{mode} 뷰어는 다음 Plan 에서 준비됩니다."
    },
    "reading": {
      "fontSize": "폰트 크기",
      "readingTime": "약 {min}분"
    },
    "data": {
      "empty": "데이터 없음"
    }
  },
  "tabs": {
    "menu": {
      "mode": {
        "trigger": "모드 변경",
        "options": {
          "plate": "편집 (Plate)",
          "reading": "읽기 전용",
          "source": "원본 (PDF)",
          "data": "데이터 (JSON)"
        }
      }
    }
  }
}
```

Merge these into the existing file structure — do NOT overwrite the existing `appShell.tabs.menu` keys; add a new `mode` sub-object under them.

### Step 11.2: en parity

```json
{
  "viewers": {
    "stub": { "comingSoon": "{mode} viewer ships in a later plan." },
    "reading": { "fontSize": "Font size", "readingTime": "~{min} min" },
    "data": { "empty": "No data" }
  },
  "tabs": {
    "menu": {
      "mode": {
        "trigger": "Change mode",
        "options": {
          "plate": "Edit (Plate)",
          "reading": "Reading",
          "source": "Source (PDF)",
          "data": "Data (JSON)"
        }
      }
    }
  }
}
```

### Step 11.3: Parity check + commit

```bash
pnpm --filter @opencairn/web i18n:parity
git add apps/web/messages/ko/app-shell.json apps/web/messages/en/app-shell.json
git commit -m "feat(web): i18n keys for Phase 3-B viewers + mode submenu"
```

---

## Task 12: E2E — viewer dispatch smoke

Enough to prove the three non-trivial viewers render at all when the tab mode is set. Uses `window.localStorage` injection to set the initial Tab.mode, avoiding the need for a UI path to enter source/data modes before the context submenu lands end-to-end.

**Files:**
- Create: `apps/web/tests/e2e/tab-viewers.spec.ts`

### Step 12.1: Spec

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithNotes, seedSourceNote } from "./helpers";

test.describe("Tab Viewers (3-B)", () => {
  test.beforeEach(async ({ page }) => loginAsTestUser(page));

  test("reading mode renders readOnly plate content via ⌘⇧R", async ({ page }) => {
    const { slug, noteIds } = await seedWorkspaceWithNotes({ count: 1 });
    await page.goto(`/ko/app/w/${slug}/n/${noteIds[0]}`);
    await page.getByTestId("note-body").click();
    // Toggle to reading
    await page.keyboard.press("ControlOrMeta+Shift+R");
    await expect(page.getByTestId("reading-viewer")).toBeVisible();
    // Toggle back
    await page.keyboard.press("ControlOrMeta+Shift+R");
    await expect(page.getByTestId("note-body")).toBeVisible();
  });

  test("source mode renders the SourceViewer scaffold for a PDF note", async ({ page }) => {
    const { slug, noteId } = await seedSourceNote({ mime: "application/pdf" });
    await page.goto(`/ko/app/w/${slug}/n/${noteId}`);
    // Force mode via context menu → 모드 변경 → 원본 (PDF)
    await page.locator('[data-testid^="tab-"]').first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /모드 변경/ }).hover();
    await page.getByRole("menuitemradio", { name: /원본/ }).click();
    await expect(page.getByTestId("source-viewer")).toBeVisible();
  });

  test("data mode renders empty state for a plain note", async ({ page }) => {
    const { slug, noteIds } = await seedWorkspaceWithNotes({ count: 1 });
    await page.goto(`/ko/app/w/${slug}/n/${noteIds[0]}`);
    await page.locator('[data-testid^="tab-"]').first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /모드 변경/ }).hover();
    await page.getByRole("menuitemradio", { name: /데이터/ }).click();
    await expect(page.getByTestId("data-viewer")).toBeVisible();
    await expect(page.getByText("데이터 없음")).toBeVisible();
  });
});
```

If `seedSourceNote` doesn't exist in `apps/web/tests/e2e/helpers.ts`, add it: seed a note row with `sourceType='pdf'`, upload a tiny fixture PDF via the existing `/test-seed-bulk` endpoint or extend that endpoint with a new mode — pick whichever keeps the helpers file minimal and matches Phase 2's fixture seeding pattern.

### Step 12.2: Commit

```bash
git add apps/web/tests/e2e/tab-viewers.spec.ts \
        apps/web/tests/e2e/helpers.ts       # if extended
git commit -m "test(web): e2e smoke for Phase 3-B viewers"
```

---

## Task 13: Post-feature checks + docs + final commit

### Step 13.1: Run all gates

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/api typecheck
pnpm --filter @opencairn/api test
# E2E is deferred in most phases — run locally if the other gates pass:
# pnpm --filter @opencairn/web test:e2e -g "Tab Viewers"
```

Fix any failures inline before moving on. Do not claim completion on a failing suite.

### Step 13.2: Docs

Update `docs/contributing/plans-status.md` — find the Phase 1 table row for `2026-04-23-app-shell-phase-3-tabs.md` and append a sibling row:

```markdown
| `2026-04-25-app-shell-phase-3b-tab-mode-router-and-viewers.md` | ✅ 2026-04-25 (HEAD: <commit>) | App Shell Phase 3-B — TabModeRouter + `reading` / `source` / `data` / stub viewers + `/api/notes/:id/file` + `/api/notes/:id/data`. `Tab.titleKey` render-time resolve closes the ko/en locale lock-in. `⌘⇧R` plate↔reading toggle + tab context-menu "모드" submenu. NoteEditor `onFirstEdit` widened to paste + drop. web ... test / api ... test / i18n ... keys parity. Next: Phase 4 (agent panel) unblocked; auto-detect `source` mode from `notes.source_type` is the only 3-B follow-up. |
```

Also update `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §5.10 marker if any cross-reference points at Phase 3 generically — narrow to 3-A or 3-B as appropriate. (Skim, don't rewrite.)

### Step 13.3: Memory

Write `MEMORY.md` entry pointing at a new `project_plan_app_shell_phase_3b_complete.md` with headline, merge HEAD, counts, follow-ups.

### Step 13.4: Commit

```bash
git add docs/contributing/plans-status.md \
        docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md
git commit -m "docs(docs): mark App Shell Phase 3-B complete"
```

---

## Completion Criteria

- [ ] `Tab.titleKey` persisted on new tabs for every non-note kind; TabItem / TabOverflowMenu render via `useResolvedTabTitle`; switching locale immediately relabels every open tab that has a `titleKey` (note tabs keep their DB-sourced title).
- [ ] `GET /api/notes/:id/file` streams MinIO objects with correct `Content-Type` for PDF sources; 404 on missing `sourceFileKey`; 403 on `canRead=false`; 400 on non-UUID id.
- [ ] `GET /api/notes/:id/data` returns `{ data: <parsed> | null }` from `contentText`; non-JSON content yields `null`; 403/404 parity.
- [ ] `TabModeRouter` dispatches `reading` / `source` / `data` to their respective viewers; everything else falls back to `StubViewer`; receiving `plate` throws (plate goes through Next.js route children).
- [ ] TabShell renders `TabModeRouter` for non-plate active tabs and `children` otherwise; no active tab also falls to `children`.
- [ ] `NoteEditor.onFirstEdit` fires on paste and drop in addition to keystrokes; still one-shot; still no-op in readOnly.
- [ ] `⌘⇧R` toggles `plate` ↔ `reading` on the active tab; no-op on other modes.
- [ ] Tab context menu has a "모드 변경" submenu that changes `Tab.mode` to any of plate/reading/source/data.
- [ ] ko / en i18n parity holds (`pnpm --filter @opencairn/web i18n:parity` green).
- [ ] All touched test suites green; typecheck + lint green.
- [ ] Manual smoke: open a note → press ⌘⇧R → reading viewer with larger font → slider works → press ⌘⇧R → back to editor → paste something into a preview tab → italic goes away.

## What's NOT in this plan

| Item | Follow-up |
|------|-----------|
| Auto-set `Tab.mode='source'` from `notes.source_type='pdf'` on tab open | follow-up after 3-B; needs sync/async meta fetch in use-url-tab-sync |
| Split pane (`⌘⇧\`) | Phase 5 or dedicated plan |
| `artifact` / `presentation` / `spreadsheet` / `whiteboard` / `canvas` / `mindmap` / `flashcard` viewers | Plan 5/6/7 and Plan 10B when those systems land |
| `diff` viewer | depends on Plan 4 SSE `diff` event |
| PDF annotations / text-layer / search inside PDF | out of scope for 3-B — `react-pdf`'s annotation + text layers are disabled for performance |
| Reading mode reading-time estimate ("약 {min}분") | label key is reserved but the compute (word count / 200wpm) lives in a future polish task |
| Agent panel, threads, composer | Phase 4 |
| Command Palette, Quick Open | Phase 5 |
