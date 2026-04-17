# Plan 2: Editor + Notion급 협업 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-04-18 확장**: 본 plan은 에디터 뿐만 아니라 **Notion급 팀 협업 기능**까지 포함한다. 데이터 모델(Workspace/Permissions)은 [Plan 1](2026-04-09-plan-1-foundation.md)에서 셋업되고, 여기서는 그 위에 돌아가는 UI/UX/실시간 동기화/알림을 구현. 설계 근거는 [collaboration-model.md](../../architecture/collaboration-model.md).

**Goal:** Build a fully-featured rich-text note editor in `apps/web` using Plate v49 with LaTeX, wiki-links, slash commands, real-time save/load, **multi-user 실시간 협업 (Yjs CRDT)**, Notion 스타일 권한/코멘트/@mention/알림/프레즌스/활동 피드/공개 링크/게스트 — Notion 대체 포지션을 위한 모든 협업 테이블 스테이크.

**Architecture:** The editor lives in `apps/web` as a client component. All persistence goes through the Hono API at `apps/api` — no Server Actions. Plate v49 provides the plugin-based editing foundation; custom plugins handle wiki-links, slash commands, @mentions, comments. The sidebar (folder tree + note list) is a separate client component that reads from the API and drives navigation. **Hocuspocus 서버**가 별도 Docker 서비스로 동작하며 Yjs document state를 PostgreSQL에 persist한다. 인증은 Better Auth 세션 + page-level `canWrite` 검증.

**Tech Stack:** Plate v49 (Yjs 플러그인 + comments 플러그인), shadcn/ui, KaTeX, @platejs/math (MathKit), **Yjs**, **Hocuspocus 서버 + Provider + Awareness**, TanStack Query, Tailwind CSS 4, Hono 4, Zod, React 19, Next.js 16, Resend (이메일 알림).

> **Task 개요 (1~7 에디터 + 8~17 협업)**:
> - Task 1~7: Plate 에디터, LaTeX, wiki-links, slash, save/load, sidebar (기존)
> - **Task 8: Hocuspocus 서버 + 권한 인증 hook (신규)**
> - **Task 9: 실시간 공동 편집 클라이언트 + Presence (신규)**
> - **Task 10: Block anchor Comments + threading (신규)**
> - **Task 11: @mention 파서 + resolver (신규)**
> - **Task 12: Notifications 백엔드 (테이블 + SSE) (신규)**
> - **Task 13: Notification UI (인앱 뱃지 + 드롭다운) (신규)**
> - **Task 14: Email 알림 (Resend + batching) (신규)**
> - **Task 15: Activity feed 페이지 (신규)**
> - **Task 16: Public share link (신규)**
> - **Task 17: Guest invite 플로우 (신규)**

---

## File Structure

```
apps/web/
  src/
    components/
      editor/
        note-editor.tsx             -- main Plate editor client component
        editor-toolbar.tsx          -- floating + fixed toolbar
        plugins/
          wiki-link-plugin.tsx      -- [[]] syntax plugin + autocomplete
          slash-command-plugin.tsx  -- slash command menu plugin
          latex-plugin.tsx          -- LaTeX inline + block plugin wiring
        elements/
          wiki-link-element.tsx     -- rendered wiki-link node
          math-inline-element.tsx   -- inline math render (KaTeX)
          math-block-element.tsx    -- block math render (KaTeX)
          slash-command-element.tsx -- slash command combobox UI
      sidebar/
        sidebar.tsx                 -- root sidebar shell
        folder-tree.tsx             -- collapsible folder tree
        note-list.tsx               -- note list within a folder
        new-note-button.tsx         -- create note CTA
    lib/
      api-client.ts                 -- typed fetch wrapper for Hono API (already exists or extend)
      editor-utils.ts               -- serialize/deserialize Plate value ↔ API JSON
    hooks/
      use-note.ts                   -- SWR/fetch hook: load note by id
      use-save-note.ts              -- debounced save hook
      use-note-search.ts            -- search notes for wiki-link autocomplete
    app/
      (app)/
        notes/
          [noteId]/
            page.tsx                -- note detail page (server shell)
            loading.tsx             -- Suspense fallback
  components/
    source-viewer/
      SourceViewer.tsx              -- 소스 파일 뷰어 라우터 (파일 타입별 분기)
      PdfViewer.tsx                 -- @react-pdf-viewer/core (PDF 뷰어, 검색/하이라이트)
      HtmlViewer.tsx                -- iframe + sandbox 속성 (HTML 파일 안전 렌더링)
```

> **Source Viewer 뷰어 라이브러리:**
> - PDF: `@react-pdf-viewer/core` (툴바, 줌, 페이지 네비, PDF 내 텍스트 검색 내장)
> - HTML: `<iframe sandbox="allow-scripts allow-same-origin">` (별도 라이브러리 없음)
> - 모든 업로드 파일(DOCX/PPTX/XLSX/HWP)은 인제스트 시 PDF로 변환되어 R2 저장 → PdfViewer 단일 뷰어로 처리

---

### Task 1: Install Plate + shadcn/ui in apps/web

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.ts` (transpile KaTeX)
- Create: `apps/web/components.json` (shadcn config)

- [ ] **Step 1: Add Plate and related dependencies**

```bash
cd apps/web
pnpm add @platejs/core @platejs/basic-nodes @platejs/math @platejs/link \
  @platejs/combobox @platejs/dnd @platejs/markdown \
  katex react-dnd react-dnd-html5-backend
