# Plan 2E Phase A — Editor Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three smallest editor follow-ups deferred from Plan 2C/2D in a single PR — theme-reactive mermaid render, table row/column context menu, and paste-time escape normalization. No schema changes, no new packages.

**Architecture:** Pure TS additions inside `apps/web`. The mermaid hook gets re-initialized on theme change instead of once at module load. The table block gains a `TableContextMenu` wrapper using shadcn `ContextMenu` and `@platejs/table`'s editor commands. A new `escape-norm.ts` helper plus a `paste-norm` Plate plugin collapse JSON-escape artifacts on paste; the same helper post-processes `markdownToPlate` so chat-saved suggestions get the same treatment.

**Spec:** `docs/superpowers/specs/2026-04-29-plan-2e-editor-followups-design.md`.

**Tech Stack:** Next.js 16 + next-intl, Plate v49, `@platejs/table`, shadcn/ui, Tailwind 4, Vitest, Mermaid 11+.

**Dependencies (already on `main`):** Plan 2D (mermaid + table + columns + callout + toggle + chat renderer), Plan 9a (theme tokens + i18n parity CI).

**Out of scope (Phase B, separate plans):** Image block, Embed block, drag-resize column handles, inline-math input UX.

---

## File Structure

Create:

- `apps/web/src/lib/markdown/escape-norm.ts`
- `apps/web/src/lib/markdown/escape-norm.test.ts`
- `apps/web/src/components/editor/blocks/table/table-context-menu.tsx`
- `apps/web/src/components/editor/blocks/table/table-context-menu.test.tsx`
- `apps/web/src/components/editor/plugins/paste-norm.tsx`

Modify:

- `apps/web/src/hooks/useMermaidRender.ts` — read theme inside the hook, re-init on change.
- `apps/web/src/hooks/useMermaidRender.test.tsx` — add re-render-on-theme test.
- `apps/web/src/components/editor/blocks/mermaid/mermaid-element.tsx` — pass current theme into the hook.
- `apps/web/src/components/editor/blocks/table/` — wrap cell renderer with `TableContextMenu`.
- `apps/web/src/lib/markdown/markdownToPlate.ts` — call `normalizeEscapes` over text nodes post-process.
- `apps/web/src/components/editor/index.tsx` (or wherever the Plate plugin list is composed) — register `pasteNormPlugin`.
- `apps/web/messages/{ko,en}/editor.json` — `table.menu.*` + `paste.normalized` keys.
- `docs/contributing/plans-status.md` — Plan 2E Phase A row.
- `CLAUDE.md` — flip Plan 2E from "Active / next" to "Phase A complete" (Phase B still active).

Generate during implementation: none.

Do not modify in this plan:

- Any DB schema, migration, or worker code.
- The mermaid block's "show source" toggle, error fallback, or testid contract.
- `markdownToPlate`'s GFM/mermaid/callout post-processors — escape-norm runs once at the end, never inside other passes.
- The chat renderer's mermaid path (it uses the same `useMermaidRender` so the theme reactivity arrives for free).

---

## Task 1: escape-norm helper

**Files:**

- Create: `apps/web/src/lib/markdown/escape-norm.ts`
- Create: `apps/web/src/lib/markdown/escape-norm.test.ts`

- [ ] **Step 1: Write the failing tests**

`escape-norm.test.ts` (12 cases):

- `\\*foo\\*` → `*foo*`
- `\\_bar\\_` → `_bar_`
- `\\#heading` → `#heading`
- `\\[a\\]\\(b\\)` → `[a](b)`
- `회의 끝났\\.` → `회의 끝났.`
- `code \\\\ literal` → `code \\ literal` (single non-significant `\\` stays literal)
- `\\n` (escaped newline literal) → `\n` (real newline)
- `\\t` → `\t`
- Already normalized text round-trips unchanged
- Empty string → empty string
- `null`/`undefined` input — schema enforces `string`, so test only documents this via TypeScript at compile time, no runtime test needed
- Inside `<code>...\\*...</code>` block — separate test asserting `normalizeEscapes` is NOT called when wrapping element is `code_block` (this is the wrapper guard).

