# Plan 2E — Editor Follow-ups Design Spec

**Status:** Draft (2026-04-29).
**Owner:** Sungbin
**Author:** Sungbin + Claude (Opus 4.7).
**Plan reference:** plans-status.md → Plan 2E (`2026-04-09-plan-2-editor.md` § Task 12~21 잔여)
**Related:**

- `docs/architecture/collaboration-model.md`
- `apps/web/src/components/editor/blocks/` (existing 5 blocks from Plan 2D)
- `apps/web/src/hooks/useMermaidRender.ts`

## 1. Goal

Wrap up the editor backlog deferred from Plan 2C/2D. The work splits cleanly into two phases by complexity:

- **Phase A — Small wins.** Theme-reactive mermaid render, table row/column context menu, paste/escape normalization. No new schema, no new dependencies. Ship in one PR.
- **Phase B — Block additions.** Image block, Embed block (iframe), drag-resize column handles, inline-math input UX. Each touches Plate v49 schema additions and possibly file uploads or new Plate plugins. Each item gets a sub-plan in its own PR.

This document lays out both phases. The `2026-04-29-plan-2e-editor-followups.md` plan executes Phase A only; Phase B items get their own plan files when their turn comes.

## 2. Non-Goals

- Re-architect editor blocks introduced in 2D. The mermaid / table / column / callout / toggle blocks stay structurally as-is.
- Server-side image processing. Image uploads, when added in Phase B, route through the existing `/api/ingest/upload` MinIO path, not a new pipeline.
- Math LaTeX feature parity with Notion or Obsidian. The 2A `@platejs/math` block stays the canonical block; Phase B only improves the input UX (live preview + autocomplete).
- Mermaid editor / live preview while typing the source — out of scope, mermaid stays a "save → re-render" model.

## 3. Phase A — Small Wins (this plan)

### 3.1 Mermaid theme reactivity

**Problem.** `apps/web/src/hooks/useMermaidRender.ts` calls `mermaid.initialize` exactly once at module load, picking the theme from the document class at that instant. When the user toggles dark mode after first render, every existing mermaid block keeps its original theme until a manual reload.

**Design.**

- Move the `mermaid.initialize({ theme })` call out of the singleton-import side effect and into the `useMermaidRender` hook itself.
- The hook reads the current theme via a `useTheme()` hook (existing — see `apps/web/src/lib/theme/`). When theme changes, the hook re-runs effect, calls `mermaid.initialize` with the new theme, and re-renders the SVG.
- A small race exists if two blocks render concurrently with different themes; mermaid's `initialize` is global. Acceptable because the page only ever has ONE theme, and the first render of a block in a session always wins. We re-call `initialize` on every theme change so the global stays in sync.

**Acceptance test.** Toggle dark mode on a page with three mermaid blocks. All three blocks re-render with the new theme within ≤ 1 s.

### 3.2 Table row/column context menu

**Problem.** `@platejs/table` provides keyboard insertion (`Tab` adds row at end), but no contextual UI for "add row above", "delete column", "merge cells". Plan 2D registered the plugin but did not wire the menu.

**Design.**