pnpm add -D @types/katex
```

- [ ] **Step 2: Initialize shadcn/ui**

```bash
cd apps/web
pnpm dlx shadcn@latest init
```

When prompted:
- Style: **New York**
- Base color: **Neutral**
- CSS variables: **yes**

This creates `apps/web/components.json` and updates `tailwind.config.ts` and `src/app/globals.css`.

- [ ] **Step 3: Install required shadcn components**

```bash
cd apps/web
pnpm dlx shadcn@latest add button input scroll-area tooltip popover command separator badge
```

- [ ] **Step 4: Add KaTeX CSS to the global layout**

Modify `apps/web/src/app/layout.tsx` — import KaTeX stylesheet:

```tsx
import 'katex/dist/katex.min.css'
```

- [ ] **Step 5: Allow KaTeX in next.config.ts**

```ts
// apps/web/next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['katex'],
  experimental: {
    // already present from Plan 1
  },
}

export default nextConfig
```

- [ ] **Commit:** `feat(web): install Plate v49, shadcn/ui, and KaTeX`

---

### Task 2: Create the Note Editor Component with Plate

**Files:**
- Create: `apps/web/src/components/editor/note-editor.tsx`
- Create: `apps/web/src/components/editor/editor-toolbar.tsx`
- Create: `apps/web/src/lib/editor-utils.ts`

- [ ] **Step 1: Create editor-utils.ts — serialize/deserialize helpers**

```ts
// apps/web/src/lib/editor-utils.ts
import type { Value } from '@platejs/core'

/** Convert Plate JSON value to a plain string for FTS (server-side only). */
export function plateValueToText(value: Value): string {
  return value
    .map((node) => {
      if ('children' in node) {
        return plateValueToText(node.children as Value)
      }
      return (node as { text?: string }).text ?? ''
    })
    .join('\n')
}

/** Return a safe initial value when the stored content is null/empty. */
export function emptyEditorValue(): Value {
  return [{ type: 'p', children: [{ text: '' }] }]
}

/** Parse stored JSON content safely, falling back to empty value. */
export function parseEditorContent(raw: string | null | undefined): Value {
  if (!raw) return emptyEditorValue()
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : emptyEditorValue()
  } catch {
    return emptyEditorValue()
  }
}
```

- [ ] **Step 2: Create editor-toolbar.tsx**

```tsx
// apps/web/src/components/editor/editor-toolbar.tsx
'use client'

import { useEditorRef, useEditorSelector } from '@platejs/core/react'
import { MarkToolbarButton } from '@platejs/basic-nodes/react'
import { Bold, Italic, Underline, Strikethrough, Code } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function EditorToolbar() {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <MarkToolbarButton nodeType="bold" tooltip="Bold (⌘B)">
            <Bold className="h-4 w-4" />
          </MarkToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Bold</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <MarkToolbarButton nodeType="italic" tooltip="Italic (⌘I)">
            <Italic className="h-4 w-4" />
          </MarkToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Italic</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <MarkToolbarButton nodeType="underline" tooltip="Underline (⌘U)">
            <Underline className="h-4 w-4" />
          </MarkToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Underline</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-4" />

      <Tooltip>
        <TooltipTrigger asChild>
          <MarkToolbarButton nodeType="strikethrough">
            <Strikethrough className="h-4 w-4" />
          </MarkToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Strikethrough</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <MarkToolbarButton nodeType="code">
            <Code className="h-4 w-4" />
          </MarkToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Inline code</TooltipContent>
      </Tooltip>
    </div>
  )
}
```

- [ ] **Step 3: Create note-editor.tsx — core editor component**

```tsx
// apps/web/src/components/editor/note-editor.tsx
'use client'

import { useMemo, useCallback } from 'react'
import { Plate, usePlateEditor } from '@platejs/core/react'
import {
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
  HeadingPlugin,
  BlockquotePlugin,
  CodeBlockPlugin,
  HorizontalRulePlugin,
  ListPlugin,
} from '@platejs/basic-nodes/react'
import { DndPlugin } from '@platejs/dnd'
import { PlateContent } from '@platejs/core/react'
import { EditorToolbar } from './editor-toolbar'
import { WikiLinkPlugin } from './plugins/wiki-link-plugin'
import { SlashCommandPlugin } from './plugins/slash-command-plugin'
import { LatexPlugin } from './plugins/latex-plugin'
import { parseEditorContent } from '@/lib/editor-utils'
import type { Value } from '@platejs/core'

interface NoteEditorProps {
  noteId: string
  initialContent: string | null
  onSave: (content: string) => void
}

export function NoteEditor({ noteId, initialContent, onSave }: NoteEditorProps) {
  const initialValue = useMemo(
    () => parseEditorContent(initialContent),
    // Only parse once on mount; noteId change re-mounts via key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const editor = usePlateEditor({
    plugins: [
      BoldPlugin,
      ItalicPlugin,
      UnderlinePlugin,
      StrikethroughPlugin,
      CodePlugin,
      HeadingPlugin,
      BlockquotePlugin,
      CodeBlockPlugin,
      HorizontalRulePlugin,
      ListPlugin,
      DndPlugin.configure({ options: { enableScroller: true } }),
      LatexPlugin,
      WikiLinkPlugin.configure({ options: { noteId } }),
      SlashCommandPlugin,
    ],
    value: initialValue,
  })

  const handleChange = useCallback(
    ({ value }: { value: Value }) => {
      onSave(JSON.stringify(value))
    },
    [onSave]
  )

  return (
    <div className="flex h-full flex-col">
      <Plate editor={editor} onChange={handleChange}>
        <EditorToolbar />
        <PlateContent
          className="min-h-0 flex-1 overflow-y-auto px-8 py-6 text-base focus:outline-none"
          placeholder="Start writing..."
          spellCheck
        />
      </Plate>
    </div>
  )
}
```

- [ ] **Commit:** `feat(web): add NoteEditor base component with Plate v49`

---

### Task 3: Add LaTeX Support (MathKit + KaTeX)

**Files:**
- Create: `apps/web/src/components/editor/plugins/latex-plugin.tsx`
- Create: `apps/web/src/components/editor/elements/math-inline-element.tsx`
- Create: `apps/web/src/components/editor/elements/math-block-element.tsx`

- [ ] **Step 1: Create math-inline-element.tsx**

```tsx
// apps/web/src/components/editor/elements/math-inline-element.tsx
'use client'