- [ ] **Step 2: Confirm tests fail**

```bash
pnpm --filter @opencairn/web test -- escape-norm
```

- [ ] **Step 3: Implement `normalizeEscapes`**

Single function. Two passes (regex + replace):

1. Replace `\\\\(?=[*_#\[\]()`!])` → `$1` (drops the leading backslash for markdown-significant chars).
2. Replace `\\\\n` → `\n`, `\\\\t` → `\t`.

Export as named export. Pure, no I/O.

- [ ] **Step 4: Tests pass + commit**

```bash
git commit -m "feat(web): normalizeEscapes helper for paste / markdown post-process"
```

---

## Task 2: paste-norm Plate plugin

**Files:**

- Create: `apps/web/src/components/editor/plugins/paste-norm.tsx`
- Modify: editor plugin list (locate via `grep -rn "createPlatePlugin\|withPlugins" apps/web/src/components/editor`).

- [ ] **Step 1: Inspect Plate v49 paste extension API**

Plate v49 exposes `editor.tf.insertFragment` and a `paste` handler hook. The plugin's job is to intercept the inserted fragment, walk text nodes that are NOT inside `code_block` / `code_line`, and run `normalizeEscapes` over each.

- [ ] **Step 2: Write paste plugin**

`paste-norm.tsx`:

```tsx
import { createPlatePlugin } from "platejs/react";
import { normalizeEscapes } from "@/lib/markdown/escape-norm";

export const pasteNormPlugin = createPlatePlugin({
  key: "paste-norm",
}).extend({
  override: {
    plugins: {
      paste: {
        api: {
          // Walk Plate fragment; on each text node whose ancestor chain does
          // not include code_block / code_line, replace text with normalizeEscapes(text).
        },
      },
    },
  },
});
```

(Exact Plate v49 hook surface verified during implementation — fall back to `editor.tf.normalizeNode` if `paste.api` isn't viable.)

- [ ] **Step 3: Register the plugin**

Add `pasteNormPlugin` to the editor's plugin list, AFTER any plugin that adjusts the fragment shape (so escape-norm sees the final text).

- [ ] **Step 4: Smoke**

`pnpm --filter @opencairn/web dev`. Paste `\\*test\\*` into a paragraph → see `*test*`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): paste-norm Plate plugin collapses external markdown escapes"
```

---

## Task 3: markdownToPlate post-process

**Files:**

- Modify: `apps/web/src/lib/markdown/markdownToPlate.ts`

- [ ] **Step 1: Add a final-pass step**

After existing GFM/mermaid/callout post-processors, walk the produced Plate value and run `normalizeEscapes` on every text-node `text` field, again skipping any node whose ancestor chain includes `code_block` / `code_line`.

- [ ] **Step 2: Reuse existing tests + add 1**

Append to `markdownToPlate.test.ts` (existing): `markdownToPlate("\\*test\\*").nodes[0].children[0].text === "*test*"`.

- [ ] **Step 3: Tests pass + commit**

```bash
git commit -m "feat(web): markdownToPlate post-processes escape sequences"
```

---

## Task 4: Mermaid theme reactivity

**Files:**

- Modify: `apps/web/src/hooks/useMermaidRender.ts`
- Modify: `apps/web/src/hooks/useMermaidRender.test.tsx`
- Modify: `apps/web/src/components/editor/blocks/mermaid/mermaid-element.tsx`

- [ ] **Step 1: Write a failing test**

In `useMermaidRender.test.tsx`, render hook with `theme="default"`, change to `theme="dark"`, assert second `mermaid.render` call fires with the new global theme.

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

Move `mermaid.initialize` out of the singleton-import side effect. Inside the hook's effect, on each `[code, theme]` change:

1. `await loadMermaid()` (still the singleton import).
2. `mermaid.initialize({ theme, securityLevel: "strict", startOnLoad: false })`.
3. `await mermaid.render(idRef.current, code)`.