- Add a `TableCellContextMenu` wrapper rendered around `TableCellElement` children. Uses the existing `shadcn ContextMenu` component (already used by the tab bar's right-click menu).
- Items: insert row above / below, insert column left / right, delete row, delete column, delete table. Reuse `@platejs/table` editor commands (`editor.tf.insertRow`, etc.).
- When a multi-cell selection exists, expose "merge cells" / "split cell". Skip merge if the selection isn't a contiguous rectangle.
- All items get an i18n key under `editor.table.menu.*`.

**Acceptance test.** Right-click a cell, pick "insert row below", a new empty row appears below the current row. Selection collapses into the new row's first cell.

### 3.3 Escape-norm cleanup

**Problem.** Pasting Markdown from external sources (Slack, Notion export, AI chat output) sometimes brings escaped sequences (`\\n`, `\_underscore_`, `\\\#`) that Plate parses literally instead of as the intended plain text. Same risk on the chat-renderer side after Plan 2D's `markdownToPlate`.

**Design.**

- A pure helper `normalizeEscapes(s: string): string` in `apps/web/src/lib/markdown/escape-norm.ts`:
  - Collapse `\\` → `\` only when followed by a markdown-significant character (`\\* \\_ \\# \\[ \\] \\( \\)`). Other `\\` sequences are JSON-escape artifacts and stay literal.
  - Collapse `\\n` and `\\t` to literal `\n`/`\t` only inside text nodes (already handled by Plate's serializer for inline edges; we add the same handling on paste).
- Wire into:
  - `apps/web/src/components/editor/plugins/paste-norm.tsx` — a new Plate plugin hooked on `editor.tf.paste`. Runs `normalizeEscapes` over each text-node-bound segment of the pasted fragment before insertion.
  - `apps/web/src/lib/markdown/markdownToPlate.ts` — same helper called as a post-processor.
- Pure function with table-driven tests (`escape-norm.test.ts`). 12 cases covering positive matches and negatives (e.g., `\\*` inside a code block must stay literal).

**Acceptance test.** Paste `회의 끝났\\.` into a paragraph. Result reads `회의 끝났.` (single escaped period collapsed to a literal one).

## 4. Phase B — Block Additions (separate plans, listed here for traceability)

| Item | Plan name (TBD) | Brief |
| ---- | ----- | ----- |
| Image block | `2026-04-29-plan-2e-image-block.md` | Plate `@platejs/media` + upload via `/api/ingest/upload` (MinIO key) + caption. |
| Embed block | `2026-04-29-plan-2e-embed-block.md` | Generic iframe embed with allow-list (YouTube, Vimeo, Twitter, Loom). CSP nonce per render. |
| Drag-resize column handle | `2026-04-29-plan-2e-column-resize.md` | Resize handle between columns of `column_group`. Width persists per-block as a `widths: number[]` array. |
| Inline-math input UX | `2026-04-29-plan-2e-math-ux.md` | LaTeX preview + symbol picker autocomplete. KaTeX is the renderer; this is purely input. |

Each Phase B item is independently mergeable. Only `column-resize` depends on Phase A's escape-norm because both touch the slash menu's `editor.tf.insertNodes` path.

## 5. Components Affected (Phase A)

- `apps/web/src/hooks/useMermaidRender.ts` — read theme, re-init on change.
- `apps/web/src/components/editor/blocks/table/table-cell-element.tsx` (new) — wrap with context menu.
- `apps/web/src/components/editor/blocks/table/table-context-menu.tsx` (new).
- `apps/web/src/components/editor/plugins/paste-norm.tsx` (new).
- `apps/web/src/lib/markdown/escape-norm.ts` (new).
- `apps/web/src/lib/markdown/escape-norm.test.ts` (new).
- `apps/web/src/lib/markdown/markdownToPlate.ts` — call `normalizeEscapes` post-process.
- `apps/web/messages/{ko,en}/editor.json` — `table.menu.*` + `paste.normalized` toast keys (parity).

## 6. i18n

New keys under `editor.json`:

- `editor.table.menu.insertRowAbove` / `insertRowBelow`
- `editor.table.menu.insertColumnLeft` / `insertColumnRight`
- `editor.table.menu.deleteRow` / `deleteColumn` / `deleteTable`
- `editor.table.menu.mergeCells` / `splitCell`
- `editor.paste.normalized` (sonner toast: "외부 마크다운에서 이스케이프 문자를 정규화했어요." / "Normalized escape characters from external markdown.")

ko + en parity required.

## 7. Testing

### 7.1 Unit (vitest)

- `escape-norm.test.ts` — 12 table-driven cases covering markdown-significant chars, code-block negatives, multiline, idempotence.
- `useMermaidRender.test.tsx` — render with `theme="default"`, change `theme="dark"` via test-only `setThemeForTest`, assert SVG re-render fires (mock `mermaid.render`).
- `table-context-menu.test.tsx` — render a 2×2 table, right-click cell (1,0), click "insert row above", assert table is now 3×2 with cursor in (1,0)-old / (2,0)-new.

### 7.2 i18n parity

- `pnpm --filter @opencairn/web i18n:parity` covers `editor.json` deltas.

### 7.3 Manual smoke

- Insert mermaid block, toggle dark mode, observe re-render.
- Paste `\\*foo\\*` from clipboard, expect `*foo*` in editor.
- Right-click table cell → "insert column right" works.

## 8. Out-of-Plan Follow-ups (post Phase A)

- Phase B items per § 4.
- Plate v49 has a `paste` event listener race with native browser paste on Safari iOS; if Phase A surfaces flakes there, address via a follow-up that reproduces the bug first.
- Replace `dangerouslySetInnerHTML` usage in `MermaidElement` with `Trusted Types` policy when upstream `mermaid` exposes one (currently their SVG output is sanitized internally with `dompurify` since 10.x).

## 9. Open Questions (resolved)

| Q | Resolution |
| - | ---------- |
| Should mermaid re-init be debounced? | No — theme toggles are user-driven (≤ 1/sec) and `initialize` is cheap (re-uses already-loaded module). |
| Does table context menu need `selection-aware` enable/disable? | Yes for "merge/split" only. Insert/delete are always enabled inside a table. |
| Is escape-norm safe inside fenced code blocks? | Skip. The helper checks if the surrounding Plate node is `code_block` / `code_line` and returns the input unchanged. |
| Where does Phase A live? | Single PR `feat/plan-2e-phase-a-editor-followups`. |