import { useSelected } from 'slate-react'
import katex from 'katex'
import { useReadOnly } from '@platejs/core/react'
import type { PlateElementProps } from '@platejs/core/react'

export function MathInlineElement({ children, element, ...props }: PlateElementProps) {
  const selected = useSelected()
  const readOnly = useReadOnly()
  const latex = (element as { latex?: string }).latex ?? ''

  const rendered = (() => {
    try {
      return katex.renderToString(latex, { throwOnError: false, displayMode: false })
    } catch {
      return latex
    }
  })()

  return (
    <span
      {...props}
      contentEditable={false}
      className={`inline-block cursor-pointer rounded px-0.5 font-mono text-sm
        ${selected ? 'ring-2 ring-primary' : 'hover:bg-muted'}`}
    >
      <span
        dangerouslySetInnerHTML={{ __html: rendered }}
        className="pointer-events-none select-none"
      />
      {/* hidden editable content for Slate */}
      <span className="sr-only">{children}</span>
    </span>
  )
}
```

- [ ] **Step 2: Create math-block-element.tsx**

```tsx
// apps/web/src/components/editor/elements/math-block-element.tsx
'use client'

import { useSelected } from 'slate-react'
import katex from 'katex'
import type { PlateElementProps } from '@platejs/core/react'

export function MathBlockElement({ children, element, ...props }: PlateElementProps) {
  const selected = useSelected()
  const latex = (element as { latex?: string }).latex ?? ''

  const rendered = (() => {
    try {
      return katex.renderToString(latex, { throwOnError: false, displayMode: true })
    } catch {
      return latex
    }
  })()

  return (
    <div
      {...props}
      contentEditable={false}
      className={`my-4 flex justify-center rounded-md border p-4
        ${selected ? 'ring-2 ring-primary' : 'hover:bg-muted/40'}`}
    >
      <span
        dangerouslySetInnerHTML={{ __html: rendered }}
        className="pointer-events-none select-none"
      />
      <span className="sr-only">{children}</span>
    </div>
  )
}
```

- [ ] **Step 3: Create latex-plugin.tsx**

```tsx
// apps/web/src/components/editor/plugins/latex-plugin.tsx
import { createPlatePlugin } from '@platejs/core'
import { MathPlugin } from '@platejs/math'
import { MathInlineElement } from '../elements/math-inline-element'
import { MathBlockElement } from '../elements/math-block-element'

/**
 * LatexPlugin composes @platejs/math (MathKit) with KaTeX rendering elements.
 * MathKit handles $...$ inline and $$...$$ block delimiter detection.
 */
export const LatexPlugin = MathPlugin.configure({
  render: {
    afterEditable: undefined,
  },
}).extend(() => ({
  render: {
    node: {
      math_inline: MathInlineElement,
      math_block: MathBlockElement,
    },
  },
}))
```

- [ ] **Commit:** `feat(web): add LaTeX inline and block rendering via MathKit + KaTeX`

---

### Task 4: Add Wiki-Link Plugin ([[]] Syntax with Autocomplete)

**Files:**
- Create: `apps/web/src/components/editor/plugins/wiki-link-plugin.tsx`
- Create: `apps/web/src/components/editor/elements/wiki-link-element.tsx`
- Create: `apps/web/src/hooks/use-note-search.ts`

- [ ] **Step 1: Create use-note-search.ts**

```ts
// apps/web/src/hooks/use-note-search.ts
import { useState, useEffect } from 'react'

export interface NoteSearchResult {
  id: string
  title: string
  folderName?: string
}

export function useNoteSearch(query: string, projectId: string | null) {
  const [results, setResults] = useState<NoteSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query || query.length < 1 || !projectId) {
      setResults([])
      return
    }

    let cancelled = false
    setLoading(true)

    const url = `/api/notes/search?q=${encodeURIComponent(query)}&projectId=${projectId}&limit=10`

    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: { notes: NoteSearchResult[] }) => {
        if (!cancelled) setResults(data.notes ?? [])
      })
      .catch(() => {
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [query, projectId])

  return { results, loading }
}
```

- [ ] **Step 2: Create wiki-link-element.tsx**

```tsx
// apps/web/src/components/editor/elements/wiki-link-element.tsx
'use client'

import { useRouter } from 'next/navigation'
import type { PlateElementProps } from '@platejs/core/react'

interface WikiLinkElementData {
  noteId?: string
  title?: string
}

export function WikiLinkElement({ children, element, ...props }: PlateElementProps) {
  const router = useRouter()
  const { noteId, title } = element as WikiLinkElementData

  const handleClick = () => {
    if (noteId) router.push(`/notes/${noteId}`)
  }

  return (
    <span
      {...props}
      contentEditable={false}
      onClick={handleClick}
      className="cursor-pointer rounded bg-primary/10 px-1 py-0.5 text-primary underline-offset-2 hover:underline"
      title={noteId ? `Go to: ${title}` : 'Note not found'}
      data-wiki-link={noteId ?? 'unresolved'}
    >
      {title ?? children}
      <span className="sr-only">{children}</span>
    </span>
  )
}
```

- [ ] **Step 3: Create wiki-link-plugin.tsx**

```tsx
// apps/web/src/components/editor/plugins/wiki-link-plugin.tsx
'use client'

import { createPlatePlugin } from '@platejs/core'
import { ComboboxPlugin } from '@platejs/combobox'
import { WikiLinkElement } from '../elements/wiki-link-element'

const WIKI_LINK_TYPE = 'wiki_link'
const TRIGGER = '[['
const CLOSE = ']]'