Hook signature becomes `useMermaidRender(code, theme)`.

`MermaidElement` reads `useTheme()` and passes it in. (Locate the existing theme hook via `grep -rn "useTheme\\b\\|next-themes" apps/web/src/lib`.)

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Manual smoke**

Render a page with one mermaid block + dev tools open. Toggle dark mode via the theme switcher. Mermaid SVG re-renders within 1 s.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): mermaid render re-initializes on theme change"
```

---

## Task 5: Table row/column context menu

**Files:**

- Create: `apps/web/src/components/editor/blocks/table/table-context-menu.tsx`
- Create: `apps/web/src/components/editor/blocks/table/table-context-menu.test.tsx`
- Modify: existing `table-cell-element.tsx` (or wherever the cell renderer is) to wrap children with `<TableContextMenu>`.

- [ ] **Step 1: Failing test**

`table-context-menu.test.tsx`:

- Render a 2×2 table, right-click the (0,0) cell, click "Insert row below". Assert the editor's value is now a 3×2 table and selection is in (1,0).
- Right-click (0,1), click "Delete column". Assert value is 2×1.
- Disabled "Merge cells" when no multi-cell selection.

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `TableContextMenu`**

Use shadcn `ContextMenu` + `ContextMenuTrigger` + items wired to `@platejs/table` editor commands:

- `insertTableRow({ at: cellPath, before: true })` for "above"
- `insertTableRow({ at: cellPath, before: false })` for "below"
- `insertTableColumn({ at: cellPath, before: true })` for "left"
- `deleteRow(cellPath)`, `deleteColumn(cellPath)`, `deleteTable(tablePath)`
- `mergeCells(selection)` / `splitCell(cellPath)` (gate by selection shape)

i18n keys per § 6 of the spec.

- [ ] **Step 4: Wire into TableCellElement**

Wrap the cell's `children` with `<TableContextMenu cellPath={path}>...</TableContextMenu>`.

- [ ] **Step 5: Tests pass + commit**

```bash
git commit -m "feat(web): table cell context menu — insert/delete/merge rows and columns"
```

---

## Task 6: i18n keys + parity

**Files:**

- Modify: `apps/web/messages/ko/editor.json` + `apps/web/messages/en/editor.json`

- [ ] **Step 1: Add `editor.table.menu.*`**

ko + en parity, 8 keys (insert above / below / left / right + delete row / col / table + merge / split — total 9). Include the `paste.normalized` toast string.

- [ ] **Step 2: Run parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): editor.table.menu + paste.normalized i18n keys"
```

---

## Task 7: Docs + status

- [ ] Update `docs/contributing/plans-status.md` — add a Phase A row with branch + test counts. Phase B items listed as deferred.
- [ ] Update `CLAUDE.md` Plans bullet — Plan 2E Phase A → Complete; Phase B items remain Active / next.
- [ ] Commit:

```bash
git commit -m "docs(plans): plan 2E phase A complete + phase B follow-ups listed"
```

---

## Task 8: opencairn-post-feature

- [ ] `pnpm --filter @opencairn/web test` — all pass.
- [ ] `pnpm --filter @opencairn/web typecheck`.
- [ ] `pnpm --filter @opencairn/web i18n:parity`.
- [ ] Manual smoke: dev server, open a note containing a mermaid block + a 2×2 table, toggle theme, paste `\\*x\\*`. All three behaviors visible.
- [ ] Push branch, open PR. Title: `feat: plan 2E phase A — editor follow-ups (mermaid theme + table menu + escape-norm)`.

---

## Out-of-Plan Follow-ups (Phase B)

- Image block — `2026-04-29-plan-2e-image-block.md` (TBD).
- Embed block — `2026-04-29-plan-2e-embed-block.md` (TBD).
- Drag-resize column handles — `2026-04-29-plan-2e-column-resize.md` (TBD).
- Inline-math input UX — `2026-04-29-plan-2e-math-ux.md` (TBD).
