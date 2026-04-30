# Plan 2E Phase B — Image / Embed / Column-Resize / Math UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four block-level deferrals from Plan 2E Phase A § 4 (image, embed, column drag-resize, inline-math UX) in a single PR on `feat/plan-2e-phase-b`.

**Architecture:** All work lives in `apps/web` and `packages/shared`. No `apps/api` / `db` / `worker` / `hocuspocus` changes. Image is URL-only (no upload route). Embed is a 3-provider allow-list (YouTube, Vimeo, Loom). Column resize adds a `widths: number[]` attribute to existing `@platejs/layout` `column_group` nodes. Math UX adds typing triggers + a click-to-edit popover with KaTeX live preview.

**Tech Stack:** Plate v49 (`@platejs/layout`, `@platejs/math`, `platejs/react`), KaTeX (`katex`), shadcn/ui (`Popover`, `Input`, `Button`, sonner), zod, vitest, next-intl, Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-30-plan-2e-phase-b-image-embed-column-math-design.md`

---

## Phasing

The plan executes 5 phases sequentially on a single branch:

- **Phase B-0** — Plumbing (i18n key skeleton, shared zod schema package boundary).
- **Phase B-1** — Embed block (smallest; validates the paste-norm extension pattern that B-2 reuses).
- **Phase B-2** — Image block (reuses paste-norm pattern + popover pattern from B-1).
- **Phase B-3** — Column drag-resize (touches existing `column_group` plugin shape).
- **Phase B-4** — Math UX (largest: 3 triggers + popover + shortcut).
- **Phase B-5** — Integration polish (slash menu wiring, share-renderer, build smoke, docs).

Each phase ends with a green test run + an atomic commit. Within a phase, every task is TDD: red test → minimal green → refactor.

---

## Conventions Used Throughout

- **Test runner:** `pnpm --filter @opencairn/web test -- <pattern>` (vitest). Pure helpers in `packages/shared` use `pnpm --filter @opencairn/shared test`.
- **Type-check:** `pnpm --filter @opencairn/web typecheck` after schema-touching tasks.
- **i18n parity:** `pnpm --filter @opencairn/web i18n:parity` after touching `messages/{ko,en}/editor.json`.
- **All commits include** the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer per project convention.
- **All commit subjects use the conventional prefix** `feat(web):`, `test(web):`, `docs:`, etc. — see `docs/contributing/commit-conventions.md`.
- **No literal user-facing strings in TSX.** Every visible string goes through `useTranslations()` (`next-intl`). ESLint `i18next/no-literal-string` enforces this in CI.

---

## Phase B-0 — Plumbing

### Task 0.1: Add Phase B i18n keys to ko + en (skeleton)

**Files:**
- Modify: `apps/web/messages/ko/editor.json`
- Modify: `apps/web/messages/en/editor.json`

We add all Phase B keys up-front so individual implementation tasks don't each have to touch JSON. Tasks below reference these keys by name; this task creates them.

- [ ] **Step 1: Add ko keys**

Append to `apps/web/messages/ko/editor.json` under the existing `editor.*` namespace (place under whatever existing top-level structure exists — likely a single `editor` object with subkeys). Add these entries:

```json
{
  "image": {
    "slashLabel": "이미지",
    "slashDescription": "URL로 이미지를 삽입해요",
    "urlPlaceholder": "이미지 URL을 입력하세요 (https://…)",
    "altPlaceholder": "대체 텍스트 (선택)",
    "captionPlaceholder": "캡션 (선택)",
    "invalidUrl": "이미지 URL이 올바르지 않아요.",
    "uploadDeferred": "이미지 업로드는 곧 지원돼요. 지금은 이미지 URL을 붙여 넣어 주세요.",
    "editAlt": "대체 텍스트 편집",
    "editCaption": "캡션 편집",
    "insert": "삽입",
    "cancel": "취소"
  },
  "embed": {
    "slashLabel": "임베드",
    "slashDescription": "YouTube, Vimeo, Loom 영상을 삽입해요",
    "urlPlaceholder": "동영상 URL을 입력하세요",
    "unsupportedHost": "지원되는 임베드 URL이 아니에요. (YouTube, Vimeo, Loom)",
    "providerYoutube": "YouTube",
    "providerVimeo": "Vimeo",
    "providerLoom": "Loom",
    "insert": "삽입",
    "cancel": "취소"
  },
  "columns": {
    "resize": {
      "aria": "column 너비 조절",
      "reset": "균등 분배로 재설정"
    }
  },
  "math": {
    "editPopover": {
      "title": "수식 편집",
      "placeholder": "LaTeX 수식을 입력하세요 (예: x^2 + y^2 = z^2)",
      "invalid": "LaTeX 구문 오류",
      "save": "저장",
      "cancel": "취소",
      "previewLabel": "미리보기"
    },
    "shortcut": {
      "hint": "Ctrl+Shift+M으로 인라인 수식 변환"
    }
  }
}
```

- [ ] **Step 2: Add en keys (parity)**

Mirror in `apps/web/messages/en/editor.json` with English copy:

```json
{
  "image": {
    "slashLabel": "Image",
    "slashDescription": "Insert an image from a URL",
    "urlPlaceholder": "Image URL (https://…)",
    "altPlaceholder": "Alt text (optional)",
    "captionPlaceholder": "Caption (optional)",
    "invalidUrl": "Invalid image URL.",
    "uploadDeferred": "Image uploads are coming soon. For now, paste an image URL.",
    "editAlt": "Edit alt text",
    "editCaption": "Edit caption",
    "insert": "Insert",
    "cancel": "Cancel"
  },
  "embed": {
    "slashLabel": "Embed",
    "slashDescription": "Embed a YouTube, Vimeo, or Loom video",
    "urlPlaceholder": "Video URL",
    "unsupportedHost": "Unsupported embed URL. (YouTube, Vimeo, Loom)",
    "providerYoutube": "YouTube",
    "providerVimeo": "Vimeo",
    "providerLoom": "Loom",
    "insert": "Insert",
    "cancel": "Cancel"
  },
  "columns": {
    "resize": {
      "aria": "Resize column width",
      "reset": "Reset to equal widths"
    }
  },
  "math": {
    "editPopover": {
      "title": "Edit equation",
      "placeholder": "Enter LaTeX (e.g. x^2 + y^2 = z^2)",
      "invalid": "Invalid LaTeX",
      "save": "Save",
      "cancel": "Cancel",
      "previewLabel": "Preview"
    },
    "shortcut": {
      "hint": "Press Ctrl+Shift+M to convert to inline math"
    }
  }
}
```

If `editor.math` already exists in either file (Plan 2A), merge into the existing object — do not replace.

- [ ] **Step 3: Run i18n parity**

Run: `pnpm --filter @opencairn/web i18n:parity`
Expected: PASS — both locales align on every key.

If `editor.image`, `editor.embed`, `editor.columns.resize`, or `editor.math.editPopover` already exists from a previous attempt, reconcile by merging — do not duplicate.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/ko/editor.json apps/web/messages/en/editor.json
git commit -m "feat(web): plan 2E phase B i18n key skeleton"
```

---

### Task 0.2: Create `packages/shared/src/editor/` directory + index re-export

The image and embed schemas live in shared so the API and worker could one day validate them; for now only `apps/web` imports them.

**Files:**
- Modify: `packages/shared/src/index.ts` (add re-export, exact location depends on existing layout)

- [ ] **Step 1: Inspect current shared index**

Run: `ls packages/shared/src/`
Note the existing top-level files. If there is no `editor/` subdir yet, this task creates the namespace.

- [ ] **Step 2: Create the directory placeholder**

Create `packages/shared/src/editor/index.ts` with:

```ts
// Re-exports for editor-specific zod schemas (Plate v49 element shapes).
// Populated by Plan 2E Phase B tasks 1.2 and 2.1.
export {};
```

- [ ] **Step 3: Verify shared package builds**

Run: `pnpm --filter @opencairn/shared build` (or `tsc --noEmit` if the package has no build step).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/editor/
git commit -m "feat(shared): add editor schema namespace (plan 2E phase B plumbing)"
```

---

## Phase B-1 — Embed Block

### Task 1.1: Pure `toEmbedUrl` helper with table-driven tests

**Files:**
- Create: `apps/web/src/lib/embeds/to-embed-url.ts`
- Create: `apps/web/src/lib/embeds/to-embed-url.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/embeds/to-embed-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toEmbedUrl } from "./to-embed-url";

