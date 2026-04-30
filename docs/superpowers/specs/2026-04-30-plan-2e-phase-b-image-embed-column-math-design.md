# Plan 2E Phase B — Image / Embed / Column-Resize / Math UX Design Spec

**Status:** Draft (2026-04-30).
**Owner:** Sungbin
**Author:** Sungbin + Claude (Opus 4.7).
**Plan reference:** plans-status.md → Plan 2E Phase B (Phase A spec § 4 traceability).
**Phase A spec:** `docs/superpowers/specs/2026-04-29-plan-2e-editor-followups-design.md`
**Related:**

- `apps/web/src/components/editor/blocks/columns/columns-plugin.tsx` (Plan 2D — `@platejs/layout` registration without resize)
- `apps/web/src/components/editor/elements/math-inline.tsx`, `math-block.tsx` (Plan 2A — void nodes, no input UX)
- `apps/web/src/components/editor/plugins/slash.tsx` (slash command registry)
- `apps/web/src/components/editor/plugins/paste-norm.tsx` (Plan 2E Phase A — paste pipeline pattern)
- `apps/api/src/routes/ingest.ts` (referenced for **why we don't reuse it** — see § 3.4)

## 1. Goal

Close the four block-level deferrals from Plan 2E Phase A § 4 in a single PR. Each item is independently testable but ships together because they all touch the same Plate v49 schema surface (`platePlugins` array) and slash menu, and splitting them into four PRs would force the same i18n + slash registry edits four times.

Listed below in spec-document order (image first, then embed, then columns, then math). The implementation plan ships them in a slightly different order — see § 12 for why.

- **§ 3 — Image block.** URL-only `image` void node + caption + alt. No upload route. Auto-detected from pasted URL. Drag-drop shows a "use URL for now" toast.
- **§ 4 — Embed block.** YouTube / Vimeo / Loom only (3-provider allow-list). URL → embed URL transform, sandboxed iframe.
- **§ 5 — Column drag-resize.** Hover-revealed handle on `column_group` gutters. Persists as `widths: number[]` on the group node, normalized to sum 1.0.
- **§ 6 — Inline-math UX.** `$..$` and `$$..$$` typing triggers + click-to-edit popover with KaTeX live preview + `Ctrl+Shift+M` selection-to-inline-math shortcut.

## 2. Non-Goals

- **Image upload pipeline.** No new `apps/api` route. Pasting a `data:` URL or dragging a file shows a toast pointing at "use a URL for now"; the upload route + clipboard/drag binding is its own follow-up plan (see § 10).
- **Twitter/X embed.** Twitter doesn't expose a stable iframe embed URL. Doing this right requires `react-tweet` (oEmbed) or a server proxy. Out of scope; defer.
- **Embed CSP frame-ancestors hardening.** Adding the 3 provider domains to `apps/web/next.config.ts`'s CSP is a separate operational step that ships in this PR but the broader CSP review is out.
- **Math symbol picker grid.** A "click to insert `\sum`" panel is post-MVP. The popover this PR ships is a textarea + live preview only.
- **Math equation numbering / cross-refs.** KaTeX renders equations atomically. No `\label{}` resolution.
- **Column count > 4.** `@platejs/layout` already supports n-column groups; we keep the slash menu's existing 2/3 options. Resize works for any n.

## 3. Image Block

### 3.1 Node schema

A new `image` void block (not inline). Lives at the top level or inside a `column` item.

```ts
// packages/shared/src/editor/image-element.ts
export const imageElement = z.object({
  type: z.literal("image"),
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), {
    message: "Only http/https URLs are allowed",
  }),
  alt: z.string().max(500).optional(),
  caption: z.string().max(1000).optional(),
  width: z.number().min(0.1).max(1).optional(), // 0..1 fraction of container width; absent = natural
  children: z.tuple([z.object({ text: z.literal("") })]),
});
```

Plate v49 element interface (matching the column_group / mermaid pattern from 2D):

```ts
interface TImageElement extends TElement {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
}
```

### 3.2 Plugin

Custom Plate plugin under `apps/web/src/components/editor/blocks/image/image-plugin.tsx`. We do **not** install `@platejs/media` — it bundles a full upload/dropzone/caption story we don't ship. A 60-line custom void plugin is smaller and avoids drag-drop UX leaking through.

```ts
export const imagePlugin = createSlatePlugin({
  key: "image",
  node: { isElement: true, isVoid: true },
})
  .withComponent(ImageElement);
```

### 3.3 Insertion paths

- **Slash `/image`.** Opens a small popover with one URL input + Enter-to-confirm. Validates with `imageElement.shape.url`. On submit, inserts the node and focuses caption (empty figcaption ready to type).
- **Paste detection.** `paste-norm.tsx` already runs on every paste. Extended: after escape normalization, if the pasted plain text matches a single `https?://...\.(png|jpe?g|gif|webp|svg)(?:\?.*)?$` (no other content), insert an `image` node instead of a paragraph. **Inside `code_block`, this transform is skipped** (mirror Phase A escape-norm behavior).
- **Drag-drop / file paste.** Intercept `drop` and `paste` with `File` items. Show a sonner toast keyed `editor.image.uploadDeferred` ("이미지 업로드는 곧 지원돼요. 지금은 이미지 URL을 붙여 넣어 주세요." / EN parity). Do NOT insert anything.

### 3.4 Why no upload here

`/api/ingest/upload` exists but **triggers `IngestWorkflow`** (Temporal, full document parse, embedding pipeline). Reusing it for inline editor images would create a `notes` row + `documents` row + Temporal job per image — wrong shape entirely.

A correct upload route needs: workspace-scoped permission check, MIME + size limits, lifecycle (delete-on-note-delete or orphan GC), presigned read URLs (MinIO bucket isn't publicly readable), and SSRF-free proxy reads if we ever want hot-linking protection. None of that is small. **Defer to its own plan.**

### 3.5 Render

```tsx
<figure className="my-4">
  <img
    src={url}
    alt={alt ?? ""}
    loading="lazy"
    decoding="async"
    referrerPolicy="no-referrer"
    style={width ? { width: `${width * 100}%` } : undefined}
    className="rounded-md max-w-full h-auto"
  />
  {caption && <figcaption className="text-sm text-muted-foreground mt-1">{caption}</figcaption>}
</figure>
```

Caption editing is a click-to-edit pattern: clicking the figcaption opens a small contenteditable input (single-line, plain text only — no nested Plate marks). Empty caption hides the figcaption entirely; user opens it via the floating "+" button on hover or the right-click context menu.

### 3.6 Accessibility

- Empty `alt` is the **default**, not a missing attribute. The popover surfaces an "Alt text" field; if the user leaves it blank we send `alt=""` (decorative). Lint rule `jsx-a11y/alt-text` is satisfied because `alt` is always a string prop.
- The image element is keyboard-focusable (`tabIndex={0}`). Enter/Space opens the same edit popover that the caption click opens.

## 4. Embed Block

### 4.1 Allow-list

Three providers, fixed in code:

| Provider | URL pattern | Embed URL pattern | Sandbox flags |
| -------- | ----------- | ----------------- | ------------- |
| YouTube  | `youtube.com/watch?v=ID`, `youtu.be/ID` | `https://www.youtube-nocookie.com/embed/ID` | `allow-scripts allow-same-origin allow-presentation` |
| Vimeo    | `vimeo.com/ID` | `https://player.vimeo.com/video/ID` | `allow-scripts allow-same-origin allow-presentation` |
| Loom     | `loom.com/share/ID` | `https://www.loom.com/embed/ID` | `allow-scripts allow-same-origin allow-presentation` |

The transform lives in `apps/web/src/lib/embeds/to-embed-url.ts`. Pure function, table-driven tests with 12 positive + 6 negative cases (malformed URL, unknown host, ID-extraction failure).

### 4.2 Node schema

```ts
// packages/shared/src/editor/embed-element.ts
export const embedElement = z.object({
  type: z.literal("embed"),
  provider: z.enum(["youtube", "vimeo", "loom"]),
  url: z.string().url(), // original URL, kept so user sees what they pasted
  embedUrl: z.string().url(), // computed via toEmbedUrl(); never accepts user input directly
  children: z.tuple([z.object({ text: z.literal("") })]),
});
```

`embedUrl` is **never user-supplied**. The plugin computes it on insertion. On hydration from Yjs/Plate JSON we re-validate via `embedElement.parse`; if `embedUrl` doesn't match what `toEmbedUrl(url)` would produce now, we recompute (forward-compatibility for if we change the embed URL pattern later).

### 4.3 Insertion paths

- **Slash `/embed`.** URL input popover. On submit: run `toEmbedUrl()`. If it returns `null` (host not in allow-list), show inline error "지원되는 임베드 URL이 아니에요" and don't insert.
- **Paste detection.** Same hook as image paste. If pasted text is a single URL matching one of the 3 host patterns, insert an `embed` node instead of a paragraph or image.

### 4.4 Render

```tsx
<div className="my-4 aspect-video w-full">
  <iframe
    src={embedUrl}
    title={`${provider} embed`}
    sandbox="allow-scripts allow-same-origin allow-presentation"
    allow="autoplay; fullscreen; picture-in-picture"
    referrerPolicy="strict-origin-when-cross-origin"
    loading="lazy"
    className="h-full w-full rounded-md"
  />
</div>
```

`aspect-video` keeps a stable 16:9 box during lazy load. No JS-driven sizing; the iframe handles its own contents.

### 4.5 CSP

Add to `apps/web/next.config.ts` `frame-src` directive:

```
frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com;
```

Without this, the iframes refuse to load in production. Dev `next dev` doesn't enforce CSP, so this gap only surfaces in `next build`. **Smoke test: run `pnpm --filter @opencairn/web build && pnpm --filter @opencairn/web start` and load a page with each embed type before declaring done.**

### 4.6 Public share view

Plan 2C's `PlateStaticRenderer` (`apps/web/src/app/[locale]/s/[token]/page.tsx`) handles share-link rendering. The static renderer must support `image` and `embed` element types or shared notes display blanks. The renderer adds two element handlers and inherits CSP from the share page's response headers.

## 5. Column Drag-Resize

### 5.1 Schema change

Existing `column_group` node from `@platejs/layout` has shape `{ type: "column_group", children: ColumnItem[] }`. We add an optional `widths` field:

```ts
// extends @platejs/layout ColumnGroupElement
interface TColumnGroupElement extends TElement {
  type: "column_group";
  widths?: number[]; // length === children.length, sum ≈ 1 (within 0.001 tolerance), each ≥ 0.10
  children: TColumnItemElement[];
}
```

`widths` is optional. Absent = equal split. When present, the renderer applies `flexBasis: ${widths[i] * 100}%` to each column item. This is **additive and back-compatible**: existing notes with no `widths` field render exactly as before.

### 5.2 Resize handle

Renders into the gap between adjacent columns:

```tsx
<div
  role="separator"
  aria-orientation="vertical"
  aria-valuenow={leftWidthPct}
  aria-valuemin={10}
  aria-valuemax={90}
  tabIndex={0}
  className="group relative w-2 cursor-col-resize select-none"
  onPointerDown={beginDrag}
  onKeyDown={handleKey}
  onDoubleClick={resetEqual}
>
  <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border opacity-0 transition-opacity group-hover:opacity-100" />
</div>
```

- **Pointer drag.** `pointerdown` captures the pointer (`setPointerCapture`), `pointermove` updates a local React state (no Slate ops yet), `pointerup` commits via `editor.tf.setNodes({ widths: nextWidths }, { at: groupPath })`. **One Slate op per drag** — important because Yjs would otherwise fan out 60 ops/sec to every collaborator.
- **Throttle.** `pointermove` updates DOM via `requestAnimationFrame`. Local state only. Slate stays still until pointerup.
- **Constraints.** Each `widths[i] ≥ 0.10`. Drag stops feeding values when either neighbor would dip under. Sum is preserved by only redistributing between the two adjacent columns of the dragged handle (n-3 columns are untouched).
- **Double-click.** Resets `widths` to `Array(n).fill(1/n)`.
- **Keyboard.** When the separator has focus: `←` shrinks the left column by 5% and grows the right by 5%; `→` is the inverse. `Shift+←`/`Shift+→` does 1%. `Home` resets equal. `Tab` moves to the next separator within the same group. Constraints in § 5.2 still apply — keys that would push either neighbor under 10% are no-ops.

### 5.3 Migration / persistence

No DB migration. `widths` lives inside the Plate JSON stored in `notes.content` (Yjs doc). All-numeric array is round-trippable through Yjs and our SSR static renderer.

The Yjs sync layer treats unknown attributes as opaque map entries, so old clients ignoring `widths` still apply the default equal split — no breakage during a partial rollout.

## 6. Inline-Math UX

### 6.1 Existing baseline

`MathInline` is already a void node with a `texExpression: string` attribute (Plan 2A, `@platejs/math`). Today the only insertion path is the `/math` slash command, which inserts an empty node. There's no input UI for setting `texExpression` after insert — we ship that here.

### 6.2 Triggers

| Input | Result |
| ----- | ------ |
| Type `$x^2$` (open dollar, content, close dollar — same paragraph, no other dollars) | Replace the `$...$` text with a `math_inline` node where `texExpression="x^2"`. |
| Empty line, type `$$` | Convert the line into an empty `math_block` node. (Mirror the existing `mermaid-fence` plugin pattern.) |
| Selection, press `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`) | Replace selection with a `math_inline` node where `texExpression` = selected text. |
| Slash `/math` | Insert empty `math_inline` and immediately open the edit popover. |

The dollar-trigger pattern lives in a new plugin `apps/web/src/components/editor/plugins/math-trigger.tsx` matching the `mermaid-fence.tsx` shape (it's a `TextInput` event listener that runs after every keystroke and looks at the last few characters of the current text node). **Inside `code_block` / `code_line` the plugin is a no-op**, same convention as escape-norm.

### 6.3 Edit popover

Click on a `math_inline` or `math_block` void node opens a `Popover` (shadcn). Layout:

```
┌─ Popover (anchored to the void node) ─────────────────────┐
│ ┌─ textarea ──────────────┐  ┌─ KaTeX preview ─────────┐ │
│ │ \int_0^\infty e^{-x} dx │  │  ∫₀^∞ e⁻ˣ dx           │ │
│ │                         │  │                          │ │
│ └─────────────────────────┘  └──────────────────────────┘ │
│  Esc: 닫기  ·  Ctrl+Enter: 저장              [저장] [취소] │
└────────────────────────────────────────────────────────────┘
```

- **textarea**: 200ms debounced `onChange` updates the preview pane. The void node is **not** updated until save — typing into the textarea doesn't churn Yjs.
- **preview**: `katex.renderToString(value, { throwOnError: false })`. Render errors show a red text fallback `[invalid LaTeX: …]` instead of throwing.
- **save**: `editor.tf.setNodes({ texExpression: value }, { at: nodePath })`. One op.
- **cancel / Esc**: discards textarea state, popover closes, void node unchanged.
- **Empty save**: deletes the node entirely (treats "save with empty LaTeX" as "remove").

### 6.4 Tab order through inline math

A void inline node breaks normal text-editing flow. We add: when caret is immediately before/after a `math_inline` and user presses `Backspace`, delete the node and open the popover with its previous `texExpression` — letting the user "edit instead of remove" if it was an accidental delete. (This matches Notion's behavior for inline equations.)

## 7. Components Affected

### 7.1 New files

- `apps/web/src/components/editor/blocks/image/image-plugin.tsx`
- `apps/web/src/components/editor/blocks/image/image-element.tsx`
- `apps/web/src/components/editor/blocks/image/image-insert-popover.tsx`
- `apps/web/src/components/editor/blocks/image/image-plugin.test.tsx`
- `apps/web/src/components/editor/blocks/embed/embed-plugin.tsx`
- `apps/web/src/components/editor/blocks/embed/embed-element.tsx`
- `apps/web/src/components/editor/blocks/embed/embed-insert-popover.tsx`
- `apps/web/src/components/editor/blocks/embed/embed-plugin.test.tsx`
- `apps/web/src/lib/embeds/to-embed-url.ts`
- `apps/web/src/lib/embeds/to-embed-url.test.ts`
- `apps/web/src/components/editor/blocks/columns/column-resize-handle.tsx`
- `apps/web/src/components/editor/blocks/columns/column-resize.test.tsx`
- `apps/web/src/components/editor/plugins/math-trigger.tsx`
- `apps/web/src/components/editor/plugins/math-trigger.test.ts`
- `apps/web/src/components/editor/elements/math-edit-popover.tsx`
- `packages/shared/src/editor/image-element.ts`
- `packages/shared/src/editor/embed-element.ts`

### 7.2 Modified files

- `apps/web/src/components/editor/NoteEditor.tsx` — register 3 new plugins (image, embed, math-trigger) + 1 augmented columns plugin.
- `apps/web/src/components/editor/blocks/columns/columns-plugin.tsx` — extend `ColumnPlugin.withComponent(...)` to render the resize handle into gutters.
- `apps/web/src/components/editor/plugins/slash.tsx` — register `/image` and `/embed` items. (`/math` already exists.)
- `apps/web/src/components/editor/plugins/paste-norm.tsx` — extend with image-URL detection and embed-URL detection (after escape normalization, before paragraph fallback).
- `apps/web/src/app/[locale]/s/[token]/page.tsx` — `PlateStaticRenderer` adds image + embed handlers (Plan 2C).
- `apps/web/src/lib/markdown/markdownToPlate.ts` — chat-renderer: convert markdown `![alt](url)` to `image` node. Skip the embed transform here (chat shouldn't auto-embed YouTube links from agent output — that's a future decision).
- `apps/web/messages/{ko,en}/editor.json` — see § 8.
- `apps/web/next.config.ts` — `frame-src` CSP additions.

### 7.3 Untouched

- `apps/api/*` — zero changes.
- `packages/db/*` — zero changes.
- `apps/worker/*` — zero changes.
- `apps/hocuspocus/*` — zero changes (Yjs treats new fields as opaque).

## 8. i18n

New keys under `editor.json` (all ko + en parity):

- `editor.image.slashLabel`, `editor.image.slashDescription`
- `editor.image.urlPlaceholder`, `editor.image.altPlaceholder`, `editor.image.captionPlaceholder`
- `editor.image.invalidUrl` ("이미지 URL이 올바르지 않아요." / "Invalid image URL.")
- `editor.image.uploadDeferred` ("이미지 업로드는 곧 지원돼요. 지금은 이미지 URL을 붙여 넣어 주세요." / "Image uploads are coming soon. For now, paste an image URL.")
- `editor.image.editAlt`, `editor.image.editCaption`
- `editor.embed.slashLabel`, `editor.embed.slashDescription`
- `editor.embed.urlPlaceholder`
- `editor.embed.unsupportedHost` ("지원되는 임베드 URL이 아니에요. (YouTube, Vimeo, Loom)" / "Unsupported embed URL. (YouTube, Vimeo, Loom)")
- `editor.embed.providerYoutube`, `editor.embed.providerVimeo`, `editor.embed.providerLoom`
- `editor.columns.resize.aria` ("column 너비 조절" / "Resize column width")
- `editor.columns.resize.reset` ("균등 분배로 재설정" / "Reset to equal widths")
- `editor.math.editPopover.title`, `editor.math.editPopover.placeholder`
- `editor.math.editPopover.invalid` ("LaTeX 구문 오류" / "Invalid LaTeX")
- `editor.math.editPopover.save`, `editor.math.editPopover.cancel`
- `editor.math.shortcut.hint` ("Ctrl+Shift+M으로 인라인 수식 변환" / "Ctrl+Shift+M to convert to inline math")

Run `pnpm --filter @opencairn/web i18n:parity` after editing — any drift breaks CI.

## 9. Testing

### 9.1 Unit (vitest)

- `to-embed-url.test.ts` — 18 cases (12 positive across 3 providers + 6 negative). Pure function.
- `image-plugin.test.tsx` — render with valid URL, render with invalid URL (`javascript:` rejected at zod parse), figcaption renders only when caption present.
- `embed-plugin.test.tsx` — render fires iframe with correct sandbox attrs; URL → embedUrl recompute on hydration.
- `column-resize.test.tsx` — drag handle, verify final `widths` sum to 1.0 ± 0.001 and each ≥ 0.10; double-click resets to equal; left-arrow shifts 5%.
- `math-trigger.test.ts` — 8 cases: `$x^2$` typing, `$$` newline, `$ $` (empty math, no-op), inside code block (no-op), `Ctrl+Shift+M` selection.
- `paste-norm.test.ts` — extend existing test: paste image URL → image node; paste youtube URL → embed node; paste regular text → paragraph (regression).

### 9.2 i18n parity

`pnpm --filter @opencairn/web i18n:parity` covers all `editor.json` deltas.

### 9.3 Manual smoke (must run before merge)

- Slash `/image`, paste `https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png`, confirm renders with caption editable.
- Drag a local PNG file onto the editor, confirm toast appears and nothing is inserted.
- Slash `/embed`, paste a YouTube URL, confirm it loads in `next start` (CSP path). Repeat for Vimeo and Loom.
- Insert 3-column group, drag middle gutter, confirm widths persist after page reload.
- Type `$E=mc^2$`, confirm inline math node rendered with KaTeX. Click it, edit to `E=mc^3`, save, confirm reflected.
- Select text "x \to \infty", press `Ctrl+Shift+M`, confirm inline math node created with that LaTeX.
- Open share link to a note containing image + embed + resized columns + math, confirm all 4 render correctly in the static viewer.

### 9.4 Build smoke

`pnpm --filter @opencairn/web build && pnpm --filter @opencairn/web start` then load each embed type in production mode. CSP only enforces here.

## 10. Out-of-Plan Follow-ups

- **Image upload route.** New plan covering: `POST /api/files/upload` (workspace-scoped), MIME + size limits, presigned read URLs, orphan GC (cron), drag-drop binding, `data:` URL handling, alt-text auto-suggest via vision agent.
- **Twitter/X embed.** Either `react-tweet` (oEmbed, server-side fetch) or a server proxy. Both require new dependencies and CSP work.
- **Math symbol picker.** 8×4 grid of common Greek + operators inside the edit popover. Out of scope here; trivial follow-up.
- **Math equation labeling / cross-refs.** Document-level numbering and `\ref{}` resolution. Significant scope; future Phase 2E.X.
- **Mermaid live preview while editing.** Phase A spec § 8 noted this stays "save → re-render". Same here — dollar-trigger pattern is for math only.
- **Embed thumbnail + click-to-load.** Defer iframe load until user clicks (privacy + perf). Worth doing; not this PR.

## 11. Open Questions (resolved)

| Q | Resolution |
| - | ---------- |
| MinIO upload vs URL-only? | URL-only. Upload is its own plan (§ 3.4). |
| Reuse `/api/ingest/upload`? | No — it triggers IngestWorkflow. Wrong shape (§ 3.4). |
| Twitter embed in MVP? | No — no stable iframe URL. Defer to oEmbed plan (§ 4.1, § 10). |
| `data:` URL images allowed? | No — zod refine blocks them. Editor pastes are stripped, drag-drop shows toast. |
| Image alt required? | No — empty `alt=""` is valid (decorative). Popover surfaces the field but doesn't require it. |
| `widths` migration for existing column groups? | None. Absent = equal split (back-compatible). |
| Drag commits per-frame to Yjs? | No — local React state during drag, single `setNodes` op on `pointerup`. |
| `$$` blocks vs inline `$` ambiguity? | `$$` only triggers on its own line, otherwise treated as two `$`. Mirrors KaTeX convention. |
| Inside code blocks, do triggers fire? | No — image-paste, embed-paste, and math-trigger all skip `code_block` / `code_line`. |
| One PR or four? | One. Same i18n + slash registry + paste pipeline; splitting forces 4× duplicate edits to the same files. |

## 12. Phasing inside the implementation plan

The implementation plan splits this spec into 4 phases that **can be reviewed independently** but ship in one PR:

- **Phase B-1.** Embed block (smallest, no schema interactions). Validates the paste-norm extension pattern.
- **Phase B-2.** Image block. Reuses paste-norm pattern from B-1.
- **Phase B-3.** Column drag-resize. Touches existing Plate node attribute, slightly more involved.
- **Phase B-4.** Math UX. Largest — three triggers + popover + shortcut.

Each phase is TDD: red test → green implementation → refactor. Phases are sequential within a single branch; total estimated 30~40 commits.