/**
 * WikiLinkPlugin detects [[...]] syntax and shows a note search combobox.
 * On selection, inserts a wiki_link void node. On ]] close, finalizes.
 */
export const WikiLinkPlugin = createPlatePlugin({
  key: 'wiki_link',
  node: {
    type: WIKI_LINK_TYPE,
    isElement: true,
    isVoid: true,
    isInline: true,
  },
  render: {
    node: WikiLinkElement,
  },
  options: {
    noteId: '' as string, // current note id, injected via configure()
  },
}).extend(({ editor }) =>
  ComboboxPlugin.configure({
    options: {
      trigger: TRIGGER,
      onSelectItem: ({ editor: _e, item }: { editor: unknown; item: { id: string; title: string } }) => {
        // Insert wiki_link node
        ;(editor as { insertNode: (node: unknown) => void }).insertNode({
          type: WIKI_LINK_TYPE,
          noteId: item.id,
          title: item.title,
          children: [{ text: '' }],
        })
      },
    },
  })
)
```

- [ ] **Step 4: Add wiki-link autocomplete popover to the editor**

In `apps/web/src/components/editor/note-editor.tsx`, add a `WikiLinkCombobox` component below `<PlateContent>`. This component uses `useNoteSearch` keyed off the combobox query state from the plugin.

```tsx
// Append inside the <Plate>...</Plate> block, after <PlateContent>:
import { WikiLinkCombobox } from './elements/wiki-link-element'

// Inside JSX:
<WikiLinkCombobox projectId={projectId} />
```

(The `WikiLinkCombobox` renders a `<Command>` popover driven by `useNoteSearch`; attach it as a sibling to `PlateContent`. Full implementation follows shadcn `<Command>` pattern with `useNoteSearch(query, projectId)` for results.)

- [ ] **Commit:** `feat(web): add wiki-link [[]] plugin with note search autocomplete`

---

### Task 5: Add Slash Command Menu

**Files:**
- Create: `apps/web/src/components/editor/plugins/slash-command-plugin.tsx`
- Create: `apps/web/src/components/editor/elements/slash-command-element.tsx`

- [ ] **Step 1: Define slash command items**

```ts
// apps/web/src/components/editor/plugins/slash-command-plugin.tsx
import { createPlatePlugin } from '@platejs/core'
import { ComboboxPlugin } from '@platejs/combobox'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code2,
  Quote,
  Minus,
  Sigma,
} from 'lucide-react'

export const SLASH_COMMANDS = [
  { id: 'h1',        label: 'Heading 1',    icon: Heading1,     type: 'h1' },
  { id: 'h2',        label: 'Heading 2',    icon: Heading2,     type: 'h2' },
  { id: 'h3',        label: 'Heading 3',    icon: Heading3,     type: 'h3' },
  { id: 'ul',        label: 'Bullet List',  icon: List,         type: 'ul' },
  { id: 'ol',        label: 'Ordered List', icon: ListOrdered,  type: 'ol' },
  { id: 'code',      label: 'Code Block',   icon: Code2,        type: 'code_block' },
  { id: 'blockquote',label: 'Blockquote',   icon: Quote,        type: 'blockquote' },
  { id: 'hr',        label: 'Divider',      icon: Minus,        type: 'hr' },
  { id: 'math',      label: 'LaTeX Block',  icon: Sigma,        type: 'math_block' },
] as const

export const SlashCommandPlugin = createPlatePlugin({
  key: 'slash_command',
}).extend(() =>
  ComboboxPlugin.configure({
    options: {
      trigger: '/',
      controlled: true,
      items: SLASH_COMMANDS.map((c) => ({ id: c.id, label: c.label, data: c })),
      onSelectItem: ({ editor, item }: { editor: { setNodes: (props: unknown, opts: unknown) => void; deleteBackward: (unit: string) => void }, item: { data: (typeof SLASH_COMMANDS)[number] } }) => {
        // Delete the slash trigger character then set block type
        editor.deleteBackward('character')
        editor.setNodes({ type: item.data.type }, { match: (n: { type?: string }) => n.type !== undefined })
      },
    },
  })
)
```

- [ ] **Step 2: Create slash-command-element.tsx — the dropdown UI**

```tsx
// apps/web/src/components/editor/elements/slash-command-element.tsx
'use client'

import { useComboboxControls, useComboboxSelectionHandler } from '@platejs/combobox'
import { Command, CommandItem, CommandList, CommandEmpty } from '@/components/ui/command'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { SLASH_COMMANDS } from '../plugins/slash-command-plugin'