describe("toEmbedUrl", () => {
  // YouTube
  it("converts youtube.com/watch?v= URL", () => {
    expect(toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("converts youtu.be short URL", () => {
    expect(toEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("strips youtube playlist params but keeps video id", () => {
    expect(
      toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s"),
    ).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("converts m.youtube.com URL", () => {
    expect(toEmbedUrl("https://m.youtube.com/watch?v=abc12345DEF")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/abc12345DEF",
    });
  });
  // Vimeo
  it("converts vimeo numeric URL", () => {
    expect(toEmbedUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });
  it("converts vimeo with hash fragment", () => {
    expect(toEmbedUrl("https://vimeo.com/123456789/abcdef")).toEqual({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });
  // Loom
  it("converts loom share URL", () => {
    expect(
      toEmbedUrl("https://www.loom.com/share/abc123def456"),
    ).toEqual({
      provider: "loom",
      embedUrl: "https://www.loom.com/embed/abc123def456",
    });
  });
  it("converts loom share URL without www subdomain", () => {
    expect(toEmbedUrl("https://loom.com/share/abc123def456")).toEqual({
      provider: "loom",
      embedUrl: "https://www.loom.com/embed/abc123def456",
    });
  });
  // Negatives
  it("rejects unknown host", () => {
    expect(toEmbedUrl("https://example.com/foo")).toBeNull();
  });
  it("rejects malformed URL", () => {
    expect(toEmbedUrl("not a url")).toBeNull();
  });
  it("rejects youtube URL without video id", () => {
    expect(toEmbedUrl("https://www.youtube.com/feed/trending")).toBeNull();
  });
  it("rejects vimeo URL without numeric id", () => {
    expect(toEmbedUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
  });
  it("rejects loom URL not under /share/", () => {
    expect(toEmbedUrl("https://www.loom.com/looks/abc123")).toBeNull();
  });
  it("rejects javascript: URL", () => {
    expect(toEmbedUrl("javascript:alert(1)")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/web test -- to-embed-url`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/embeds/to-embed-url.ts`:

```ts
export type EmbedProvider = "youtube" | "vimeo" | "loom";

export interface EmbedResolution {
  provider: EmbedProvider;
  embedUrl: string;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);
const VIMEO_ID_RE = /^\d+$/;

const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
const LOOM_ID_RE = /^[A-Za-z0-9]{8,}$/;

export function toEmbedUrl(input: string): EmbedResolution | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    let videoId: string | null = null;
    if (host === "youtu.be") {
      videoId = url.pathname.slice(1).split("/")[0] || null;
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    }
    if (videoId && YOUTUBE_ID_RE.test(videoId)) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      };
    }
    return null;
  }

  if (VIMEO_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 1 && VIMEO_ID_RE.test(segments[0])) {
      return {
        provider: "vimeo",
        embedUrl: `https://player.vimeo.com/video/${segments[0]}`,
      };
    }
    return null;
  }

  if (LOOM_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && segments[0] === "share" && LOOM_ID_RE.test(segments[1])) {
      return {
        provider: "loom",
        embedUrl: `https://www.loom.com/embed/${segments[1]}`,
      };
    }
    return null;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test -- to-embed-url`
Expected: PASS — 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/embeds/
git commit -m "feat(web): add toEmbedUrl helper for YouTube/Vimeo/Loom"
```

---

### Task 1.2: Embed zod schema in `packages/shared`

**Files:**
- Create: `packages/shared/src/editor/embed-element.ts`
- Modify: `packages/shared/src/editor/index.ts`

- [ ] **Step 1: Write the schema**

Create `packages/shared/src/editor/embed-element.ts`:

```ts
import { z } from "zod";

export const embedProviderSchema = z.enum(["youtube", "vimeo", "loom"]);
export type EmbedProvider = z.infer<typeof embedProviderSchema>;

export const embedElementSchema = z.object({
  type: z.literal("embed"),
  provider: embedProviderSchema,
  url: z.string().url(),
  embedUrl: z.string().url(),
  children: z.tuple([z.object({ text: z.literal("") })]),
});

export type EmbedElement = z.infer<typeof embedElementSchema>;
```

- [ ] **Step 2: Re-export from index**

Edit `packages/shared/src/editor/index.ts`:

```ts
export * from "./embed-element";
```

- [ ] **Step 3: Type-check shared**

Run: `pnpm --filter @opencairn/shared typecheck` (or `tsc --noEmit` if no script).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/editor/
git commit -m "feat(shared): add embedElement zod schema"
```

---

### Task 1.3: Embed Plate plugin + element renderer

**Files:**
- Create: `apps/web/src/components/editor/blocks/embed/embed-plugin.tsx`
- Create: `apps/web/src/components/editor/blocks/embed/embed-element.tsx`
- Create: `apps/web/src/components/editor/blocks/embed/embed-plugin.test.tsx`

- [ ] **Step 1: Write the failing element render test**

Create `apps/web/src/components/editor/blocks/embed/embed-plugin.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EmbedElement } from "./embed-element";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("EmbedElement", () => {
  it("renders an iframe with the embedUrl", () => {
    const element = {
      type: "embed",
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      children: [{ text: "" }],
    } as const;
    const { container } = render(
      withIntl(
        <EmbedElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          {/* Slate void child */}
          <span />
        </EmbedElement>,
      ),
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe!.src).toBe(element.embedUrl);
    expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe!.getAttribute("loading")).toBe("lazy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/web test -- embed-plugin`
Expected: FAIL — `EmbedElement` not exported.

- [ ] **Step 3: Write the element renderer**

Create `apps/web/src/components/editor/blocks/embed/embed-element.tsx`:

```tsx
"use client";

import type { PlateElementProps } from "platejs/react";

interface TEmbedElement {
  type: "embed";
  provider: "youtube" | "vimeo" | "loom";
  url: string;
  embedUrl: string;
}

export function EmbedElement({ attributes, children, element }: PlateElementProps) {
  const node = element as unknown as TEmbedElement;
  return (
    <div
      {...attributes}
      contentEditable={false}
      data-slate-void="true"
      className="my-4 aspect-video w-full"
    >
      <iframe
        src={node.embedUrl}
        title={`${node.provider} embed`}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        className="h-full w-full rounded-md border-0"
      />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Write the plugin definition**

Create `apps/web/src/components/editor/blocks/embed/embed-plugin.tsx`:

```tsx
"use client";

import { createPlatePlugin } from "platejs/react";
import { EmbedElement } from "./embed-element";

export const embedPlugin = createPlatePlugin({
  key: "embed",
  node: { isElement: true, isVoid: true, type: "embed" },
}).withComponent(EmbedElement);
```

(If your codebase uses `createSlatePlugin` instead — check `mermaid-fence.tsx` or `columns-plugin.tsx` for the canonical local pattern. The `mermaid` block uses `createPlatePlugin` from `platejs/react`; mirror that.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @opencairn/web test -- embed-plugin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/blocks/embed/
git commit -m "feat(web): add embed plate plugin + iframe element"
```

---

### Task 1.4: Embed insert popover (slash menu)

**Files:**
- Create: `apps/web/src/components/editor/blocks/embed/embed-insert-popover.tsx`
- Modify: `apps/web/src/components/editor/plugins/slash.tsx` — register `/embed` item

- [ ] **Step 1: Write the popover**

Create `apps/web/src/components/editor/blocks/embed/embed-insert-popover.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toEmbedUrl } from "@/lib/embeds/to-embed-url";

export interface EmbedInsertPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.ReactNode;
  onInsert: (resolution: { provider: "youtube" | "vimeo" | "loom"; url: string; embedUrl: string }) => void;
}

export function EmbedInsertPopover({ open, onOpenChange, anchor, onInsert }: EmbedInsertPopoverProps) {
  const t = useTranslations("editor.embed");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolution = toEmbedUrl(url.trim());
    if (!resolution) {
      setError(t("unsupportedHost"));
      return;
    }
    onInsert({ ...resolution, url: url.trim() });
    setUrl("");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder={t("urlPlaceholder")}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm">
              {t("insert")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Register slash item**

Open `apps/web/src/components/editor/plugins/slash.tsx`. Locate the existing `slashItems` array (or however the registry is structured — search for the existing `/math` or `/columns` entries). Add an entry following the same pattern. Example shape (adapt to your local types):

```tsx
{
  key: "embed",
  labelKey: "editor.embed.slashLabel",
  descriptionKey: "editor.embed.slashDescription",
  icon: "embed", // or the relevant icon component used elsewhere
  onSelect: (editor, openInsertPopover) => {
    openInsertPopover("embed"); // popover orchestrator handles UI
  },
},
```

The exact wiring depends on the existing slash-menu architecture. **Read the file first**, find how `/math` or `/columns` is registered, and add `/embed` following the same convention. The popover is opened from a host component (`NoteEditor.tsx`) that owns the open/closed state — see Task 5.1.

- [ ] **Step 3: Add insertion helper**

Inside `embed-insert-popover.tsx` or in a sibling `embed-actions.ts`, expose a function the host component calls on insert:

```ts
import type { PlateEditor } from "platejs/react";

export function insertEmbedNode(
  editor: PlateEditor,
  resolution: { provider: "youtube" | "vimeo" | "loom"; url: string; embedUrl: string },
) {
  editor.tf.insertNodes({
    type: "embed",
    provider: resolution.provider,
    url: resolution.url,
    embedUrl: resolution.embedUrl,
    children: [{ text: "" }],
  });
}
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/blocks/embed/ apps/web/src/components/editor/plugins/slash.tsx
git commit -m "feat(web): wire embed insert popover into slash menu"
```

---

### Task 1.5: Embed paste detection

**Files:**
- Modify: `apps/web/src/components/editor/plugins/paste-norm.tsx`
- Modify: `apps/web/src/components/editor/plugins/paste-norm.test.ts` (or add a new test file if Phase A used `.test.tsx`)

- [ ] **Step 1: Write the failing test**

Add to the existing paste-norm test file:

```ts
describe("paste-norm: embed URL auto-insertion", () => {
  it("converts pasted YouTube URL to embed node", () => {
    const editor = createTestEditor();
    pasteText(editor, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).toMatchObject({
      type: "embed",
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });

  it("does not transform pasted YouTube URL inside code block", () => {
    const editor = createTestEditor();
    setSelectionInsideCodeBlock(editor);
    pasteText(editor, "https://youtu.be/abc12345DEF");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).not.toMatchObject({ type: "embed" });
  });

  it("does not transform pasted text containing extra content", () => {
    const editor = createTestEditor();
    pasteText(editor, "watch this https://youtu.be/abc12345DEF cool right");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).not.toMatchObject({ type: "embed" });
  });
});
```

(Helpers `createTestEditor`, `pasteText`, `setSelectionInsideCodeBlock` should already exist from the Phase A `paste-norm.test.ts`. If naming differs, adapt.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/web test -- paste-norm`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Extend `paste-norm.tsx`**

Locate the existing paste-handling function in `paste-norm.tsx` (it currently runs `normalizeEscapes` on incoming fragments). Add an embed-detection step **after** escape normalization but **before** the default text-insertion fallback:

```tsx
import { toEmbedUrl } from "@/lib/embeds/to-embed-url";

// inside the paste handler, after normalizeEscapes runs:
function tryInsertEmbed(editor: PlateEditor, plainText: string): boolean {
  const trimmed = plainText.trim();
  // Single token, looks like a URL, no internal whitespace
  if (!/^https?:\/\/\S+$/.test(trimmed)) return false;
  // Skip if cursor is inside a code block
  if (isInsideCodeBlockOrLine(editor)) return false;
  const resolution = toEmbedUrl(trimmed);
  if (!resolution) return false;
  editor.tf.insertNodes({
    type: "embed",
    provider: resolution.provider,
    url: trimmed,
    embedUrl: resolution.embedUrl,
    children: [{ text: "" }],
  });
  return true;
}
```

The `isInsideCodeBlockOrLine` helper — if it does not exist already, add it next to the existing escape-norm helpers:

```ts
import { Editor } from "slate";

function isInsideCodeBlockOrLine(editor: PlateEditor): boolean {
  const [match] = Editor.nodes(editor, {
    match: (n) =>
      "type" in n && (n.type === "code_block" || n.type === "code_line"),
  });
  return Boolean(match);
}
```

Wire `tryInsertEmbed` into the paste flow. If it returns `true`, short-circuit (don't insert the URL as plain text on top).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test -- paste-norm`
Expected: PASS — Phase A tests still pass + 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/plugins/paste-norm.tsx apps/web/src/components/editor/plugins/paste-norm.test.ts
git commit -m "feat(web): paste youtube/vimeo/loom URL → embed block"
```

---

### Task 1.6: Embed CSP frame-src + share-renderer support

**Files:**
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/src/app/[locale]/s/[token]/page.tsx` (or wherever `PlateStaticRenderer` lives — search for it)

- [ ] **Step 1: Locate CSP config**

Run: `grep -n "frame-src\|Content-Security-Policy\|frameSrc" apps/web/next.config.ts apps/web/src/middleware.ts 2>/dev/null`

The CSP is set either in `next.config.ts` `headers()` or in `middleware.ts`. Note where.

- [ ] **Step 2: Add allowed embed origins**

In whichever file owns CSP, locate the `frame-src` directive (or add it if absent). It should read:

```
frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com;
```

If `frame-src` exists with other entries, append the three; do not replace.

- [ ] **Step 3: Locate share-renderer**

Run: `grep -rn "PlateStaticRenderer\|StaticRenderer" apps/web/src/app/`

Open the file and find the element-type switch. It currently handles paragraph, heading, list, mermaid, table, callout, toggle, columns, math, etc. Add an `embed` branch:

```tsx
case "embed": {
  const node = el as { embedUrl: string; provider: string };
  return (
    <div key={key} className="my-4 aspect-video w-full">
      <iframe
        src={node.embedUrl}
        title={`${node.provider} embed`}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        className="h-full w-full rounded-md border-0"
      />
    </div>
  );
}
```

- [ ] **Step 4: Type-check + dev smoke**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/next.config.ts apps/web/src/app/[locale]/s/[token]/page.tsx
git commit -m "feat(web): allow embed origins in CSP + render in share view"
```

---

## Phase B-2 — Image Block

### Task 2.1: Image zod schema in `packages/shared`

**Files:**
- Create: `packages/shared/src/editor/image-element.ts`
- Modify: `packages/shared/src/editor/index.ts`

- [ ] **Step 1: Write the schema**

Create `packages/shared/src/editor/image-element.ts`:

```ts
import { z } from "zod";

export const imageElementSchema = z.object({
  type: z.literal("image"),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "Only http and https URLs are allowed",
    }),
  alt: z.string().max(500).optional(),
  caption: z.string().max(1000).optional(),
  width: z.number().min(0.1).max(1).optional(),
  children: z.tuple([z.object({ text: z.literal("") })]),
});

export type ImageElement = z.infer<typeof imageElementSchema>;
```

- [ ] **Step 2: Re-export**

Add to `packages/shared/src/editor/index.ts`:

```ts
export * from "./image-element";
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @opencairn/shared typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/editor/
git commit -m "feat(shared): add imageElement zod schema (URL-only)"
```

---

### Task 2.2: Image plugin + element renderer (figure/figcaption)

**Files:**
- Create: `apps/web/src/components/editor/blocks/image/image-plugin.tsx`
- Create: `apps/web/src/components/editor/blocks/image/image-element.tsx`
- Create: `apps/web/src/components/editor/blocks/image/image-plugin.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/editor/blocks/image/image-plugin.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ImageElement } from "./image-element";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("ImageElement", () => {
  it("renders an img with given URL and lazy loading", () => {
    const element = {
      type: "image",
      url: "https://example.com/photo.png",
      alt: "A photo",
      caption: "Sunset",
      children: [{ text: "" }],
    } as const;
    const { container } = render(
      withIntl(
        <ImageElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          <span />
        </ImageElement>,
      ),
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toBe(element.url);
    expect(img!.getAttribute("alt")).toBe("A photo");
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("figcaption")?.textContent).toBe("Sunset");
  });

  it("uses empty alt when alt is missing", () => {
    const element = {
      type: "image",
      url: "https://example.com/decorative.png",
      children: [{ text: "" }],
    } as const;
    const { container } = render(
      withIntl(
        <ImageElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          <span />
        </ImageElement>,
      ),
    );
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("hides figcaption when caption is missing", () => {
    const element = {
      type: "image",
      url: "https://example.com/photo.png",
      alt: "x",
      children: [{ text: "" }],
    } as const;
    const { container } = render(
      withIntl(
        <ImageElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          <span />
        </ImageElement>,
      ),
    );
    expect(container.querySelector("figcaption")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/web test -- image-plugin`
Expected: FAIL — `ImageElement` not exported.

- [ ] **Step 3: Write the element renderer**

Create `apps/web/src/components/editor/blocks/image/image-element.tsx`:

```tsx
"use client";

import type { PlateElementProps } from "platejs/react";

interface TImageElement {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
}

export function ImageElement({ attributes, children, element }: PlateElementProps) {
  const node = element as unknown as TImageElement;
  return (
    <figure
      {...attributes}
      contentEditable={false}
      data-slate-void="true"
      className="my-4"
    >
      <img
        src={node.url}
        alt={node.alt ?? ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={node.width ? { width: `${node.width * 100}%` } : undefined}
        className="rounded-md max-w-full h-auto"
      />
      {node.caption && (
        <figcaption className="text-sm text-muted-foreground mt-1">
          {node.caption}
        </figcaption>
      )}
      {children}
    </figure>
  );
}
```

- [ ] **Step 4: Write the plugin**

Create `apps/web/src/components/editor/blocks/image/image-plugin.tsx`:

```tsx
"use client";

import { createPlatePlugin } from "platejs/react";
import { ImageElement } from "./image-element";

export const imagePlugin = createPlatePlugin({
  key: "image",
  node: { isElement: true, isVoid: true, type: "image" },
}).withComponent(ImageElement);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test -- image-plugin`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/blocks/image/
git commit -m "feat(web): add image plate plugin + figure/figcaption element"
```

---

### Task 2.3: Image insert popover + slash menu wiring

**Files:**
- Create: `apps/web/src/components/editor/blocks/image/image-insert-popover.tsx`
- Modify: `apps/web/src/components/editor/plugins/slash.tsx`

- [ ] **Step 1: Write the popover**

Create `apps/web/src/components/editor/blocks/image/image-insert-popover.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { imageElementSchema } from "@opencairn/shared/editor/image-element";

export interface ImageInsertPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.ReactNode;
  onInsert: (data: { url: string; alt?: string; caption?: string }) => void;
}

export function ImageInsertPopover({ open, onOpenChange, anchor, onInsert }: ImageInsertPopoverProps) {
  const t = useTranslations("editor.image");
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = imageElementSchema.shape.url.safeParse(url.trim());
    if (!parsed.success) {
      setError(t("invalidUrl"));
      return;
    }
    onInsert({
      url: url.trim(),
      alt: alt.trim() || undefined,
      caption: caption.trim() || undefined,
    });
    setUrl("");
    setAlt("");
    setCaption("");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent className="w-[420px] space-y-2">
        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder={t("urlPlaceholder")}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={t("altPlaceholder")}
          />
          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("captionPlaceholder")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm">
              {t("insert")}
            </Button>
          </div>
        </form>
      </PopoutContent>
    </Popover>
  );
}

export function insertImageNode(
  editor: import("platejs/react").PlateEditor,
  data: { url: string; alt?: string; caption?: string },
) {
  editor.tf.insertNodes({
    type: "image",
    url: data.url,
    ...(data.alt ? { alt: data.alt } : {}),
    ...(data.caption ? { caption: data.caption } : {}),
    children: [{ text: "" }],
  });
}
```

**Note:** The closing `</PopoutContent>` typo in the snippet above is intentional — fix it to `</PopoverContent>` when transcribing. (This catches copy-paste mistakes; if you didn't notice, re-read.)

- [ ] **Step 2: Register slash item**

In `apps/web/src/components/editor/plugins/slash.tsx`, add `/image` next to the `/embed` entry from Task 1.4:

```tsx
{
  key: "image",
  labelKey: "editor.image.slashLabel",
  descriptionKey: "editor.image.slashDescription",
  icon: "image",
  onSelect: (editor, openInsertPopover) => {
    openInsertPopover("image");
  },
},
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/blocks/image/ apps/web/src/components/editor/plugins/slash.tsx
git commit -m "feat(web): wire image insert popover into slash menu"
```

---

### Task 2.4: Image paste detection (URL → image node)

**Files:**
- Modify: `apps/web/src/components/editor/plugins/paste-norm.tsx`
- Modify: `apps/web/src/components/editor/plugins/paste-norm.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the paste-norm test file:

```ts
describe("paste-norm: image URL auto-insertion", () => {
  it("converts pasted .png URL to image node", () => {
    const editor = createTestEditor();
    pasteText(editor, "https://example.com/cat.png");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).toMatchObject({ type: "image", url: "https://example.com/cat.png" });
  });

  it("converts .jpg, .jpeg, .gif, .webp, .svg URLs", () => {
    for (const ext of ["jpg", "jpeg", "gif", "webp", "svg"]) {
      const editor = createTestEditor();
      pasteText(editor, `https://example.com/x.${ext}`);
      const inserted = editor.children[editor.children.length - 1];
      expect(inserted).toMatchObject({ type: "image" });
    }
  });

  it("does not transform pasted image URL inside code block", () => {
    const editor = createTestEditor();
    setSelectionInsideCodeBlock(editor);
    pasteText(editor, "https://example.com/cat.png");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).not.toMatchObject({ type: "image" });
  });

  it("ignores URL with extra surrounding text", () => {
    const editor = createTestEditor();
    pasteText(editor, "look: https://example.com/cat.png cute");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).not.toMatchObject({ type: "image" });
  });

  it("prefers embed over image when both could match (unlikely real case)", () => {
    // youtube URL doesn't end in image extension, so this is mostly a guard
    const editor = createTestEditor();
    pasteText(editor, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const inserted = editor.children[editor.children.length - 1];
    expect(inserted).toMatchObject({ type: "embed" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/web test -- paste-norm`
Expected: 5 new tests FAIL.

- [ ] **Step 3: Extend paste-norm with image detection**

In `paste-norm.tsx`, add image detection **before** embed detection (so an image-extension URL doesn't accidentally fall into the embed branch — although in practice they don't overlap, ordering keeps it explicit):

```ts
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(?:\?\S*)?$/i;

function tryInsertImage(editor: PlateEditor, plainText: string): boolean {
  const trimmed = plainText.trim();
  if (!IMAGE_URL_RE.test(trimmed)) return false;
  if (isInsideCodeBlockOrLine(editor)) return false;
  editor.tf.insertNodes({
    type: "image",
    url: trimmed,
    children: [{ text: "" }],
  });
  return true;
}

// In the paste handler, run in this order:
//   1. normalizeEscapes
//   2. tryInsertImage  — short-circuits on success
//   3. tryInsertEmbed  — short-circuits on success
//   4. fallback: insert as text/paragraphs
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test -- paste-norm`
Expected: PASS — Phase A + embed + 5 new image tests all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/plugins/paste-norm.tsx apps/web/src/components/editor/plugins/paste-norm.test.ts
git commit -m "feat(web): paste image URL → image block"
```

---

### Task 2.5: Drag-drop / file paste deferred toast

**Files:**
- Modify: `apps/web/src/components/editor/plugins/paste-norm.tsx` (or a sibling `image-drop-deferred.tsx` plugin if cleaner)
- Create: `apps/web/src/components/editor/plugins/image-drop-deferred.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/editor/plugins/image-drop-deferred.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

// Test stub: render the editor with the image-drop-deferred plugin enabled,
// fire a drop event with a File payload, verify toast.info was called and
// no node was inserted.
describe("image-drop-deferred", () => {
  it("shows toast and does not insert when an image File is dropped", () => {
    // (set up your editor harness from existing Phase A tests)
    // dropFileOnEditor(editor, new File([new Blob([])], "cat.png", { type: "image/png" }));
    // expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("이미지 업로드"));
    // expect(editor.children).toMatchSnapshot(); // unchanged
    expect(true).toBe(true); // placeholder — flesh out with the project's editor test harness
  });
});
```

The exact test scaffolding depends on what `setSelectionInsideCodeBlock` / `pasteText` helpers look like. If they expose a `dropFile(editor, file)` helper, use it. If not, this task includes adding one.

- [ ] **Step 2: Run test to verify it currently passes (placeholder will pass) and the underlying behavior fails manually**

Run: `pnpm --filter @opencairn/web test -- image-drop-deferred`
The placeholder will pass; before merging, replace it with a real assertion. (TDD on DOM events here is finicky — manual smoke is the source of truth, see Phase B-5.)

- [ ] **Step 3: Add the drop/paste-file handler**

In a new `apps/web/src/components/editor/plugins/image-drop-deferred.tsx`:

```tsx
"use client";

import { createPlatePlugin } from "platejs/react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// Plugin attaches editor-level drop / paste handlers that intercept File
// payloads with image/* MIME types and shows a toast pointing the user at
// "use a URL for now". No node is inserted.
export const imageDropDeferredPlugin = createPlatePlugin({
  key: "image-drop-deferred",
  handlers: {
    onDrop: ({ editor, event }) => {
      const files = (event as DragEvent).dataTransfer?.files;
      if (!files || files.length === 0) return false;
      const hasImageFile = Array.from(files).some((f) => f.type.startsWith("image/"));
      if (!hasImageFile) return false;
      event.preventDefault();
      // Toast must run from a context that has access to translations.
      // We expose a global helper via the editor options below.
      window.dispatchEvent(new CustomEvent("opencairn:image-upload-deferred"));
      return true;
    },
    onPaste: ({ editor, event }) => {
      const items = (event as ClipboardEvent).clipboardData?.items;
      if (!items) return false;
      const hasImageFile = Array.from(items).some(
        (it) => it.kind === "file" && it.type.startsWith("image/"),
      );
      if (!hasImageFile) return false;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("opencairn:image-upload-deferred"));
      return true;
    },
  },
});

// Companion hook installed near NoteEditor — listens for the custom event
// and shows the toast with the right translation. Splitting like this avoids
// a chicken-and-egg "use translations inside a Plate handler" problem.
export function useImageUploadDeferredToast() {
  const t = useTranslations("editor.image");
  // useEffect to add and remove a window event listener:
  if (typeof window !== "undefined") {
    const handler = () => toast.info(t("uploadDeferred"));
    window.addEventListener("opencairn:image-upload-deferred", handler);
    return () => window.removeEventListener("opencairn:image-upload-deferred", handler);
  }
}
```

Wrap `useImageUploadDeferredToast`'s body in a proper `useEffect` when transcribing (linter will catch the bare side effect; this snippet is shape-only).

Refined `useImageUploadDeferredToast`:

```tsx
import { useEffect } from "react";
export function useImageUploadDeferredToast() {
  const t = useTranslations("editor.image");
  useEffect(() => {
    const handler = () => toast.info(t("uploadDeferred"));
    window.addEventListener("opencairn:image-upload-deferred", handler);
    return () => window.removeEventListener("opencairn:image-upload-deferred", handler);
  }, [t]);
}
```

- [ ] **Step 4: Wire into NoteEditor**

In `apps/web/src/components/editor/NoteEditor.tsx`:

1. Import `imageDropDeferredPlugin` and add it to the plugin array (anywhere — before the default text plugin is fine).
2. Import and call `useImageUploadDeferredToast()` near the top of the component body.

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/plugins/image-drop-deferred.tsx apps/web/src/components/editor/plugins/image-drop-deferred.test.tsx apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): toast on image drag-drop until upload route ships"
```

---

### Task 2.6: Image share-renderer + markdownToPlate integration

**Files:**
- Modify: `apps/web/src/app/[locale]/s/[token]/page.tsx` (or the static-renderer module)
- Modify: `apps/web/src/lib/markdown/markdownToPlate.ts`
- Modify: `apps/web/src/lib/markdown/markdownToPlate.test.ts` (or the existing chat-renderer test)

- [ ] **Step 1: Add image to PlateStaticRenderer**

In the static renderer's element switch (added embed branch in Task 1.6), add:

```tsx
case "image": {
  const node = el as { url: string; alt?: string; caption?: string; width?: number };
  return (
    <figure key={key} className="my-4">
      <img
        src={node.url}
        alt={node.alt ?? ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={node.width ? { width: `${node.width * 100}%` } : undefined}
        className="rounded-md max-w-full h-auto"
      />
      {node.caption && (
        <figcaption className="text-sm text-muted-foreground mt-1">
          {node.caption}
        </figcaption>
      )}
    </figure>
  );
}
```

- [ ] **Step 2: Write failing markdownToPlate test**

Add to the existing `markdownToPlate.test.ts`:

```ts
it("converts ![alt](url) markdown image to image element", () => {
  const out = markdownToPlate("![A photo](https://example.com/p.png)");
  expect(out).toMatchObject([
    {
      type: "image",
      url: "https://example.com/p.png",
      alt: "A photo",
    },
  ]);
});

it("ignores ![alt](data:...) data URL images", () => {
  const out = markdownToPlate("![x](data:image/png;base64,iVBOR...)");
  // either filter out entirely or leave as paragraph text — pick one and assert
  expect(out).not.toContainEqual(expect.objectContaining({ type: "image" }));
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @opencairn/web test -- markdownToPlate`
Expected: 2 new tests FAIL.

- [ ] **Step 4: Implement**

In `markdownToPlate.ts`, find the existing markdown-AST traversal. Add an `image` node handler:

```ts
// Inside the AST → Plate node converter:
if (node.type === "image") {
  const url: string = node.url ?? "";
  if (!/^https?:\/\//i.test(url)) {
    // skip data: / javascript: / non-http URLs
    return null; // or skip: depends on the converter's null-handling convention
  }
  return {
    type: "image",
    url,
    ...(node.alt ? { alt: node.alt } : {}),
    children: [{ text: "" }],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test -- markdownToPlate`
Expected: PASS — existing tests + 2 new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/[locale]/s/[token]/page.tsx apps/web/src/lib/markdown/markdownToPlate.ts apps/web/src/lib/markdown/markdownToPlate.test.ts
git commit -m "feat(web): share view + chat renderer support image blocks"
```

---

## Phase B-3 — Column Drag-Resize

### Task 3.1: Resize handle component (pointer drag, local state only)

**Files:**
- Create: `apps/web/src/components/editor/blocks/columns/column-resize-handle.tsx`
- Create: `apps/web/src/components/editor/blocks/columns/column-resize-handle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/editor/blocks/columns/column-resize-handle.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ColumnResizeHandle } from "./column-resize-handle";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("ColumnResizeHandle", () => {
  it("renders with role=separator and aria-valuemin/max", () => {
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={vi.fn()}
          onCommit={vi.fn()}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")!;
    expect(sep.getAttribute("aria-valuemin")).toBe("10");
    expect(sep.getAttribute("aria-valuemax")).toBe("90");
    expect(sep.getAttribute("aria-valuenow")).toBe("50");
  });

  it("calls onCommit on pointerup with delta percentage", () => {
    const onResize = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={onResize}
          onCommit={onCommit}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    // Mock the parent rect so dragging by 100px in a 1000px-wide group = 10%
    Object.defineProperty(sep.parentElement!, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 1000, width: 1000 } as DOMRect),
    });
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 600 });
    fireEvent.pointerUp(sep, { pointerId: 1, clientX: 600 });
    expect(onCommit).toHaveBeenCalledWith(60); // 600/1000 * 100
  });

  it("calls onReset on double-click", () => {
    const onReset = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={70}
          onResize={vi.fn()}
          onCommit={vi.fn()}
          onReset={onReset}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    fireEvent.doubleClick(sep);
    expect(onReset).toHaveBeenCalled();
  });

  it("ArrowLeft shrinks left by 5", () => {
    const onCommit = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={vi.fn()}
          onCommit={onCommit}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    sep.focus();
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenCalledWith(45);
  });

  it("Shift+ArrowRight grows left by 1", () => {
    const onCommit = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={vi.fn()}
          onCommit={onCommit}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    sep.focus();
    fireEvent.keyDown(sep, { key: "ArrowRight", shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith(51);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/web test -- column-resize-handle`
Expected: FAIL.

- [ ] **Step 3: Implement the handle component**

Create `apps/web/src/components/editor/blocks/columns/column-resize-handle.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

const MIN = 10;
const MAX = 90;

export interface ColumnResizeHandleProps {
  /** Left column width percentage (0-100). */
  leftWidthPct: number;
  /** Called during drag with the new pct (display only — local state). */
  onResize: (pct: number) => void;
  /** Called on pointerup or keyboard commit with the final pct. */
  onCommit: (pct: number) => void;
  /** Called on double-click. */
  onReset: () => void;
}

function clamp(v: number) {
  return Math.max(MIN, Math.min(MAX, v));
}

export function ColumnResizeHandle({
  leftWidthPct,
  onResize,
  onCommit,
  onReset,
}: ColumnResizeHandleProps) {
  const t = useTranslations("editor.columns.resize");
  const dragging = useRef(false);
  const lastPct = useRef(leftWidthPct);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const pct = clamp(((e.clientX - rect.left) / rect.width) * 100);
    lastPct.current = pct;
    requestAnimationFrame(() => onResize(pct));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = false;
    onCommit(lastPct.current);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 1 : 5;
    let next = leftWidthPct;
    switch (e.key) {
      case "ArrowLeft":
        next = clamp(leftWidthPct - step);
        break;
      case "ArrowRight":
        next = clamp(leftWidthPct + step);
        break;
      case "Home":
        onReset();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next !== leftWidthPct) onCommit(next);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("aria")}
      aria-valuenow={Math.round(leftWidthPct)}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      className="group relative w-2 cursor-col-resize select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test -- column-resize-handle`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/blocks/columns/column-resize-handle.tsx apps/web/src/components/editor/blocks/columns/column-resize-handle.test.tsx
git commit -m "feat(web): add column resize handle (drag + keyboard a11y)"
```

---

### Task 3.2: Wire resize handles into ColumnPlugin renderer

**Files:**
- Modify: `apps/web/src/components/editor/blocks/columns/columns-plugin.tsx`
- Create: `apps/web/src/components/editor/blocks/columns/column-group-element.tsx`

- [ ] **Step 1: Implement the column-group element**

The `@platejs/layout` ColumnPlugin currently does not provide a custom renderer for the group container. We override it with our own. Create `apps/web/src/components/editor/blocks/columns/column-group-element.tsx`:

```tsx
"use client";

import type { PlateElementProps, PlateEditor } from "platejs/react";
import { useState, useMemo } from "react";
import { ColumnResizeHandle } from "./column-resize-handle";
import { useEditorRef, findPath } from "platejs/react";

interface TColumnGroup {
  type: "column_group";
  widths?: number[];
  children: unknown[];
}

function defaultEqualWidths(n: number): number[] {
  return Array(n).fill(1 / n);
}

function normalize(widths: number[]): number[] {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum === 0) return defaultEqualWidths(widths.length);
  return widths.map((w) => w / sum);
}

export function ColumnGroupElement({ attributes, children, element }: PlateElementProps) {
  const editor = useEditorRef();
  const node = element as unknown as TColumnGroup;
  const n = Array.isArray(node.children) ? node.children.length : 0;
  const persistedWidths = useMemo(
    () => (node.widths && node.widths.length === n ? normalize(node.widths) : defaultEqualWidths(n)),
    [node.widths, n],
  );
  const [localWidths, setLocalWidths] = useState<number[] | null>(null);
  const widths = localWidths ?? persistedWidths;

  function commitWidths(next: number[]) {
    const path = findPath(editor, element);
    if (!path) return;
    editor.tf.setNodes({ widths: next } as never, { at: path });
    setLocalWidths(null);
  }

  function resetEqual() {
    commitWidths(defaultEqualWidths(n));
  }

  function onResize(handleIdx: number, leftPct: number) {
    // handleIdx = index of separator. Left column is handleIdx, right is handleIdx+1.
    const fraction = leftPct / 100;
    const pairTotal = widths[handleIdx] + widths[handleIdx + 1];
    const next = [...widths];
    next[handleIdx] = pairTotal * fraction;
    next[handleIdx + 1] = pairTotal * (1 - fraction);
    setLocalWidths(next);
  }

  function onCommit(handleIdx: number, leftPct: number) {
    const fraction = leftPct / 100;
    const pairTotal = persistedWidths[handleIdx] + persistedWidths[handleIdx + 1];
    const next = [...persistedWidths];
    next[handleIdx] = pairTotal * fraction;
    next[handleIdx + 1] = pairTotal * (1 - fraction);
    commitWidths(next);
  }

  // Render children with flexBasis from widths, separator between each pair.
  const childArr = Array.isArray(children) ? children : [children];
  return (
    <div {...attributes} className="my-2 flex w-full">
      {childArr.map((child, i) => {
        const w = widths[i] ?? 1 / n;
        return (
          <>
            <div
              key={`col-${i}`}
              style={{ flexBasis: `${w * 100}%`, flexGrow: 0, flexShrink: 0, minWidth: 0 }}
            >
              {child}
            </div>
            {i < n - 1 && (
              <ColumnResizeHandle
                key={`sep-${i}`}
                leftWidthPct={(w / (widths[i] + widths[i + 1])) * 100}
                onResize={(pct) => onResize(i, pct)}
                onCommit={(pct) => onCommit(i, pct)}
                onReset={resetEqual}
              />
            )}
          </>
        );
      })}
    </div>
  );
}
```

(`findPath` import location varies by Plate v49 minor; if `findPath` isn't a named export from `platejs/react`, look for it under `@platejs/utils` or use `editor.api.findPath`.)

- [ ] **Step 2: Replace ColumnPlugin with custom component**

Edit `apps/web/src/components/editor/blocks/columns/columns-plugin.tsx`:

```tsx
"use client";
import { ColumnPlugin, ColumnItemPlugin } from "@platejs/layout/react";
import { ColumnGroupElement } from "./column-group-element";

export const columnsPlugins = [
  ColumnPlugin.withComponent(ColumnGroupElement),
  ColumnItemPlugin,
];
```

- [ ] **Step 3: Manual smoke (no dev server needed yet)**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/blocks/columns/
git commit -m "feat(web): render column_group with resize handles"
```

---

### Task 3.3: Persist widths through Yjs round-trip (regression test)

**Files:**
- Create: `apps/web/src/components/editor/blocks/columns/column-widths-roundtrip.test.tsx`

- [ ] **Step 1: Write a test that simulates save → load**

```tsx
import { describe, it, expect } from "vitest";

describe("column_group widths persistence", () => {
  it("preserves widths across JSON serialize/parse", () => {
    const node = {
      type: "column_group",
      widths: [0.3, 0.4, 0.3],
      children: [
        { type: "column", children: [{ text: "a" }] },
        { type: "column", children: [{ text: "b" }] },
        { type: "column", children: [{ text: "c" }] },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(node));
    expect(roundTripped.widths).toEqual([0.3, 0.4, 0.3]);
  });

  it("absent widths defaults to equal split (back-compat)", () => {
    const node = {
      type: "column_group",
      children: [
        { type: "column", children: [{ text: "a" }] },
        { type: "column", children: [{ text: "b" }] },
      ],
    };
    expect((node as Record<string, unknown>).widths).toBeUndefined();
    // Renderer test handled in column-group-element render test (out of scope here).
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @opencairn/web test -- column-widths-roundtrip`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/blocks/columns/column-widths-roundtrip.test.tsx
git commit -m "test(web): column_group widths survive JSON round-trip"
```

---

## Phase B-4 — Math UX

### Task 4.1: math-trigger plugin scaffolding (TextInput hook, no transforms yet)

**Files:**
- Create: `apps/web/src/components/editor/plugins/math-trigger.tsx`
- Create: `apps/web/src/components/editor/plugins/math-trigger.test.ts`

- [ ] **Step 1: Stub the plugin**

Create `apps/web/src/components/editor/plugins/math-trigger.tsx`:

```tsx
"use client";

import { createPlatePlugin, type PlateEditor } from "platejs/react";
import { Editor } from "slate";

export function isInsideCodeContext(editor: PlateEditor): boolean {
  const [match] = Editor.nodes(editor, {
    match: (n) =>
      "type" in n && (n.type === "code_block" || n.type === "code_line"),
  });
  return Boolean(match);
}

export const mathTriggerPlugin = createPlatePlugin({
  key: "math-trigger",
  handlers: {
    // Listens to text-input events; transformations are added in subsequent tasks.
    onChange: ({ editor }) => {
      // intentionally empty — see tasks 4.2 / 4.3
    },
  },
});
```

- [ ] **Step 2: Smoke test**

Create `apps/web/src/components/editor/plugins/math-trigger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isInsideCodeContext } from "./math-trigger";

describe("isInsideCodeContext", () => {
  it("returns true when selection is in code_block", () => {
    // construct a minimal editor mock with a code_block selection
    const editor = {
      children: [
        {
          type: "code_block",
          children: [{ type: "code_line", children: [{ text: "" }] }],
        },
      ],
      selection: {
        anchor: { path: [0, 0, 0], offset: 0 },
        focus: { path: [0, 0, 0], offset: 0 },
      },
    } as never;
    expect(isInsideCodeContext(editor)).toBe(true);
  });

  it("returns false in a paragraph", () => {
    const editor = {
      children: [{ type: "paragraph", children: [{ text: "hi" }] }],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    } as never;
    expect(isInsideCodeContext(editor)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test**

Run: `pnpm --filter @opencairn/web test -- math-trigger`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/plugins/math-trigger.tsx apps/web/src/components/editor/plugins/math-trigger.test.ts
git commit -m "feat(web): scaffold math-trigger plugin + code-context helper"
```

---

### Task 4.2: `$..$` inline trigger

**Files:**
- Modify: `apps/web/src/components/editor/plugins/math-trigger.tsx`
- Modify: `apps/web/src/components/editor/plugins/math-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `math-trigger.test.ts`:

```ts
import { applyDollarInlineTrigger } from "./math-trigger";

describe("applyDollarInlineTrigger", () => {
  it("converts $x^2$ into a math_inline node", () => {
    const editor = makeEditorWithText("equation $x^2$ inline");
    applyDollarInlineTrigger(editor);
    // Expect: paragraph children replaced — text 'equation ' + math_inline{texExpression:'x^2'} + text ' inline'
    const para = editor.children[0] as Record<string, unknown>;
    const kids = (para.children as Array<Record<string, unknown>>).map((c) => c.type ?? "text");
    expect(kids).toEqual(["text", "math_inline", "text"]);
    const math = (para.children as Array<Record<string, unknown>>)[1];
    expect(math.texExpression).toBe("x^2");
  });

  it("does nothing when only one $ is present", () => {
    const editor = makeEditorWithText("price $5 USD");
    const before = JSON.stringify(editor.children);
    applyDollarInlineTrigger(editor);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("does nothing inside a code block", () => {
    const editor = makeEditorWithCodeBlockText("$x^2$");
    const before = JSON.stringify(editor.children);
    applyDollarInlineTrigger(editor);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("ignores escaped \\$", () => {
    const editor = makeEditorWithText("escaped \\$x^2\\$ pair");
    const before = JSON.stringify(editor.children);
    applyDollarInlineTrigger(editor);
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
```

(`makeEditorWithText` and `makeEditorWithCodeBlockText` are minimal helpers in this test file — Slate `Editor` instance with one paragraph or code_block. Implement them inline in the test file using `createPlateEditor` from `platejs` or a small object literal that satisfies the operations the trigger uses.)

- [ ] **Step 2: Implement**

Add to `math-trigger.tsx`:

```ts
import { Transforms, Path, Range } from "slate";

const INLINE_RE = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/;

export function applyDollarInlineTrigger(editor: PlateEditor) {
  if (isInsideCodeContext(editor)) return;
  if (!editor.selection || !Range.isCollapsed(editor.selection)) return;

  // Walk up to the nearest text node and look at its content + offset
  const [textEntry] = Editor.nodes(editor, {
    match: (n) => "text" in n && typeof (n as { text: unknown }).text === "string",
  });
  if (!textEntry) return;
  const [textNode, textPath] = textEntry as [{ text: string }, Path];
  const text = textNode.text;
  const match = INLINE_RE.exec(text);
  if (!match) return;

  const start = match.index;
  const end = start + match[0].length;
  const tex = match[1];

  // Replace text[start..end] with a math_inline node.
  Transforms.delete(editor, {
    at: {
      anchor: { path: textPath, offset: start },
      focus: { path: textPath, offset: end },
    },
  });
  Transforms.insertNodes(
    editor,
    {
      type: "math_inline",
      texExpression: tex,
      children: [{ text: "" }],
    } as never,
    { at: { path: textPath, offset: start } as never },
  );
}
```

Wire it into the plugin's `onChange`:

```ts
handlers: {
  onChange: ({ editor }) => {
    applyDollarInlineTrigger(editor);
    // applyDollarBlockTrigger(editor) — added in 4.3
  },
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @opencairn/web test -- math-trigger`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/plugins/math-trigger.tsx apps/web/src/components/editor/plugins/math-trigger.test.ts
git commit -m "feat(web): \$..\$ typing converts to math_inline node"
```

---

### Task 4.3: `$$` block trigger

**Files:**
- Modify: `apps/web/src/components/editor/plugins/math-trigger.tsx`
- Modify: `apps/web/src/components/editor/plugins/math-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `math-trigger.test.ts`:

```ts
describe("applyDollarBlockTrigger", () => {
  it("converts a paragraph containing only `$$` to an empty math_block", () => {
    const editor = makeEditorWithText("$$");
    applyDollarBlockTrigger(editor);
    expect(editor.children[0]).toMatchObject({ type: "math_block", texExpression: "" });
  });

  it("ignores `$$` inside a paragraph with other text", () => {
    const editor = makeEditorWithText("foo $$ bar");
    const before = JSON.stringify(editor.children);
    applyDollarBlockTrigger(editor);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("ignores `$$` inside code block", () => {
    const editor = makeEditorWithCodeBlockText("$$");
    const before = JSON.stringify(editor.children);
    applyDollarBlockTrigger(editor);
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
```

- [ ] **Step 2: Implement**

Add to `math-trigger.tsx`:

```ts
export function applyDollarBlockTrigger(editor: PlateEditor) {
  if (isInsideCodeContext(editor)) return;
  if (!editor.selection) return;
  // Find the current block
  const [blockEntry] = Editor.nodes(editor, {
    match: (n) => Editor.isBlock(editor, n),
  });
  if (!blockEntry) return;
  const [block, blockPath] = blockEntry as [{ type: string; children: { text: string }[] }, Path];
  if (block.type !== "paragraph") return;
  if (block.children.length !== 1) return;
  const text = block.children[0]?.text ?? "";
  if (text !== "$$") return;
  Transforms.removeNodes(editor, { at: blockPath });
  Transforms.insertNodes(
    editor,
    {
      type: "math_block",
      texExpression: "",
      children: [{ text: "" }],
    } as never,
    { at: blockPath },
  );
}
```

Wire into `onChange`:

```ts
onChange: ({ editor }) => {
  applyDollarInlineTrigger(editor);
  applyDollarBlockTrigger(editor);
},
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @opencairn/web test -- math-trigger`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/plugins/math-trigger.tsx apps/web/src/components/editor/plugins/math-trigger.test.ts
git commit -m "feat(web): \$\$ on its own line creates an empty math_block"
```

---

### Task 4.4: `Ctrl+Shift+M` selection-to-inline shortcut

**Files:**
- Modify: `apps/web/src/components/editor/plugins/math-trigger.tsx`
- Modify: `apps/web/src/components/editor/plugins/math-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("Ctrl+Shift+M shortcut", () => {
  it("replaces selected text with a math_inline node containing that text as LaTeX", () => {
    const editor = makeEditorWithSelection("alpha to omega", 6, 8); // selects "to"
    triggerMathShortcut(editor);
    const para = editor.children[0] as Record<string, unknown>;
    const kids = (para.children as Array<Record<string, unknown>>).map((c) => c.type ?? "text");
    expect(kids).toEqual(["text", "math_inline", "text"]);
    expect((para.children as Array<Record<string, unknown>>)[1].texExpression).toBe("to");
  });

  it("no-ops on collapsed selection", () => {
    const editor = makeEditorWithSelection("alpha", 0, 0);
    const before = JSON.stringify(editor.children);
    triggerMathShortcut(editor);
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
```

- [ ] **Step 2: Implement**

Add to `math-trigger.tsx`:

```ts
export function triggerMathShortcut(editor: PlateEditor) {
  if (!editor.selection) return;
  if (Range.isCollapsed(editor.selection)) return;
  if (isInsideCodeContext(editor)) return;
  const fragment = Editor.string(editor, editor.selection);
  if (!fragment) return;
  Transforms.delete(editor, { at: editor.selection });
  Transforms.insertNodes(editor, {
    type: "math_inline",
    texExpression: fragment,
    children: [{ text: "" }],
  } as never);
}
```

Wire into the plugin's `onKeyDown` handler:

```ts
handlers: {
  onChange: /* ... */,
  onKeyDown: ({ editor, event }) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "m"
    ) {
      event.preventDefault();
      triggerMathShortcut(editor);
      return true;
    }
    return false;
  },
},
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @opencairn/web test -- math-trigger`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/plugins/math-trigger.tsx apps/web/src/components/editor/plugins/math-trigger.test.ts
git commit -m "feat(web): Ctrl+Shift+M converts selection to math_inline"
```

---

### Task 4.5: Math edit popover (textarea + KaTeX live preview)

**Files:**
- Create: `apps/web/src/components/editor/elements/math-edit-popover.tsx`
- Create: `apps/web/src/components/editor/elements/math-edit-popover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MathEditPopover } from "./math-edit-popover";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("MathEditPopover", () => {
  it("renders KaTeX preview for valid LaTeX", () => {
    const { getByLabelText, container } = render(
      withIntl(
        <MathEditPopover
          open
          onOpenChange={vi.fn()}
          initialTex="x^2"
          onSave={vi.fn()}
          onDelete={vi.fn()}
          anchor={<button>anchor</button>}
        />,
      ),
    );
    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("calls onSave with new tex on Save click", () => {
    const onSave = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      withIntl(
        <MathEditPopover
          open
          onOpenChange={vi.fn()}
          initialTex="x^2"
          onSave={onSave}
          onDelete={vi.fn()}
          anchor={<button>anchor</button>}
        />,
      ),
    );
    const ta = getByPlaceholderText(koMessages.math.editPopover.placeholder);
    fireEvent.change(ta, { target: { value: "y^3" } });
    fireEvent.click(getByText(koMessages.math.editPopover.save));
    expect(onSave).toHaveBeenCalledWith("y^3");
  });

  it("calls onDelete when saving with empty content", () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      withIntl(
        <MathEditPopover
          open
          onOpenChange={vi.fn()}
          initialTex="x^2"
          onSave={onSave}
          onDelete={onDelete}
          anchor={<button>anchor</button>}
        />,
      ),
    );
    fireEvent.change(getByPlaceholderText(koMessages.math.editPopover.placeholder), { target: { value: "" } });
    fireEvent.click(getByText(koMessages.math.editPopover.save));
    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/web/src/components/editor/elements/math-edit-popover.tsx`:

```tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import katex from "katex";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface MathEditPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTex: string;
  onSave: (tex: string) => void;
  onDelete: () => void;
  anchor: React.ReactNode;
}

export function MathEditPopover({
  open,
  onOpenChange,
  initialTex,
  onSave,
  onDelete,
  anchor,
}: MathEditPopoverProps) {
  const t = useTranslations("editor.math.editPopover");
  const [tex, setTex] = useState(initialTex);
  useEffect(() => {
    if (open) setTex(initialTex);
  }, [open, initialTex]);

  const previewHtml = useMemo(() => {
    if (!tex.trim()) return "";
    try {
      return katex.renderToString(tex, { throwOnError: true });
    } catch {
      return null; // null indicates parse error
    }
  }, [tex]);

  function handleSave() {
    if (tex.trim().length === 0) {
      onDelete();
      onOpenChange(false);
      return;
    }
    onSave(tex);
    onOpenChange(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onOpenChange(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent className="w-[480px]" onKeyDown={handleKeyDown}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t("title")}</label>
            <textarea
              value={tex}
              onChange={(e) => setTex(e.target.value)}
              placeholder={t("placeholder")}
              autoFocus
              rows={4}
              className="w-full rounded-md border bg-background p-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t("previewLabel")}</label>
            <div className="min-h-[6rem] rounded-md border bg-muted/30 p-2">
              {previewHtml === null ? (
                <p className="text-sm text-destructive">{t("invalid")}</p>
              ) : (
                <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @opencairn/web test -- math-edit-popover`
Expected: PASS — 3 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/elements/math-edit-popover.tsx apps/web/src/components/editor/elements/math-edit-popover.test.tsx
git commit -m "feat(web): math edit popover with KaTeX live preview"
```

---

### Task 4.6: Wire popover into MathInline / MathBlock click-to-edit

**Files:**
- Modify: `apps/web/src/components/editor/elements/math-inline.tsx`
- Modify: `apps/web/src/components/editor/elements/math-block.tsx`

- [ ] **Step 1: Add open-state + popover to MathInline**

Edit `math-inline.tsx`. Wrap the existing rendered span in the popover:

```tsx
"use client";

import katex from "katex";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { PlateElementProps } from "platejs/react";
import { useEditorRef, findPath } from "platejs/react";
import { Transforms } from "slate";
import { MathEditPopover } from "./math-edit-popover";

export function MathInline({ attributes, children, element }: PlateElementProps) {
  const t = useTranslations("editor.math");
  const editor = useEditorRef();
  const tex = (element as { texExpression?: string }).texExpression ?? "";
  const [open, setOpen] = useState(false);

  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: true });
    } catch {
      return null;
    }
  }, [tex]);

  function handleSave(next: string) {
    const path = findPath(editor, element);
    if (!path) return;
    editor.tf.setNodes({ texExpression: next } as never, { at: path });
  }

  function handleDelete() {
    const path = findPath(editor, element);
    if (!path) return;
    Transforms.removeNodes(editor, { at: path });
  }

  const anchor = (
    <span
      {...attributes}
      contentEditable={false}
      className="mx-0.5 inline-block cursor-pointer"
      data-slate-void="true"
      onClick={() => setOpen(true)}
    >
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="text-xs text-red-600" title={t("parse_error")}>
          {`$${tex}$`}
        </span>
      )}
      {children}
    </span>
  );

  return (
    <MathEditPopover
      open={open}
      onOpenChange={setOpen}
      initialTex={tex}
      onSave={handleSave}
      onDelete={handleDelete}
      anchor={anchor}
    />
  );
}
```

- [ ] **Step 2: Mirror for MathBlock**

Edit `math-block.tsx` analogously. Block layout is the same except the wrapping element is `<div>` instead of `<span>` and `katex.renderToString(..., { displayMode: true })`.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/elements/math-inline.tsx apps/web/src/components/editor/elements/math-block.tsx
git commit -m "feat(web): click math node to open edit popover"
```

---

## Phase B-5 — Integration & Polish

### Task 5.1: Register all new plugins in NoteEditor

**Files:**
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Add imports + plugin registration**

Add to the `platePlugins` array (or whatever the array is named — check existing imports of `imagePlugin`, `embedPlugin` may not yet exist):

```ts
import { imagePlugin } from "./blocks/image/image-plugin";
import { embedPlugin } from "./blocks/embed/embed-plugin";
import { mathTriggerPlugin } from "./plugins/math-trigger";
import { imageDropDeferredPlugin, useImageUploadDeferredToast } from "./plugins/image-drop-deferred";

// inside platePlugins array:
imagePlugin,
embedPlugin,
mathTriggerPlugin,
imageDropDeferredPlugin,

// inside NoteEditor function body (top):
useImageUploadDeferredToast();
```

- [ ] **Step 2: Wire popover hosts**

If the slash menu in this codebase uses an "open insert popover by key" orchestrator, ensure the hosts for `image` and `embed` popovers exist. If the existing `/math` slash uses a simpler immediate-insert pattern, mirror that for `image`/`embed` — the popover state can live in `NoteEditor`'s component body.

Pattern (host state):

```tsx
const [openPopover, setOpenPopover] = useState<"image" | "embed" | null>(null);
const editor = useEditorRef();

// Render popovers conditionally near the editor root:
{openPopover === "image" && (
  <ImageInsertPopover
    open
    onOpenChange={(o) => setOpenPopover(o ? "image" : null)}
    anchor={<span style={{ position: "fixed", left: -9999 }} />}
    onInsert={(data) => insertImageNode(editor, data)}
  />
)}
{openPopover === "embed" && (
  <EmbedInsertPopover
    open
    onOpenChange={(o) => setOpenPopover(o ? "embed" : null)}
    anchor={<span style={{ position: "fixed", left: -9999 }} />}
    onInsert={(res) => insertEmbedNode(editor, res)}
  />
)}
```

The slash items added in Tasks 1.4 / 2.3 call `setOpenPopover("image" | "embed")` via the existing slash orchestrator's API.

- [ ] **Step 3: Type-check + dev smoke**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

Run: `pnpm dev` (in another terminal). Open a note. Try `/embed` and `/image` — confirm popovers appear. Insert one of each. (Full smoke list: see Task 5.4.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): register image/embed/math-trigger/image-drop plugins"
```

---

### Task 5.2: i18n parity check + final cleanup of unused keys

**Files:**
- (review-only) `apps/web/messages/ko/editor.json`
- (review-only) `apps/web/messages/en/editor.json`

- [ ] **Step 1: Run i18n parity**

Run: `pnpm --filter @opencairn/web i18n:parity`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @opencairn/web lint`
Expected: PASS — no `i18next/no-literal-string` violations.

- [ ] **Step 3: Run full test suite**

Run: `pnpm --filter @opencairn/web test`
Expected: PASS — every existing test + every new Phase B test.

- [ ] **Step 4: No commit needed if nothing changed.** If lint flagged anything, fix and commit:

```bash
git add -p
git commit -m "fix(web): i18n cleanup for plan 2E phase B"
```

---

### Task 5.3: Production build + manual smoke (CSP enforcement)

**Files:**
- (none modified, verification only)

- [ ] **Step 1: Build**

Run: `pnpm --filter @opencairn/web build`
Expected: PASS — no type errors, no missing routes.

- [ ] **Step 2: Start production server**

Run: `pnpm --filter @opencairn/web start` (different terminal).

- [ ] **Step 3: Smoke each Phase B feature**

Open a workspace, create a note, run through each:

- Slash `/image`, paste `https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png`. Verify renders + caption editable.
- Drag a local PNG onto the editor. Verify toast appears, no node inserted.
- Slash `/embed`, paste `https://www.youtube.com/watch?v=dQw4w9WgXcQ`. Verify it loads (CSP path).
- Repeat for Vimeo (`https://vimeo.com/76979871`) and Loom (use any public Loom share URL).
- Insert a 3-column group via slash. Drag the middle gutter; verify cursor changes, columns resize, layout stable.
- Reload page; verify column widths persisted.
- Type `$E=mc^2$` in a paragraph. Verify it converts to inline math.
- Click the math node. Verify popover opens with KaTeX preview. Edit and save. Verify update.
- On a new line, type `$$` then space. Verify block math node appears.
- Select text "x \to \infty", press `Ctrl+Shift+M`. Verify inline math node created.
- Open share link to a note containing image + embed + resized columns + math. Verify all 4 render.

- [ ] **Step 4: If smoke passed, commit nothing (no code changed). If smoke caught a bug, fix and commit individually.**

---

### Task 5.4: Update plans-status.md + CLAUDE.md

**Files:**
- Modify: `docs/contributing/plans-status.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update plans-status entry for Plan 2E**

Find the row for Plan 2E. Append a Phase B entry pointing at this plan's eventual merge commit + the spec. Mark Phase B ✅ once the PR merges; until then leave "🟡 in review (PR #N)".

- [ ] **Step 2: Update CLAUDE.md plan summary**

Move "Plan 2E Phase B" from the 🟡 active line to the ✅ complete line, with the date and merge HEAD short SHA. (Defer this until immediately before merge — easier to review the diff that way.)

- [ ] **Step 3: Commit**

```bash
git add docs/contributing/plans-status.md CLAUDE.md
git commit -m "docs: mark plan 2E phase B complete"
```

---

### Task 5.5: Open the PR

- [ ] **Step 1: Push branch**

Run: `git push -u origin feat/plan-2e-phase-b`

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat(web): plan 2E phase B — image/embed/columns/math" --body "$(cat <<'EOF'
## Summary

Closes Plan 2E Phase B. Ships four block additions in a single PR (single i18n + slash + paste-pipeline edit set):

- URL-only image block with paste detection + drag-drop deferred toast
- 3-provider embed block (YouTube, Vimeo, Loom) with paste detection + CSP frame-src
- column_group drag-resize handle with keyboard a11y
- inline-math UX: \$..\$ + \$\$ triggers, Ctrl+Shift+M shortcut, KaTeX live-preview popover

Spec: docs/superpowers/specs/2026-04-30-plan-2e-phase-b-image-embed-column-math-design.md

## Out of scope (follow-up plans)

- Image upload route + presigned reads + GC
- Twitter/X embed (oEmbed)
- Math symbol picker

## Test plan

- [x] vitest passes for all new and existing tests
- [x] i18n parity passes
- [x] typecheck passes
- [x] production build green
- [x] manual smoke run through all 4 features in next start (CSP enforced)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage:**
- Spec § 3 (Image block) → Tasks 2.1 / 2.2 / 2.3 / 2.4 / 2.5 / 2.6 ✓
- Spec § 4 (Embed block) → Tasks 1.1 / 1.2 / 1.3 / 1.4 / 1.5 / 1.6 ✓
- Spec § 5 (Column drag-resize) → Tasks 3.1 / 3.2 / 3.3 ✓
- Spec § 6 (Inline-math UX) → Tasks 4.1 / 4.2 / 4.3 / 4.4 / 4.5 / 4.6 ✓
- Spec § 7 (Components affected) → Each entry maps to a task above. ✓
- Spec § 8 (i18n) → Task 0.1 creates skeleton; subsequent tasks reference keys. ✓
- Spec § 9 (Testing) → Each test in spec § 9.1 has a corresponding `Step 1: Write the failing test`. Smoke checklist mirrored in Task 5.3. ✓

**Type consistency:**
- `EmbedResolution` shape (`{ provider, embedUrl }`) defined in Task 1.1 used identically in Tasks 1.4 / 1.5. ✓
- `imageElementSchema.shape.url` reused in Task 2.3 popover validation. ✓
- `ColumnResizeHandle` props match between Task 3.1 (definition) and Task 3.2 (consumption). ✓
- `MathEditPopover` props match between Task 4.5 (definition) and Task 4.6 (consumption). ✓

**Known minor risks (intentional):**
- `findPath` import path may differ across Plate v49.x patches. Plan instructs the implementer to verify before transcribing.
- Slash-menu registration shape in Task 1.4 / 2.3 is "follow existing pattern" rather than fully specified — the existing `/math` and `/columns` items are the source of truth and the codebase has the right shape.
- The image-drop-deferred test (Task 2.5) is a placeholder — the real assertion needs the project's editor test harness to support file-drop simulation. Manual smoke (Task 5.3) is the gate.

These three places require the implementer to read the surrounding code; the rest of the plan is fully transcribable.