export function SlashCommandCombobox() {
  const { isOpen, query, items } = useComboboxControls('slash_command')
  const onSelect = useComboboxSelectionHandler('slash_command')

  const filtered = SLASH_COMMANDS.filter((c) =>
    c.label.toLowerCase().includes((query ?? '').toLowerCase())
  )

  return (
    <Popover open={isOpen}>
      <PopoverContent className="w-64 p-0" align="start" side="bottom">
        <Command>
          <CommandList>
            {filtered.length === 0 && <CommandEmpty>No results</CommandEmpty>}
            {filtered.map((cmd) => {
              const Icon = cmd.icon
              return (
                <CommandItem
                  key={cmd.id}
                  value={cmd.id}
                  onSelect={() => onSelect(items.find((i) => i.id === cmd.id)!)}
                  className="flex items-center gap-2"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {cmd.label}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 3: Mount SlashCommandCombobox inside the editor**

In `apps/web/src/components/editor/note-editor.tsx`, add inside the `<Plate>` block:

```tsx
import { SlashCommandCombobox } from './elements/slash-command-element'

// Inside JSX after <PlateContent>:
<SlashCommandCombobox />
```

- [ ] **Commit:** `feat(web): add slash command menu with block-type shortcuts`

---

### Task 6: Wire Editor to API (Save/Load Notes)

**Files:**
- Create: `apps/web/src/hooks/use-note.ts`
- Create: `apps/web/src/hooks/use-save-note.ts`
- Create/Modify: `apps/web/src/app/(app)/notes/[noteId]/page.tsx`
- Create: `apps/web/src/app/(app)/notes/[noteId]/loading.tsx`
- Modify: `apps/api/src/routes/notes.ts` (add search endpoint)

- [ ] **Step 1: Create use-note.ts — fetch a note by ID**

```ts
// apps/web/src/hooks/use-note.ts
import useSWR from 'swr'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function fetcher(url: string) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export interface NoteDetail {
  id: string
  title: string
  content: string | null
  folderId: string | null
  projectId: string
  updatedAt: string
}

export function useNote(noteId: string) {
  const { data, error, isLoading, mutate } = useSWR<{ note: NoteDetail }>(
    noteId ? `${API}/notes/${noteId}` : null,
    fetcher
  )
  return { note: data?.note ?? null, error, isLoading, mutate }
}
```

- [ ] **Step 2: Create use-save-note.ts — debounced auto-save**

```ts
// apps/web/src/hooks/use-save-note.ts
import { useCallback, useRef } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const DEBOUNCE_MS = 1500

export function useSaveNote(noteId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string | null>(null)

  const save = useCallback(
    (content: string) => {
      pendingRef.current = content
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(async () => {
        if (pendingRef.current === null) return
        try {
          await fetch(`${API}/notes/${noteId}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: pendingRef.current }),
          })
          pendingRef.current = null
        } catch (err) {
          console.error('[useSaveNote] save failed', err)
        }
      }, DEBOUNCE_MS)
    },
    [noteId]
  )

  return { save }
}
```

- [ ] **Step 3: Create note detail page**

```tsx
// apps/web/src/app/(app)/notes/[noteId]/page.tsx
import { Suspense } from 'react'
import { NoteEditorClient } from './note-editor-client'

interface Props {
  params: Promise<{ noteId: string }>
}

export default async function NotePage({ params }: Props) {
  const { noteId } = await params
  return (
    <div className="flex h-full flex-col">
      <Suspense fallback={<div className="p-8 text-muted-foreground">Loading note...</div>}>
        <NoteEditorClient noteId={noteId} />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 4: Create NoteEditorClient — client shell that wires hooks to editor**

```tsx
// apps/web/src/app/(app)/notes/[noteId]/note-editor-client.tsx
'use client'

import { NoteEditor } from '@/components/editor/note-editor'
import { useNote } from '@/hooks/use-note'
import { useSaveNote } from '@/hooks/use-save-note'

export function NoteEditorClient({ noteId }: { noteId: string }) {
  const { note, isLoading } = useNote(noteId)
  const { save } = useSaveNote(noteId)

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>
  if (!note) return <div className="p-8 text-destructive">Note not found.</div>

  return (
    <NoteEditor
      key={noteId}
      noteId={noteId}
      initialContent={note.content}
      onSave={save}
    />
  )
}
```

- [ ] **Step 5: Create loading.tsx**

```tsx
// apps/web/src/app/(app)/notes/[noteId]/loading.tsx
export default function NoteLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">Loading note...</p>
    </div>
  )
}
```

- [ ] **Step 6: Add note search endpoint to Hono API**

Add to `apps/api/src/routes/notes.ts`:

```ts
// GET /notes/search?q=&projectId=&limit=
notes.get('/search', sessionMiddleware, async (c) => {
  const { q, projectId, limit } = c.req.query()
  if (!projectId) return c.json({ error: 'projectId required' }, 400)

  const db = c.get('db')
  const session = c.get('session')

  const results = await db
    .select({ id: notesTable.id, title: notesTable.title })
    .from(notesTable)
    .where(
      and(
        eq(notesTable.projectId, projectId),
        eq(notesTable.userId, session.userId),
        q ? ilike(notesTable.title, `%${q}%`) : undefined
      )
    )
    .limit(Number(limit) || 10)

  return c.json({ notes: results })
})
```

- [ ] **Commit:** `feat(web,api): wire note editor save/load via Hono API`

---

### Task 7: Build Sidebar (Folder Tree + Note List)

**Files:**
- Create: `apps/web/src/components/sidebar/sidebar.tsx`
- Create: `apps/web/src/components/sidebar/folder-tree.tsx`
- Create: `apps/web/src/components/sidebar/note-list.tsx`
- Create: `apps/web/src/components/sidebar/new-note-button.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`

- [ ] **Step 1: Create new-note-button.tsx**

```tsx
// apps/web/src/components/sidebar/new-note-button.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface Props {
  projectId: string
  folderId?: string
}

export function NewNoteButton({ projectId, folderId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, folderId, title: 'Untitled' }),
      })
      const data = await res.json()
      router.push(`/notes/${data.note.id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2"
      onClick={handleCreate}
      disabled={loading}
    >
      <Plus className="h-4 w-4" />
      New note
    </Button>
  )
}
```

- [ ] **Step 2: Create note-list.tsx**

```tsx
// apps/web/src/components/sidebar/note-list.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { FileText } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface Note { id: string; title: string }

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => r.json())

interface Props {
  folderId: string
  projectId: string
}

export function NoteList({ folderId, projectId }: Props) {
  const pathname = usePathname()
  const { data } = useSWR<{ notes: Note[] }>(
    `${API}/notes?folderId=${folderId}&projectId=${projectId}`,
    fetcher
  )

  const notes = data?.notes ?? []

  return (
    <ul className="ml-2 space-y-0.5">
      {notes.map((note) => (
        <li key={note.id}>
          <Link
            href={`/notes/${note.id}`}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors
              ${pathname === `/notes/${note.id}`
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{note.title || 'Untitled'}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Create folder-tree.tsx**

```tsx
// apps/web/src/components/sidebar/folder-tree.tsx
'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react'
import useSWR from 'swr'
import { NoteList } from './note-list'
import { NewNoteButton } from './new-note-button'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface FolderItem { id: string; name: string }

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => r.json())

interface Props { projectId: string }

export function FolderTree({ projectId }: Props) {
  const { data } = useSWR<{ folders: FolderItem[] }>(
    `${API}/folders?projectId=${projectId}`,
    fetcher
  )
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())

  const toggleFolder = (id: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const folders = data?.folders ?? []

  return (
    <div className="space-y-0.5">
      {folders.map((folder) => {
        const open = openFolders.has(folder.id)
        return (
          <div key={folder.id}>
            <button
              onClick={() => toggleFolder(folder.id)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              {open ? (
                <FolderOpen className="h-4 w-4 shrink-0" />
              ) : (
                <Folder className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{folder.name}</span>
            </button>
            {open && (
              <div className="ml-3 border-l pl-2">
                <NoteList folderId={folder.id} projectId={projectId} />
                <NewNoteButton projectId={projectId} folderId={folder.id} />
              </div>
            )}
          </div>
        )
      })}
      <NewNoteButton projectId={projectId} />
    </div>
  )
}
```

- [ ] **Step 4: Create sidebar.tsx**

```tsx
// apps/web/src/components/sidebar/sidebar.tsx
'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { FolderTree } from './folder-tree'

interface Props { projectId: string }

export function Sidebar({ projectId }: Props) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="px-3 py-4">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Notes
        </p>
        <ScrollArea className="h-[calc(100vh-8rem)]">
          <FolderTree projectId={projectId} />
        </ScrollArea>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: Integrate sidebar into the app layout**

Modify `apps/web/src/app/(app)/layout.tsx`:

```tsx
import { Sidebar } from '@/components/sidebar/sidebar'

// Wrap children with sidebar — projectId comes from a context provider
// set up in the root (app) layout. Placeholder: read from cookie/session.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // TODO: replace with actual project selection context in a future plan
  const defaultProjectId = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_ID ?? ''

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar projectId={defaultProjectId} />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
```

- [ ] **Commit:** `feat(web): add collapsible sidebar with folder tree and note list`

---

## 협업 기능 (Task 8~17) — Notion급 협업 테이블 스테이크

> Plan 1에서 Workspace/Members/Invites/Permissions 기반이 이미 구축됨.
> Comments/Notifications/ActivityEvents/PublicShareLinks 테이블은 본 plan 중에 추가.

### Task 8: Hocuspocus 서버 + 권한 인증 Hook

**Files:**
- Create: `apps/hocuspocus/package.json`
- Create: `apps/hocuspocus/src/server.ts`
- Create: `apps/hocuspocus/src/auth.ts`
- Create: `apps/hocuspocus/Dockerfile`
- Modify: `docker-compose.yml` (hocuspocus 서비스 추가)

- [ ] **Step 1**: `@hocuspocus/server` + `@hocuspocus/extension-database` 설치
- [ ] **Step 2**: `auth.ts` — Better Auth 세션 토큰 검증 + `canWrite(user, note)` 호출

```typescript
// apps/hocuspocus/src/auth.ts
import type { onAuthenticatePayload } from "@hocuspocus/server";
import { betterAuth } from "./better-auth-client";
import { canWrite, canRead, resolveRole } from "./permissions";

export async function authenticateConnection(payload: onAuthenticatePayload) {
  const { documentName, token } = payload;
  const session = await betterAuth.verifySession(token);
  if (!session) throw new Error("Unauthenticated");

  // documentName = "page:<noteId>"
  const noteId = documentName.replace(/^page:/, "");
  const role = await resolveRole(session.userId, { type: "note", id: noteId });

  if (role === "none") throw new Error("Forbidden");

  return {
    userId: session.userId,
    userName: session.name,
    readOnly: role === "viewer",
  };
}
```

- [ ] **Step 3**: `server.ts` — Hocuspocus 인스턴스 + Database extension (PostgreSQL에 Yjs state 영속화) + onAuthenticate 훅 + onChange에서 readOnly 검증

- [ ] **Step 4**: Dockerfile + docker-compose.yml에 서비스 추가 (port 1234, depends_on postgres)

- [ ] **Step 5**: Commit

```bash
git add apps/hocuspocus/ docker-compose.yml
git commit -m "feat(hocuspocus): Yjs collaboration server with Better Auth + permission-based access control"
```

---

### Task 9: 실시간 공동 편집 클라이언트 + Presence

**Files:**
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`
- Create: `apps/web/src/components/editor/PresenceStack.tsx`
- Create: `apps/web/src/hooks/useCollaborativeEditor.ts`

- [ ] **Step 1**: `@hocuspocus/provider` 설치, Plate에 Yjs 플러그인 연결
- [ ] **Step 2**: 페이지 로드 시 `new HocuspocusProvider({ url, name: "page:<noteId>", token })` 생성
- [ ] **Step 3**: Awareness로 사용자 정보 broadcast (`{ id, name, avatarUrl, color }`)
- [ ] **Step 4**: `<PresenceStack>` — 현재 페이지 보고 있는 사용자 아바타 스택 (상단 우측)
- [ ] **Step 5**: 다른 사용자의 커서 표시 (Plate selection awareness)
- [ ] **Step 6**: readOnly 플래그 시 Plate를 read-only 모드로
- [ ] **Step 7**: Commit

```bash
git commit -m "feat(web): real-time collaborative editing with presence avatars and cursors"
```

---

### Task 10: Block-anchor Comments + Threading

**Files:**
- Create: `packages/db/src/schema/comments.ts`
- Create: `apps/api/src/routes/comments.ts`
- Create: `apps/web/src/components/comments/CommentsPanel.tsx`
- Create: `apps/web/src/components/comments/CommentThread.tsx`
- Create: `apps/web/src/components/editor/plugins/CommentsPlugin.tsx`

- [ ] **Step 1**: `comments` + `comment_mentions` 테이블 (collaboration-model §2.3 스키마 그대로)
- [ ] **Step 2**: `/api/comments` CRUD 라우트 — canRead/canWrite 경유, thread (parent_id), resolve, 본인만 수정 등
- [ ] **Step 3**: Plate `CommentsPlugin` — 블록 hover 시 "💬 Add comment" 버튼, 블록 옆 뱃지 렌더
- [ ] **Step 4**: `CommentsPanel` — 페이지 우측 사이드 패널, 스레드 리스트
- [ ] **Step 5**: `CommentThread` — 댓글 + 답글 트리, resolve 버튼, 작성 폼
- [ ] **Step 6**: 블록 삭제 시 comments는 preserve (anchor_block_id → null로 강등)
- [ ] **Step 7**: Commit

```bash
git commit -m "feat(collab): block-anchor comments with threading and resolution"
```

---

### Task 11: @mention 파서 + Resolver

**Files:**
- Create: `apps/web/src/components/editor/plugins/MentionPlugin.tsx`
- Create: `apps/web/src/components/editor/plugins/mention-combobox.tsx`
- Create: `apps/api/src/routes/mentions.ts` — `/api/mentions/search?q=&type=`
- Modify: `comments`/`notes` 저장 시 mentions 파싱

- [ ] **Step 1**: Plate mention plugin — `@` 입력 시 combobox 열림
- [ ] **Step 2**: combobox 내용 소스:
  - `user`: workspace 멤버 검색 (`GET /api/workspaces/:wsId/members?q=`)
  - `page`: 현재 workspace 내 노트 검색
  - `concept`: 프로젝트 KG 벡터 검색
  - `date`: natural language date parser (chrono-node)
- [ ] **Step 3**: 선택 시 serialized format 저장: `@[user:<id>]`, `@[page:<id>]`, `@[concept:<id>]`, `@[date:<iso>]`
- [ ] **Step 4**: 렌더 시 mention chip에 hover preview
- [ ] **Step 5**: comment/note 저장 시 backend에서 mention 파싱 → `comment_mentions` insert → notification worker trigger
- [ ] **Step 6**: Commit

```bash
git commit -m "feat(collab): @mention plugin (user/page/concept/date) with live combobox resolver"
```

---

### Task 12: Notifications 백엔드 (테이블 + SSE 스트림)

**Files:**
- Create: `packages/db/src/schema/notifications.ts` + `notification_preferences.ts`
- Create: `apps/api/src/routes/notifications.ts`
- Create: `apps/api/src/lib/notifications/dispatch.ts` — notification 생성 + batching
- Create: `apps/api/src/lib/notifications/sse-stream.ts`

- [ ] **Step 1**: 테이블 (collaboration-model §2.4 스키마 그대로)
- [ ] **Step 2**: `dispatch.ts`:
  - `notify(recipientId, type, payload, batchKey?)` — 5분 내 같은 batch_key면 기존 row 업데이트
  - 각 알림 타입별 Zod payload 스키마 검증
- [ ] **Step 3**: SSE 엔드포인트 `GET /api/notifications/stream` — 인증된 사용자의 새 알림 실시간 푸시
- [ ] **Step 4**: `GET /api/notifications?unread=true&limit=50` — 목록
- [ ] **Step 5**: `POST /api/notifications/mark-read` — 일괄 읽음 처리
- [ ] **Step 6**: mention/comment_reply/invite/share/wiki_change/librarian_suggestion 등 이벤트 후크에서 `notify()` 호출
- [ ] **Step 7**: Commit

```bash
git commit -m "feat(api): notifications backend with batching, SSE stream, and read-tracking"
```

---

### Task 13: Notification UI (인앱 뱃지 + 드롭다운)

**Files:**
- Create: `apps/web/src/components/notifications/NotificationBell.tsx`
- Create: `apps/web/src/components/notifications/NotificationList.tsx`
- Create: `apps/web/src/hooks/useNotificationStream.ts`

- [ ] **Step 1**: `useNotificationStream` — SSE 연결 + 새 알림 수신 시 TanStack Query 캐시 update
- [ ] **Step 2**: `NotificationBell` — 상단 바 종 아이콘 + 읽지 않은 수 뱃지
- [ ] **Step 3**: 클릭 시 `NotificationList` 드롭다운 (최근 20개, "모두 읽음" 버튼)
- [ ] **Step 4**: 알림 클릭 → deep link 이동 (예: `/app/w/<ws>/p/<proj>/notes/<note>?commentId=<c>`)
- [ ] **Step 5**: 타입별 아이콘 + 요약 포맷 (mention: "@Alice: ...", invite: "Bob invited you to 'Design Team'")
- [ ] **Step 6**: Commit

```bash
git commit -m "feat(web): in-app notification bell with SSE-backed live updates"
```

---

### Task 14: Email 알림 (Resend + batching + 선호도 UI)

**Files:**
- Create: `apps/worker/src/worker/workflows/notification_delivery.py` (Temporal cron workflow)
- Create: `apps/api/src/lib/email-templates/` (Resend 템플릿들)
- Create: `apps/web/src/app/(app)/settings/notifications/page.tsx`

- [ ] **Step 1**: Temporal cron (매 1분) — `SELECT notifications WHERE emailed_at IS NULL AND created_at < now() - 30s` 조회
- [ ] **Step 2**: 사용자별 선호도 확인 (`notification_preferences`):
  - instant → 즉시 발송 후 `emailed_at` 기록
  - hourly_digest → 묶어서 매 시간 정각 발송
  - daily_digest → 매일 09:00 발송
  - off → 건너뜀
- [ ] **Step 3**: Resend API로 발송, deep link 포함
- [ ] **Step 4**: Settings 페이지 — 타입 × 채널(인앱/이메일) × 빈도 매트릭스 편집 UI
- [ ] **Step 5**: Commit

```bash
git commit -m "feat(collab): email notifications via Resend with per-type preferences and digest batching"
```

---

### Task 15: Activity Feed 페이지

**Files:**
- Create: `apps/api/src/routes/activity.ts`
- Create: `apps/web/src/app/(app)/w/[workspaceId]/activity/page.tsx`
- Create: `apps/web/src/components/activity/ActivityTimeline.tsx`

- [ ] **Step 1**: 기존 `wiki_logs` → `activity_events` 확장 (collab 이벤트 추가, collaboration-model §2.5)
- [ ] **Step 2**: `GET /api/activity?workspace=&project=&actor=&since=&limit=` — keyset pagination (cursor)
- [ ] **Step 3**: `ActivityTimeline` — Twitter 스타일, actor avatar (user 또는 🤖 아이콘) + verb + object
- [ ] **Step 4**: 필터 UI (actor_type: all/user/agent, verb 종류)
- [ ] **Step 5**: Workspace-level / Project-level / 개인 레벨 3가지 뷰
- [ ] **Step 6**: Commit

```bash
git commit -m "feat(collab): activity feed with user + agent event unification"
```

---

### Task 16: Public Share Link

**Files:**
- Create: `packages/db/src/schema/public-share-links.ts`
- Create: `apps/api/src/routes/share.ts`
- Create: `apps/web/src/app/s/[token]/page.tsx` (비로그인 접근 가능)
- Create: `apps/web/src/components/share/ShareDialog.tsx`

- [ ] **Step 1**: 테이블 (collaboration-model §2.6 스키마)
- [ ] **Step 2**: `POST /api/share` — 토큰 발급 (32 bytes random), role, 선택적 암호/만료
- [ ] **Step 3**: `DELETE /api/share/:id` — revoke
- [ ] **Step 4**: `GET /s/:token` — 토큰 검증 + 암호 확인 + 만료 체크 + rate limit (분당 30)
- [ ] **Step 5**: 공개 페이지는 게스트 세션 부여, 코멘트 시 "익명:닉네임" 허용 (옵션)
- [ ] **Step 6**: `<meta name="robots" content="noindex">` 기본 주입, 옵트인 시에만 indexable
- [ ] **Step 7**: `ShareDialog` — 페이지 "Share" 버튼 → 다이얼로그 (link 복사, 권한 선택, 암호 설정)
- [ ] **Step 8**: Commit

```bash
git commit -m "feat(collab): public share links with password/expiry/rate-limit and SEO opt-in"
```

---

### Task 17: Guest Invite 플로우

**Files:**
- Modify: `apps/api/src/routes/invites.ts` — guest role 지원 확인
- Create: `apps/web/src/app/(app)/guest/page.tsx` — guest 전용 간소화 사이드바
- Modify: workspace switcher — guest는 초대받은 리소스만 표시

- [ ] **Step 1**: Guest 초대 시 `page_permissions` 자동 생성 옵션 (초대 시 특정 page id 지정)
- [ ] **Step 2**: Guest 계정은 `canAdmin` 불가, workspace 멤버 목록 조회 불가 (API 403)
- [ ] **Step 3**: 사이드바는 해당 guest에게 공유된 page/project만 표시
- [ ] **Step 4**: Guest는 `workspaces.plan_type`에 따라 수 제한 (Free 3, Pro 10, Enterprise 무제한)
- [ ] **Step 5**: 코멘트 작성 시 다른 guest의 이메일 숨김 (이름만 표시)
- [ ] **Step 6**: Commit

```bash
git commit -m "feat(collab): guest user flow with scoped resource visibility and plan-based caps"
```

---

### Verification

- [ ] `pnpm --filter @opencairn/web dev` starts without TypeScript errors
- [ ] Navigating to `/app/w/<ws>/p/<proj>/notes/<note>` renders the Plate editor with content loaded from the API
- [ ] Typing `$...$` inserts an inline LaTeX node rendered by KaTeX
- [ ] Typing `$$...$$` inserts a block LaTeX node
- [ ] Typing `[[` opens the note search combobox; selecting a result inserts a wiki-link node
- [ ] Clicking a wiki-link navigates to the target note
- [ ] Typing `/` opens the slash command menu; selecting "Heading 1" converts the block
- [ ] Edits auto-save after 1.5 s (check network tab for PATCH `/notes/:id`)
- [ ] Sidebar renders folders and notes; clicking a note navigates; "New note" creates and redirects
- [ ] `pnpm --filter @opencairn/web build` succeeds (no missing imports)

**협업 검증**:

- [ ] 같은 페이지를 두 브라우저에서 동시 편집 → 실시간 동기화, 커서·아바타 표시
- [ ] Viewer 권한 사용자가 편집 시도 → 서버에서 reject, 클라이언트 read-only
- [ ] 블록 hover 시 "💬 Add comment" → 댓글 스레드 생성, 답글·resolve 동작
- [ ] `@`로 user 멘션 → 대상자에게 인앱 + 이메일 알림 (선호도에 따라)
- [ ] 공개 링크 생성 → 비로그인 브라우저에서 viewer 모드로 접근, editor 권한 부여 불가
- [ ] Admin이 다른 workspace의 page 접근 시도 → 404
- [ ] Guest는 workspace 멤버 목록 API 호출 시 403
- [ ] Hocuspocus 연결 시 Better Auth 세션 없으면 WebSocket 거부
- [ ] Activity feed에 🤖 Compiler Agent 활동과 👤 사용자 활동이 통합 표시
