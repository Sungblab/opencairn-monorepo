# Plan 2: Editor + Notion급 협업 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-04-18 확장**: 본 plan은 에디터 뿐만 아니라 **Notion급 팀 협업 기능**까지 포함한다. 데이터 모델(Workspace/Permissions)은 [Plan 1](2026-04-09-plan-1-foundation.md)에서 셋업되고, 여기서는 그 위에 돌아가는 UI/UX/실시간 동기화/알림을 구현. 설계 근거는 [collaboration-model.md](../../architecture/collaboration-model.md).

**Goal:** Build the OpenCairn main workspace — a **multi-mode tab area** (primary) + AI chat panel (secondary), Cursor 스타일 레이아웃. 탭은 Plate rich-text에 국한되지 않으며 AI 생성 인터랙티브 아티팩트, JSON 뷰어, 소스 파일 뷰어, Pyodide 캔버스를 같은 탭 프레임에서 렌더링한다. AI 채팅이 아티팩트를 생성하면 채팅 버블 안이 아니라 **탭 영역에** 렌더링된다.

**UI 레이아웃 (Cursor 스타일):**
```
[Sidebar] │ [Multi-Mode Tab Area — PRIMARY]        │ [AI Chat Panel — SECONDARY]
          │  ┌─────────────────────────────────┐   │
          │  │ tab: plate │ artifact │ data … │   │  ← 탭 전환
          │  ├─────────────────────────────────┤   │
          │  │  Plate 에디터 / iframe 아티팩트  │   │  AI가 아티팩트 생성
          │  │  / JSON 뷰어 / PDF 뷰어 / Canvas │   │  → 탭에 자동 열림
          │  └─────────────────────────────────┘   │
```

**Tab 모드:**
| 모드 | 렌더러 | 저장 형식 |
|------|--------|----------|
| `plate` | Plate v49 rich-text 에디터 | JSON (Plate Value) |
| `artifact` | sandboxed iframe (ADR-006 패턴) | HTML/React/SVG 문자열 |
| `data` | JSON 트리 뷰어 + 편집기 | JSON |
| `source` | PDF 뷰어 (`@react-pdf-viewer`) | R2 URL → PDF |
| `canvas` | Pyodide WASM + iframe (Plan 7) | Python 코드 문자열 |

**Architecture:** 탭 프레임(`TabShell`)이 `notes.tab_mode`를 읽어 렌더러를 결정한다. 모든 탭 모드는 같은 note row를 공유하며 `content` 컬럼의 의미만 `tab_mode`에 따라 달라진다. AI 채팅이 `<artifact>` 블록을 생성하면 SSE 스트림에서 클라이언트가 감지해 탭을 자동 열거나 업데이트한다. Server Actions 없음, DB 접근 없음 — 모든 퍼시스턴스는 Hono API 경유.

**Tech Stack:** Plate v49 (Yjs 플러그인 + comments 플러그인), shadcn/ui, KaTeX, @platejs/math (MathKit), **Yjs**, **Hocuspocus 서버 + Provider + Awareness**, TanStack Query, Tailwind CSS 4, Hono 4, Zod, React 19, Next.js 16, Resend (이메일 알림), **react-json-view** (JSON 뷰어), **@react-pdf-viewer/core** (PDF), **isomorphic-dompurify** (artifact 정화).

> **Task 개요 (1~7 에디터 + 8~17 협업 + 18~20 렌더링 고도화 + 21 멀티모드 탭)**:
> - Task 1~7: Plate 에디터, LaTeX, wiki-links, slash, save/load, sidebar
> - Task 8~17: Hocuspocus, 공동 편집, 코멘트, @mention, 알림, 공개 링크, 게스트
> - Task 18~20: Claude급 채팅 렌더러, Plate 블록 확장, Chat→Editor 블록 변환
> - **Task 21: Multi-Mode Tab Shell + AI Artifact 렌더러 (신규 — 2026-04-20)**

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
- [ ] **Step 2**: `auth.ts` — Better Auth 세션 토큰 검증 + **Plan 1의 `canWrite` 어댑터 재사용**

> **중요**: Hocuspocus는 Plan 1(`packages/db` + `apps/api/src/lib/permissions.ts`)에서 정의한 `canRead` / `canWrite` / `resolveRole` 헬퍼를 **그대로 재사용**한다. 권한 로직을 Hocuspocus에 중복 구현하지 않는다 — single source of truth는 Plan 1. 별도 패키지(`@opencairn/permissions`)로 뽑거나, `apps/api`에서 export하여 `apps/hocuspocus`에서 import하는 형태로 공유.

**최소 어댑터 예시 (canWrite 기반)**:

```typescript
// apps/hocuspocus/src/auth.ts
import { canWrite } from '@opencairn/api/lib/permissions';
import { auth } from './better-auth-client';

async authenticate({ token, documentName }) {
  const session = await auth.verifyToken(token);
  if (!session) throw new Error('unauthorized');
  const pageId = parseDocumentName(documentName); // 'page:uuid' → uuid
  const allowed = await canWrite(session.userId, 'page', pageId);
  if (!allowed) return { readOnly: true, user: session.user };
  return { user: session.user };
}
```

**전체 auth 핸들러 (resolveRole 기반으로 viewer/editor 구분)**:

```typescript
// apps/hocuspocus/src/auth.ts
import type { onAuthenticatePayload } from "@hocuspocus/server";
import { betterAuth } from "./better-auth-client";
// Plan 1에서 정의된 헬퍼 — 재구현 금지, 그대로 import
import { canWrite, canRead, resolveRole } from "@opencairn/api/lib/permissions";

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

---

## 렌더링 고도화 (Task 18~20) — Claude급 채팅 + Notion 이상급 에디터

> **2026-04-20 추가**: 채팅은 Claude 수준 렌더링, 에디터는 Notion 이상급 블록을 목표로 한다.
> 핵심 원칙: **채팅 답변이 노트로 저장될 때 블록 타입이 정확히 변환**되어야 한다.

### Task 18: Chat Renderer — Claude급 마크다운 렌더링

**목표**: 채팅 답변 영역이 Mermaid 다이어그램, SVG, KaTeX 수식, 코드 하이라이팅, 표, 이미지, callout을 Claude 수준으로 렌더링한다.

**Tech additions:**
```bash
pnpm add mermaid react-syntax-highlighter remark-gfm remark-math rehype-katex
pnpm add -D @types/react-syntax-highlighter
```

**Files:**
- Create: `apps/web/src/components/chat/chat-message-renderer.tsx` — 채팅 메시지 마크다운 렌더러
- Create: `apps/web/src/components/chat/renderers/mermaid-block.tsx`
- Create: `apps/web/src/components/chat/renderers/svg-block.tsx`
- Create: `apps/web/src/components/chat/renderers/code-block.tsx`
- Create: `apps/web/src/components/chat/renderers/callout-block.tsx`

- [ ] **Step 1: ChatMessageRenderer — react-markdown 기반 렌더러**

```tsx
// apps/web/src/components/chat/chat-message-renderer.tsx
'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { MermaidBlock } from './renderers/mermaid-block'
import { SvgBlock } from './renderers/svg-block'
import { CodeBlock } from './renderers/code-block'
import 'katex/dist/katex.min.css'

interface Props {
  content: string
  citations?: { source_type: string; source_id: string; snippet: string }[]
}

export function ChatMessageRenderer({ content, citations }: Props) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const lang = match?.[1] ?? ''
            const code = String(children).replace(/\n$/, '')

            if (lang === 'mermaid') return <MermaidBlock code={code} />
            if (lang === 'svg') return <SvgBlock svg={code} />
            if (match) return <CodeBlock lang={lang} code={code} />

            return <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...props}>{children}</code>
          },
          blockquote({ children }) {
            return (
              <div className="my-2 flex gap-2 rounded-md border-l-4 border-primary/40 bg-primary/5 px-3 py-2">
                <div className="text-primary/60 text-xs mt-0.5">💡</div>
                <div>{children}</div>
              </div>
            )
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="w-full border-collapse text-xs">{children}</table>
              </div>
            )
          },
          th({ children }) {
            return <th className="border border-border bg-muted px-3 py-1.5 text-left font-semibold">{children}</th>
          },
          td({ children }) {
            return <td className="border border-border px-3 py-1.5">{children}</td>
          },
          img({ src, alt }) {
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={alt ?? ''} className="max-w-full rounded-md my-2" />
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {citations && citations.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <p className="text-xs text-muted-foreground mb-1">출처</p>
          <ul className="space-y-0.5">
            {citations.map((c, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                [{i + 1}] {c.snippet}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: MermaidBlock — Mermaid 다이어그램**

```tsx
// apps/web/src/components/chat/renderers/mermaid-block.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

let initialized = false

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
      initialized = true
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    mermaid.render(id, code)
      .then(({ svg }) => setSvg(svg))
      .catch((e) => setError(String(e)))
  }, [code])

  if (error) return <pre className="text-xs text-destructive p-2 rounded bg-muted">{error}</pre>
  if (!svg) return <div className="h-16 animate-pulse rounded bg-muted" />

  return (
    <div
      ref={ref}
      className="my-3 flex justify-center overflow-x-auto rounded-md border bg-background p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
```

- [ ] **Step 3: SvgBlock — 인라인 SVG 안전 렌더링**

```tsx
// apps/web/src/components/chat/renderers/svg-block.tsx
'use client'

import DOMPurify from 'isomorphic-dompurify'

export function SvgBlock({ svg }: { svg: string }) {
  const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })
  return (
    <div
      className="my-3 flex justify-center overflow-x-auto rounded-md border bg-background p-4"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
```

- [ ] **Step 4: CodeBlock — syntax highlighting**

```tsx
// apps/web/src/components/chat/renderers/code-block.tsx
'use client'

import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative my-3 rounded-md border overflow-hidden">
      <div className="flex items-center justify-between bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <span>{lang}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneLight}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.75rem', background: 'transparent' }}
        showLineNumbers={code.split('\n').length > 5}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
```

- [ ] **Step 5**: `isomorphic-dompurify` 추가 (`pnpm add isomorphic-dompurify`)
- [ ] **Commit:** `feat(web): Claude-급 chat renderer — Mermaid, SVG, KaTeX, syntax highlighting`

---

### Task 19: Plate 에디터 블록 확장 — Notion 이상급

**목표**: 에디터가 Notion을 초과하는 블록 종류를 지원한다. 이미지 리사이즈, SVG/Mermaid 블록, callout, toggle, embed iframe, 파일 첨부.

**Tech additions:**
```bash
pnpm add @platejs/media @platejs/toggle @platejs/callout @platejs/table
pnpm add react-resizable-panels
```

**Plate 블록 등록 목록 (note-editor.tsx plugins 배열에 추가):**

| 블록 | Plate 플러그인 | 비고 |
|---|---|---|
| 이미지 (리사이즈) | `@platejs/media` ImagePlugin | R2 업로드 후 URL |
| 파일 첨부 | `@platejs/media` FilePlugin | R2 signed URL |
| Toggle (접기) | `@platejs/toggle` TogglePlugin | Notion 스타일 |
| Callout | `@platejs/callout` CalloutPlugin | info/warn/tip/danger 4종 |
| 표 (Table) | `@platejs/table` TablePlugin | 열 리사이즈, 병합 |
| Mermaid 다이어그램 | custom plugin (void block) | 에디터 내 렌더 |
| SVG 블록 | custom plugin (void block) | inline SVG |
| Embed | custom plugin (iframe void) | YouTube/Figma/URL |
| Column layout | custom plugin | 2/3 column |

**Files:**
- Modify: `apps/web/src/components/editor/note-editor.tsx` (플러그인 추가)
- Create: `apps/web/src/components/editor/elements/mermaid-element.tsx`
- Create: `apps/web/src/components/editor/elements/svg-element.tsx`
- Create: `apps/web/src/components/editor/elements/embed-element.tsx`
- Create: `apps/web/src/components/editor/elements/callout-element.tsx`
- Create: `apps/web/src/components/editor/elements/column-element.tsx`
- Modify: `apps/web/src/components/editor/plugins/slash-command-plugin.tsx` (새 블록 타입 추가)

- [ ] **Step 1: Mermaid 에디터 블록**

```tsx
// apps/web/src/components/editor/elements/mermaid-element.tsx
'use client'

import { useState } from 'react'
import { useSelected, useReadOnly } from 'slate-react'
import { MermaidBlock } from '@/components/chat/renderers/mermaid-block'
import type { PlateElementProps } from '@platejs/core/react'

export function MermaidElement({ element, children, ...props }: PlateElementProps) {
  const selected = useSelected()
  const readOnly = useReadOnly()
  const [editing, setEditing] = useState(false)
  const code = (element as { code?: string }).code ?? ''

  if (!readOnly && (editing || !code)) {
    return (
      <div {...props} contentEditable={false} className="my-2">
        <textarea
          autoFocus
          defaultValue={code}
          className="w-full rounded border bg-muted p-2 font-mono text-xs"
          rows={6}
          onBlur={(e) => {
            // update node data via Plate transforms — handled by plugin
            setEditing(false)
          }}
          placeholder="graph TD&#10;  A --> B"
        />
        <span className="sr-only">{children}</span>
      </div>
    )
  }

  return (
    <div
      {...props}
      contentEditable={false}
      className={`my-2 cursor-pointer rounded ${selected ? 'ring-2 ring-primary' : ''}`}
      onDoubleClick={() => !readOnly && setEditing(true)}
    >
      <MermaidBlock code={code} />
      <span className="sr-only">{children}</span>
    </div>
  )
}
```

- [ ] **Step 2: SVG 블록**

```tsx
// apps/web/src/components/editor/elements/svg-element.tsx
'use client'

import { useState } from 'react'
import { useSelected, useReadOnly } from 'slate-react'
import { SvgBlock } from '@/components/chat/renderers/svg-block'
import type { PlateElementProps } from '@platejs/core/react'

export function SvgElement({ element, children, ...props }: PlateElementProps) {
  const selected = useSelected()
  const readOnly = useReadOnly()
  const [editing, setEditing] = useState(false)
  const svg = (element as { svg?: string }).svg ?? ''

  if (!readOnly && (editing || !svg)) {
    return (
      <div {...props} contentEditable={false} className="my-2">
        <textarea
          autoFocus
          defaultValue={svg}
          className="w-full rounded border bg-muted p-2 font-mono text-xs"
          rows={8}
          placeholder="<svg xmlns='http://www.w3.org/2000/svg'>...</svg>"
          onBlur={() => setEditing(false)}
        />
        <span className="sr-only">{children}</span>
      </div>
    )
  }

  return (
    <div
      {...props}
      contentEditable={false}
      className={`my-2 cursor-pointer rounded ${selected ? 'ring-2 ring-primary' : ''}`}
      onDoubleClick={() => !readOnly && setEditing(true)}
    >
      <SvgBlock svg={svg} />
      <span className="sr-only">{children}</span>
    </div>
  )
}
```

- [ ] **Step 3: Embed (iframe) 블록 — YouTube/Figma/URL**

```tsx
// apps/web/src/components/editor/elements/embed-element.tsx
'use client'

import { useSelected } from 'slate-react'
import type { PlateElementProps } from '@platejs/core/react'

const EMBED_RULES = [
  {
    test: /youtube\.com\/watch\?v=([^&]+)|youtu\.be\/([^?]+)/,
    build: (m: RegExpMatchArray) => `https://www.youtube.com/embed/${m[1] ?? m[2]}`,
  },
  {
    test: /figma\.com\/file\/([^/]+)/,
    build: (url: string) => `https://www.figma.com/embed?embed_host=opencairn&url=${encodeURIComponent(url)}`,
  },
]

function toEmbedUrl(url: string): string {
  for (const rule of EMBED_RULES) {
    const m = url.match(rule.test)
    if (m) return rule.build(m)
  }
  return url
}

export function EmbedElement({ element, children, ...props }: PlateElementProps) {
  const selected = useSelected()
  const url = (element as { url?: string }).url ?? ''
  const embedUrl = toEmbedUrl(url)
  const height = (element as { height?: number }).height ?? 400

  return (
    <div
      {...props}
      contentEditable={false}
      className={`my-3 overflow-hidden rounded-md border ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      <iframe
        src={embedUrl}
        className="w-full"
        style={{ height }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      <span className="sr-only">{children}</span>
    </div>
  )
}
```

- [ ] **Step 4: Callout 블록 (info/warn/tip/danger)**

```tsx
// apps/web/src/components/editor/elements/callout-element.tsx
'use client'

import type { PlateElementProps } from '@platejs/core/react'

const CALLOUT_STYLES = {
  info:    { icon: 'ℹ️', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800' },
  tip:     { icon: '💡', bg: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' },
  warn:    { icon: '⚠️', bg: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800' },
  danger:  { icon: '🚨', bg: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800' },
} as const

type CalloutType = keyof typeof CALLOUT_STYLES

export function CalloutElement({ element, children, ...props }: PlateElementProps) {
  const type = ((element as { calloutType?: string }).calloutType ?? 'info') as CalloutType
  const { icon, bg } = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info

  return (
    <div {...props} className={`my-3 flex gap-3 rounded-md border p-3 ${bg}`}>
      <span className="text-base shrink-0 leading-relaxed">{icon}</span>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  )
}
```

- [ ] **Step 5: 슬래시 커맨드에 새 블록 추가**

`slash-command-plugin.tsx`의 `SLASH_COMMANDS` 배열에 추가:

```ts
{ id: 'mermaid',   label: 'Mermaid Diagram', icon: GitBranch,   type: 'mermaid' },
{ id: 'svg',       label: 'SVG Block',        icon: Shapes,       type: 'svg' },
{ id: 'embed',     label: 'Embed URL',        icon: Link2,        type: 'embed' },
{ id: 'callout',   label: 'Callout',          icon: Info,         type: 'callout' },
{ id: 'toggle',    label: 'Toggle',           icon: ChevronRight, type: 'toggle' },
{ id: 'table',     label: 'Table',            icon: Table,        type: 'table' },
{ id: 'image',     label: 'Image',            icon: ImageIcon,    type: 'img' },
{ id: 'columns',   label: '2 Columns',        icon: Columns,      type: 'column' },
```

- [ ] **Step 6**: note-editor.tsx에 새 플러그인 + element render 등록
- [ ] **Commit:** `feat(web): Plate 에디터 블록 확장 — Mermaid, SVG, Embed, Callout, Toggle, Table, Column`

---

### Task 20: Chat → Editor 자동 블록 변환 (Pin to Page 고도화)

**목표**: 채팅 답변을 "노트에 저장"할 때 마크다운 섹션이 Plate 블록 타입으로 **정확히 변환**된다.

```
채팅 답변
├── # 제목       → h1 블록
├── ## 소제목    → h2 블록
├── ```mermaid  → mermaid void 블록
├── ```python   → code_block 블록
├── $$수식$$    → math_block 블록
├── - 목록      → ul 블록
├── | 표 |      → table 블록
└── 본문 텍스트  → p 블록
```

**Files:**
- Create: `apps/web/src/lib/chat-to-plate.ts` — 마크다운 → Plate Value 변환기
- Create: `apps/web/src/components/chat/save-to-note-button.tsx` — "노트로 저장" 버튼
- Modify: `apps/api/src/routes/notes.ts` — `POST /api/notes/:id/insert-blocks` 엔드포인트

- [ ] **Step 1: chat-to-plate.ts — 변환기**

```ts
// apps/web/src/lib/chat-to-plate.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Value } from '@platejs/core'

type MdNode = {
  type: string
  depth?: number
  lang?: string
  value?: string
  children?: MdNode[]
  ordered?: boolean
  url?: string
  alt?: string
}

function mdNodeToPlate(node: MdNode): unknown[] {
  switch (node.type) {
    case 'heading':
      return [{ type: `h${node.depth ?? 1}`, children: inlineChildren(node) }]
    case 'paragraph':
      return [{ type: 'p', children: inlineChildren(node) }]
    case 'blockquote':
      return [{ type: 'blockquote', children: flatChildren(node) }]
    case 'code': {
      const lang = node.lang ?? ''
      if (lang === 'mermaid') return [{ type: 'mermaid', code: node.value ?? '', children: [{ text: '' }] }]
      if (lang === 'svg') return [{ type: 'svg', svg: node.value ?? '', children: [{ text: '' }] }]
      return [{ type: 'code_block', lang, children: [{ type: 'code_line', children: [{ text: node.value ?? '' }] }] }]
    }
    case 'math':
      return [{ type: 'math_block', latex: node.value ?? '', children: [{ text: '' }] }]
    case 'list':
      return [{ type: node.ordered ? 'ol' : 'ul', children: (node.children ?? []).map((li) => ({
        type: 'li',
        children: flatChildren(li),
      })) }]
    case 'table':
      return [{ type: 'table', children: (node.children ?? []).map((row, ri) => ({
        type: 'tr',
        children: (row.children ?? []).map((cell) => ({
          type: ri === 0 ? 'th' : 'td',
          children: inlineChildren(cell),
        })),
      })) }]
    case 'image':
      return [{ type: 'img', url: node.url ?? '', alt: node.alt ?? '', children: [{ text: '' }] }]
    case 'thematicBreak':
      return [{ type: 'hr', children: [{ text: '' }] }]
    default:
      return []
  }
}

function inlineChildren(node: MdNode): unknown[] {
  if (!node.children?.length) return [{ text: node.value ?? '' }]
  return node.children.flatMap((child): unknown[] => {
    if (child.type === 'text') return [{ text: child.value ?? '' }]
    if (child.type === 'strong') return [{ text: inlineText(child), bold: true }]
    if (child.type === 'emphasis') return [{ text: inlineText(child), italic: true }]
    if (child.type === 'inlineCode') return [{ text: child.value ?? '', code: true }]
    if (child.type === 'inlineMath') return [{ type: 'math_inline', latex: child.value ?? '', children: [{ text: '' }] }]
    return [{ text: inlineText(child) }]
  })
}

function inlineText(node: MdNode): string {
  if (node.value) return node.value
  return (node.children ?? []).map(inlineText).join('')
}

function flatChildren(node: MdNode): unknown[] {
  return (node.children ?? []).flatMap(mdNodeToPlate)
}

export function markdownToPlateValue(markdown: string): Value {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown)

  const blocks = (tree.children as MdNode[]).flatMap(mdNodeToPlate)
  return blocks.length > 0 ? (blocks as Value) : [{ type: 'p', children: [{ text: markdown }] }]
}
```

- [ ] **Step 2: save-to-note-button.tsx**

```tsx
// apps/web/src/components/chat/save-to-note-button.tsx
'use client'

import { useState } from 'react'
import { BookmarkPlus, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { markdownToPlateValue } from '@/lib/chat-to-plate'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface Props {
  content: string
  targetNoteId: string
  messageId: string
  onSaved?: (blockId: string) => void
}

export function SaveToNoteButton({ content, targetNoteId, messageId, onSaved }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'saved'>('idle')

  const handleSave = async () => {
    setState('loading')
    const plateBlocks = markdownToPlateValue(content)

    const res = await fetch(`${API}/notes/${targetNoteId}/insert-blocks`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: plateBlocks, sourceMessageId: messageId }),
    })

    if (res.ok) {
      const { blockId } = await res.json()
      setState('saved')
      onSaved?.(blockId)
    } else {
      setState('idle')
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      onClick={handleSave}
      disabled={state !== 'idle'}
    >
      {state === 'loading' && <Loader2 className="h-3 w-3 animate-spin" />}
      {state === 'saved' && <Check className="h-3 w-3 text-green-500" />}
      {state === 'idle' && <BookmarkPlus className="h-3 w-3" />}
      {state === 'saved' ? '저장됨' : '노트에 저장'}
    </Button>
  )
}
```

- [ ] **Step 3: `POST /api/notes/:id/insert-blocks` 엔드포인트 (Hono)**

```ts
// apps/api/src/routes/notes.ts 에 추가
notes.post('/:id/insert-blocks', requireAuth, zValidator('json', z.object({
  blocks: z.array(z.record(z.unknown())),
  sourceMessageId: z.string().uuid().optional(),
})), async (c) => {
  const { id } = c.req.param()
  const { blocks, sourceMessageId } = c.req.valid('json')
  const userId = c.get('userId')

  const allowed = await canWrite(userId, 'note', id)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const db = c.get('db')
  const note = await db.select().from(notesTable).where(eq(notesTable.id, id)).limit(1)
  if (!note[0]) return c.json({ error: 'Not found' }, 404)

  const existing = parseEditorContent(note[0].content)
  const insertedBlockId = crypto.randomUUID()

  // 첫 번째 삽입 블록에 ID 주입 (pinned_answers 참조용)
  const tagged = blocks.map((b, i) => i === 0 ? { ...b, id: insertedBlockId } : b)
  const updated = [...existing, ...tagged]

  await db.update(notesTable)
    .set({ content: JSON.stringify(updated), updatedAt: new Date() })
    .where(eq(notesTable.id, id))

  // pinned_answers 기록 (Plan 11A 데이터 모델과 연동)
  if (sourceMessageId) {
    await db.insert(pinnedAnswersTable).values({
      messageId: sourceMessageId,
      noteId: id,
      blockId: insertedBlockId,
      pinnedBy: userId,
    })
  }

  return c.json({ blockId: insertedBlockId })
})
```

- [ ] **Step 4**: 채팅 UI의 각 assistant 메시지 하단에 `<SaveToNoteButton>` 렌더
  - 현재 열린 note의 `noteId`를 React context로 공급 (`ActiveNoteContext`)
  - noteId가 없으면 버튼 숨김 (workspace-level 채팅에서는 "저장할 노트 선택" 드롭다운으로 대체)
- [ ] **Commit:** `feat(web,api): chat → editor 자동 블록 변환 + 노트에 저장 버튼`

---

### Verification (Task 18~20)

- [ ] 채팅에서 ` ```mermaid ` 코드블록 → 다이어그램 렌더링
- [ ] 채팅에서 `$E=mc^2$` → KaTeX 인라인 수식
- [ ] 채팅에서 ` ```python ` → syntax highlighting + 복사 버튼
- [ ] 채팅에서 표(GFM table) → 정렬된 테이블 렌더
- [ ] 에디터에서 `/mermaid` → Mermaid 블록 삽입, 더블클릭으로 편집
- [ ] 에디터에서 `/callout` → Callout 블록, 타입별 색상 구분
- [ ] 에디터에서 `/embed` → URL 입력 → YouTube/Figma iframe 렌더
- [ ] "노트에 저장" 클릭 → 마크다운이 Plate 블록으로 변환되어 현재 노트 하단에 삽입
- [ ] 저장 후 에디터 리로드 시 블록 타입 보존 (mermaid → mermaid, code → code_block)

---

## Task 21: Multi-Mode Tab Shell + AI Artifact 렌더러

> **2026-04-20 추가.** 에디터 탭이 Plate에 국한되지 않는 멀티모드 탭으로 진화한다.
> 채팅이 아티팩트(인터랙티브 HTML/React/SVG)를 생성하면 탭 영역에 자동으로 열린다.

### 21-1: DB 스키마 확장

`notes` 테이블에 `tab_mode` 컬럼 추가 (`packages/db/src/schema/notes.ts`):

```ts
tab_mode: text('tab_mode').notNull().default('plate'),
// 'plate' | 'artifact' | 'data' | 'source' | 'canvas'
```

`artifacts` 테이블 신규 생성 (`packages/db/src/schema/artifacts.ts`):

```ts
export const artifacts = pgTable('artifacts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  noteId:       uuid('note_id').references(() => notes.id, { onDelete: 'cascade' }),
  workspaceId:  uuid('workspace_id').notNull(),
  sourceMessageId: uuid('source_message_id'), // FK → conversation_messages (nullable)
  artifactType: text('artifact_type').notNull(), // 'html' | 'react' | 'svg' | 'json'
  title:        text('title').notNull().default('Untitled'),
  content:      text('content').notNull(),       // raw HTML/TSX/SVG/JSON string
  version:      integer('version').notNull().default(1),
  createdBy:    text('created_by').notNull(),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
})
```

- [ ] 마이그레이션 생성: `pnpm db:generate && pnpm db:migrate`
- [ ] **Commit:** `feat(db): add tab_mode to notes, add artifacts table`

---

### 21-2: TabShell — 탭 프레임 컴포넌트

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-shell.tsx` — 탭 컨테이너
- Create: `apps/web/src/components/tab-shell/tab-bar.tsx` — 탭 헤더 바
- Create: `apps/web/src/components/tab-shell/tab-mode-router.tsx` — 모드별 렌더러 라우터

```tsx
// apps/web/src/components/tab-shell/tab-mode-router.tsx
'use client'

import dynamic from 'next/dynamic'

const NoteEditor = dynamic(() => import('@/components/editor/note-editor').then(m => ({ default: m.NoteEditor })))
const ArtifactViewer = dynamic(() => import('./artifact-viewer').then(m => ({ default: m.ArtifactViewer })))
const DataViewer = dynamic(() => import('./data-viewer').then(m => ({ default: m.DataViewer })))
const SourceViewer = dynamic(() => import('@/components/source-viewer/SourceViewer').then(m => ({ default: m.SourceViewer })))

export type TabMode = 'plate' | 'artifact' | 'data' | 'source' | 'canvas'

interface Props {
  mode: TabMode
  noteId: string
  content: string | null
  onSave: (content: string) => void
}

export function TabModeRouter({ mode, noteId, content, onSave }: Props) {
  switch (mode) {
    case 'plate':
      return <NoteEditor noteId={noteId} initialContent={content} onSave={onSave} />
    case 'artifact':
      return <ArtifactViewer html={content ?? ''} noteId={noteId} />
    case 'data':
      return <DataViewer json={content ?? '{}'} onSave={onSave} />
    case 'source':
      return <SourceViewer url={content ?? ''} />
    case 'canvas':
      return <div className="p-4 text-muted-foreground text-sm">Canvas — Plan 7에서 구현</div>
    default:
      return null
  }
}
```

```tsx
// apps/web/src/components/tab-shell/tab-bar.tsx
'use client'

import { FileText, Code2, Braces, FileSearch, Play } from 'lucide-react'
import type { TabMode } from './tab-mode-router'

const TAB_ICONS: Record<TabMode, React.ReactNode> = {
  plate:    <FileText className="h-3.5 w-3.5" />,
  artifact: <Code2 className="h-3.5 w-3.5" />,
  data:     <Braces className="h-3.5 w-3.5" />,
  source:   <FileSearch className="h-3.5 w-3.5" />,
  canvas:   <Play className="h-3.5 w-3.5" />,
}

const TAB_LABELS: Record<TabMode, string> = {
  plate:    'Note',
  artifact: 'Preview',
  data:     'Data',
  source:   'Source',
  canvas:   'Canvas',
}

interface Props {
  availableModes: TabMode[]
  activeMode: TabMode
  onModeChange: (mode: TabMode) => void
  title: string
}

export function TabBar({ availableModes, activeMode, onModeChange, title }: Props) {
  return (
    <div className="flex items-center border-b bg-muted/30">
      <span className="px-3 text-sm font-medium truncate max-w-48">{title}</span>
      <div className="flex ml-2">
        {availableModes.map((mode) => (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors
              ${activeMode === mode
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {TAB_ICONS[mode]}
            {TAB_LABELS[mode]}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Commit:** `feat(web): TabShell — multi-mode tab frame with mode router`

---

### 21-3: ArtifactViewer — 인터랙티브 아티팩트 렌더러

AI가 생성한 HTML/React/SVG를 **sandboxed iframe**에서 안전하게 렌더링. ADR-006 패턴(Pyodide/iframe) 동일 원칙 적용.

```tsx
// apps/web/src/components/tab-shell/artifact-viewer.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'isomorphic-dompurify'
import { RefreshCw, ExternalLink, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  html: string
  noteId: string
  onRequestEdit?: () => void
}

// iframe에 주입할 wrapper — Tailwind CDN, Alpine.js 포함하여 AI 생성 UI가 동작하도록
const IFRAME_WRAPPER = (body: string) => `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"></script>
<style>body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }</style>
</head>
<body>${body}</body>
</html>`

export function ArtifactViewer({ html, noteId, onRequestEdit }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [key, setKey] = useState(0)

  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // script 허용 — iframe sandbox로 격리되어 있어 안전
    FORCE_BODY: true,
    ADD_TAGS: ['script', 'style'],
    ADD_ATTR: ['onclick', 'onchange', 'oninput', 'class', 'id', 'style', 'data-*'],
  })

  const srcDoc = IFRAME_WRAPPER(clean)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20 text-xs text-muted-foreground">
        <span>Interactive Preview</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setKey(k => k + 1)} title="Reload">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => navigator.clipboard.writeText(html)} title="Copy HTML">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <iframe
        key={key}
        ref={iframeRef}
        srcDoc={srcDoc}
        className="flex-1 w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        title={`Artifact: ${noteId}`}
      />
    </div>
  )
}
```

**보안 노트**: `allow-same-origin`은 iframe이 자체 DOM을 읽기 위해 필요. 하지만 `allow-top-navigation`과 `allow-popups`는 제외하여 탈출 불가. AI 생성 콘텐츠라도 DOMPurify로 1차 정화 후 iframe sandbox로 2차 격리.

- [ ] **Commit:** `feat(web): ArtifactViewer — sandboxed iframe renderer for AI artifacts`

---

### 21-4: DataViewer — JSON 뷰어 + 편집기

```tsx
// apps/web/src/components/tab-shell/data-viewer.tsx
'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false })

interface Props {
  json: string
  onSave?: (json: string) => void
}

export function DataViewer({ json, onSave }: Props) {
  const [error, setError] = useState('')

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
    if (error) setError('')
  } catch (e) {
    parsed = null
    if (!error) setError(String(e))
  }

  if (error || parsed === null) {
    return (
      <div className="p-4">
        <p className="text-destructive text-xs">{error || 'Invalid JSON'}</p>
        <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{json}</pre>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4 bg-background">
      <ReactJson
        src={parsed as object}
        theme="rjv-default"
        collapsed={2}
        displayDataTypes={false}
        enableClipboard
        onEdit={onSave ? ({ updated_src }) => onSave(JSON.stringify(updated_src, null, 2)) : false}
        onAdd={onSave ? ({ updated_src }) => onSave(JSON.stringify(updated_src, null, 2)) : false}
        onDelete={onSave ? ({ updated_src }) => onSave(JSON.stringify(updated_src, null, 2)) : false}
      />
    </div>
  )
}
```

- [ ] `pnpm add react-json-view`
- [ ] **Commit:** `feat(web): DataViewer — interactive JSON tree viewer`

---

### 21-5: AI Artifact 생성 프로토콜 + 채팅 → 탭 자동 열기

**AI 응답 형식**: AI 에이전트가 아티팩트를 생성할 때 SSE 스트림에 특별 이벤트를 포함한다.

```ts
// AI 응답 스트림 내 artifact 이벤트 (AgentEvent 9종 중 ToolResult 확장)
{
  type: 'artifact',
  artifactType: 'html' | 'react' | 'svg' | 'json',
  title: string,
  content: string,   // 전체 HTML/SVG/JSON 문자열
  messageId: string,
}
```

**클라이언트 SSE 핸들러** (`apps/web/src/hooks/use-chat-stream.ts`):

```ts
// SSE 이벤트 파싱 중 artifact 이벤트 감지
case 'artifact': {
  const { artifactType, title, content, messageId } = event
  // 1. DB에 artifact 저장 (POST /api/artifacts)
  const res = await fetch('/api/artifacts', {
    method: 'POST',
    body: JSON.stringify({ artifactType, title, content, sourceMessageId: messageId, workspaceId }),
  })
  const { artifactId, noteId } = await res.json()
  // 2. 탭 영역에서 해당 note를 artifact 모드로 자동 열기
  openTab({ noteId, mode: 'artifact' })
  break
}
```

**API 엔드포인트** (`apps/api/src/routes/artifacts.ts`):

```ts
// POST /api/artifacts — AI 생성 아티팩트 저장
artifacts.post('/', requireAuth, zValidator('json', z.object({
  workspaceId: z.string().uuid(),
  artifactType: z.enum(['html', 'react', 'svg', 'json']),
  title: z.string(),
  content: z.string(),
  sourceMessageId: z.string().uuid().optional(),
})), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('userId')
  const db = c.get('db')

  // note row 자동 생성 (tab_mode = 'artifact')
  const [note] = await db.insert(notesTable).values({
    workspaceId: body.workspaceId,
    title: body.title,
    content: body.content,
    tabMode: 'artifact',
    createdBy: userId,
  }).returning()

  await db.insert(artifactsTable).values({
    noteId: note.id,
    workspaceId: body.workspaceId,
    sourceMessageId: body.sourceMessageId,
    artifactType: body.artifactType,
    title: body.title,
    content: body.content,
    createdBy: userId,
  })

  return c.json({ artifactId: note.id, noteId: note.id }, 201)
})

// PATCH /api/artifacts/:id — AI가 채팅에서 아티팩트 업데이트 (버전 증가)
artifacts.patch('/:id', requireAuth, zValidator('json', z.object({
  content: z.string(),
})), async (c) => {
  const { id } = c.req.param()
  const { content } = c.req.valid('json')
  const userId = c.get('userId')

  const allowed = await canWrite(userId, 'note', id)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await db.update(artifactsTable)
    .set({ content, version: sql`version + 1`, updatedAt: new Date() })
    .where(eq(artifactsTable.noteId, id))

  await db.update(notesTable)
    .set({ content, updatedAt: new Date() })
    .where(eq(notesTable.id, id))

  return c.json({ ok: true })
})
```

- [ ] **Commit:** `feat(web,api): AI artifact protocol — SSE artifact event → tab auto-open`

---

### 21-6: 채팅 패널 레이아웃 (우측 보조 패널)

**Layout 구조** (`apps/web/src/app/(app)/layout.tsx` 확장):

```tsx
// 3-panel Cursor 스타일 레이아웃
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Panel 1: Sidebar */}
      <Sidebar projectId={...} />

      {/* Panel 2: Main tab area (PRIMARY) */}
      <main className="min-w-0 flex-1 overflow-hidden">
        {children}  {/* TabShell이 여기에 렌더됨 */}
      </main>

      {/* Panel 3: AI Chat (SECONDARY, 접기 가능) */}
      <ChatPanel />
    </div>
  )
}
```

`ChatPanel` 컴포넌트:
- 기본 너비 `360px`, 최소 `280px`, 최대 `520px` (드래그 리사이즈)
- 헤더: 현재 스코프 칩 + Strict/Expand 토글 (Plan 11A 스펙)
- 메시지 목록: `ChatMessageRenderer` (Task 18) 사용
- 아티팩트 생성 시 탭 영역 자동 포커스 (`openTab()` 호출)
- `⌘ J`로 접기/펼치기 토글

- [ ] Create: `apps/web/src/components/chat-panel/chat-panel.tsx`
- [ ] Create: `apps/web/src/components/chat-panel/chat-input.tsx`
- [ ] Create: `apps/web/src/components/chat-panel/chat-message-list.tsx`
- [ ] **Commit:** `feat(web): 3-panel Cursor-style layout — TabShell primary, ChatPanel secondary`

---

### 21-7: 아티팩트 버전 히스토리 UI

AI가 같은 아티팩트를 채팅에서 수정할 때마다 버전이 증가한다. 탭 바 우측에 `v3` 뱃지 + 클릭 시 버전 드롭다운.

```tsx
// tab-bar.tsx 확장 — 우측에 버전 표시기
{activeMode === 'artifact' && artifactVersion > 1 && (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto">
        v{artifactVersion}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      {versions.map((v) => (
        <DropdownMenuItem key={v.version} onClick={() => loadVersion(v.version)}>
          v{v.version} — {formatRelative(v.updatedAt)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)}
```

- [ ] `GET /api/artifacts/:id/versions` 엔드포인트 (artifacts 테이블 버전별 조회)
- [ ] **Commit:** `feat(web,api): artifact version history UI`

---

### Verification (Task 21)

**Multi-mode Tab:**
- [ ] 노트 탭에서 `plate` / `artifact` / `data` / `source` 탭 버튼 전환 → 각 렌더러 정상 로드
- [ ] `artifact` 탭: HTML 인터랙티브 버튼 클릭 동작 (iframe 내 JS 실행)
- [ ] `data` 탭: JSON 트리 열기/닫기, 편집 후 저장
- [ ] 탭 전환 후 되돌아와도 스크롤 위치 유지

**AI Artifact Flow:**
- [ ] 채팅에서 "Transformer 구조 인터랙티브 다이어그램 만들어줘" → AI가 HTML 아티팩트 생성 → 탭 영역에 자동 열림
- [ ] 채팅에서 "버튼 색을 파란색으로 바꿔줘" → 아티팩트 업데이트 → v2로 버전 증가
- [ ] 버전 드롭다운에서 v1 선택 → 이전 버전으로 롤백
- [ ] 아티팩트 내 `<script>` XSS 시도 → DOMPurify 정화 후 무해화 확인

**레이아웃:**
- [ ] `⌘ J`로 채팅 패널 접기/펼치기
- [ ] 채팅 패널 드래그 리사이즈 (280px ~ 520px)
- [ ] 사이드바 + 탭 + 채팅 3패널이 모바일(< 768px)에서 채팅 패널 숨김

---

## Task 22: Split Pane

> 상세 설계: `docs/superpowers/specs/2026-04-20-tab-system-design.md` §4

**라이브러리:** `react-resizable-panels`

**Files:**
- Modify: `apps/web/src/components/tab-shell/tab-shell.tsx`
- Create: `apps/web/src/components/tab-shell/split-pane.tsx`
- Modify: `apps/web/src/store/tab-store.ts` (`splitWith`, `splitSide` 필드)

- [ ] **Step 1**: `Tab` 타입에 `splitWith: string | null`, `splitSide: 'left' | 'right' | null` 추가
- [ ] **Step 2**: `SplitPane` 컴포넌트 — `react-resizable-panels` `PanelGroup` + `PanelResizeHandle`
- [ ] **Step 3**: TabBar 탭 우클릭 컨텍스트 메뉴에 "Split Right" / "Split Down" 추가
- [ ] **Step 4**: `⌘\` 단축키 → 현재 탭의 Split 토글 (새 빈 탭과 분할)
- [ ] **Step 5**: 드래그 리사이즈 핸들 — hover 시 `bg-primary/40` 강조
- [ ] **Step 6**: Split 해제 — 핸들 더블클릭 또는 "Unsplit" 버튼
- [ ] **Step 7**: 모바일(`< 768px`)에서 split 자동 해제
- [ ] **Step 8**: SSE `split` 이벤트 처리 — AI가 split pane 자동 구성

```ts
// tab-store.ts 액션 추가
splitTab(tabId: string, direction: 'right' | 'down') {
  const newTab = createEmptyTab()
  set(state => ({
    tabs: [...state.tabs,
      { ...state.tabs.find(t => t.id === tabId)!, splitWith: newTab.id, splitSide: 'left' },
      { ...newTab, splitWith: tabId, splitSide: 'right' }
    ]
  }))
}
```

- [ ] **Commit:** `feat(web): Split Pane — react-resizable-panels + AI-driven split`

**Verification:**
- [ ] `⌘\` → 현재 탭 옆에 빈 탭 분할 오픈
- [ ] PDF source 탭 | plate 탭 분할 후 양쪽 독립 스크롤
- [ ] 드래그 핸들로 50:30 비율 변경
- [ ] 핸들 더블클릭 → 단일 탭으로 복귀
- [ ] 모바일에서 split 시도 → 자동 해제 + 토스트 안내

---

## Task 23: Diff View — AI 수정 제안 Accept/Reject

> 상세 설계: `docs/superpowers/specs/2026-04-20-tab-system-design.md` §5

**라이브러리:** `diff` (npm)

**Files:**
- Create: `apps/web/src/components/tab-shell/diff-viewer.tsx`
- Create: `apps/web/src/lib/diff-engine.ts`
- Modify: `apps/web/src/hooks/use-chat-stream.ts` (diff SSE 이벤트 처리)
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.tsx` (diff case 추가)

- [ ] **Step 1**: `pnpm add diff && pnpm add -D @types/diff`

- [ ] **Step 2**: `diff-engine.ts` — hunk 단위 apply/reject

```ts
// apps/web/src/lib/diff-engine.ts
import { parsePatch, applyPatch } from 'diff'
import type { ParsedDiff } from 'diff'

export interface DiffHunk {
  index: number
  oldLines: string[]
  newLines: string[]
  context: string[]
  accepted: boolean | null  // null = pending
}

export function parseDiffHunks(patch: string): DiffHunk[] {
  const [parsed] = parsePatch(patch)
  return (parsed?.hunks ?? []).map((hunk, i) => ({
    index: i,
    oldLines: hunk.lines.filter(l => l.startsWith('-')).map(l => l.slice(1)),
    newLines: hunk.lines.filter(l => l.startsWith('+')).map(l => l.slice(1)),
    context: hunk.lines.filter(l => l.startsWith(' ')).map(l => l.slice(1)),
    accepted: null,
  }))
}

export function applyAcceptedHunks(original: string, patch: string, accepted: Set<number>): string {
  const hunks = parsePatch(patch)[0]?.hunks ?? []
  // accepted 인덱스 hunk만 적용, 나머지 skip
  const filteredPatch = { ...parsePatch(patch)[0], hunks: hunks.filter((_, i) => accepted.has(i)) }
  return applyPatch(original, filteredPatch) || original
}
```

- [ ] **Step 3**: `DiffViewer` 컴포넌트

```tsx
// apps/web/src/components/tab-shell/diff-viewer.tsx
'use client'

import { useState } from 'react'
import { parseDiffHunks, applyAcceptedHunks } from '@/lib/diff-engine'
import { Button } from '@/components/ui/button'

interface Props {
  original: string
  patch: string
  summary: string
  onApply: (result: string) => void
  onReject: () => void
}

export function DiffViewer({ original, patch, summary, onApply, onReject }: Props) {
  const hunks = parseDiffHunks(patch)
  const [decisions, setDecisions] = useState<Record<number, boolean>>({})

  const decide = (idx: number, accept: boolean) =>
    setDecisions(d => ({ ...d, [idx]: accept }))

  const allDecided = hunks.every((_, i) => decisions[i] !== undefined)

  const handleAcceptAll = () => {
    const accepted = new Set(hunks.map((_, i) => i))
    onApply(applyAcceptedHunks(original, patch, accepted))
  }

  const handleApply = () => {
    const accepted = new Set(Object.entries(decisions).filter(([, v]) => v).map(([k]) => Number(k)))
    onApply(applyAcceptedHunks(original, patch, accepted))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
        <span className="text-sm text-muted-foreground">{summary}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onReject}>Reject All</Button>
          <Button size="sm" variant="outline" onClick={handleAcceptAll}>Accept All</Button>
          {allDecided && <Button size="sm" onClick={handleApply}>Apply</Button>}
        </div>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {hunks.map((hunk, i) => (
          <div key={i} className={`border-b ${
            decisions[i] === true ? 'bg-green-50 dark:bg-green-950/20' :
            decisions[i] === false ? 'bg-muted/30' : ''
          }`}>
            {/* Context lines */}
            {hunk.context.slice(0, 3).map((line, j) => (
              <div key={j} className="px-4 py-0.5 text-muted-foreground">{line}</div>
            ))}
            {/* Removed lines */}
            {hunk.oldLines.map((line, j) => (
              <div key={j} className="px-4 py-0.5 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400">
                - {line}
              </div>
            ))}
            {/* Added lines */}
            {hunk.newLines.map((line, j) => (
              <div key={j} className="px-4 py-0.5 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400">
                + {line}
              </div>
            ))}
            {/* Accept/Reject buttons */}
            <div className="flex gap-2 px-4 py-1.5">
              <button
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  decisions[i] === true ? 'bg-green-500 text-white border-green-500' : 'border-border hover:border-green-500'
                }`}
                onClick={() => decide(i, true)}
              >Accept</button>
              <button
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  decisions[i] === false ? 'bg-muted text-muted-foreground border-border' : 'border-border hover:bg-muted'
                }`}
                onClick={() => decide(i, false)}
              >Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4**: SSE `diff` 이벤트 처리 (`use-chat-stream.ts`)

```ts
case 'diff': {
  const { noteId, patch, summary } = event
  // 해당 노트 탭을 diff 모드로 전환
  tabStore.setTabMode(noteId, 'diff', { patch, summary })
  break
}
```

- [ ] **Step 5**: `tab-mode-router.tsx`에 `diff` case 추가
- [ ] **Step 6**: Diff 완료(모든 hunk 결정) → 자동으로 `plate` 모드 복귀 + dirty 표시
- [ ] **Commit:** `feat(web): Diff View — AI 수정 제안 hunk 단위 accept/reject`

**Verification:**
- [ ] 채팅에서 "이 노트 교정해줘" → diff 이벤트 → 탭이 diff 모드로 전환
- [ ] 개별 hunk Accept → 초록 배경 + Apply 버튼 활성
- [ ] Reject All → 원본 그대로 plate 모드 복귀
- [ ] Accept All → 전체 patch 적용 후 plate 모드 복귀 + dirty 표시
- [ ] Apply (일부 accept) → 선택된 hunk만 적용

---

## Task 24: 추가 탭 모드 (Reading / Spreadsheet / Whiteboard / Presentation / Command Palette)

> 상세 설계: `docs/superpowers/specs/2026-04-20-tab-system-design.md` §6, §8

### 24-A: Reading Mode

- [ ] `apps/web/src/components/tab-shell/reading-viewer.tsx` — Plate readOnly 마운트
- [ ] 편집 UI 제거 (툴바 숨김, 슬래시 커맨드 비활성)
- [ ] 우측 상단: 예상 읽기 시간 (`Math.ceil(wordCount / 200)분`)
- [ ] 폰트 크기 슬라이더 (14~20px, `localStorage` 저장)
- [ ] 집중 모드: 사이드바 + 채팅 패널 자동 숨김 (`⌘Shift R` 토글)
- [ ] **Commit:** `feat(web): Reading Mode — 집중 읽기, 읽기 시간, 폰트 조절`

### 24-B: Spreadsheet Mode

```bash
pnpm add @tanstack/react-table
```

- [ ] `apps/web/src/components/tab-shell/spreadsheet-viewer.tsx`
- [ ] 셀 타입: 텍스트 / 숫자 / 날짜 / 체크박스 / enum(선택) / 위키링크
- [ ] 컬럼 리사이즈 (드래그 핸들), 정렬, 행 추가/삭제
- [ ] CSV import (`File` API) / CSV export
- [ ] 저장 형식: `{ columns: ColDef[], rows: Record<string, unknown>[] }` JSON
- [ ] AI가 JSON/CSV 데이터 생성 시 → 자동으로 `spreadsheet` 탭에 열림
- [ ] **Commit:** `feat(web): Spreadsheet Mode — 연구 데이터 테이블 뷰어/편집기`

### 24-C: Whiteboard Mode (Excalidraw)

```bash
pnpm add @excalidraw/excalidraw
```

- [ ] `apps/web/src/components/tab-shell/whiteboard-viewer.tsx`
- [ ] Excalidraw 상태 → JSON 직렬화 → `note.content` 저장 (debounce 2s)
- [ ] Hocuspocus Yjs 연동: `ExcalidrawElement[]` → Yjs `Array` → 실시간 협업 화이트보드
- [ ] 툴바: 선택/손/펜/도형/텍스트/이미지 (Excalidraw 기본 제공)
- [ ] **Commit:** `feat(web): Whiteboard Mode — Excalidraw 실시간 협업 화이트보드`

### 24-D: Presentation Mode

- [ ] `apps/web/src/components/tab-shell/presentation-viewer.tsx`
- [ ] Reveal.js CDN을 iframe `srcDoc`에 주입 (ArtifactViewer와 동일 sandbox 패턴)
- [ ] `F11` → 풀스크린 API
- [ ] `←` / `→` 키 이벤트 → iframe으로 포워딩
- [ ] 발표자 노트 토글 (`⌘Alt N`)
- [ ] Plan 10 `html_slides` 출력 → 자동으로 `presentation` 탭에 열림
- [ ] **Commit:** `feat(web): Presentation Mode — Reveal.js 슬라이드 풀스크린`

### 24-E: Quick Open + Command Palette

- [ ] **Quick Open** (`⌘P`): `apps/web/src/components/quick-open/quick-open.tsx`
  - 노트 제목 + 최근 탭 통합 검색
  - `⌘Enter` → Split pane으로 열기
  - Fuzzy match (`fzf` 알고리즘 라이브러리 또는 자체 구현)
- [ ] **Command Palette** (`⌘Shift P`): `apps/web/src/components/command-palette/command-palette.tsx`
  - 탭 동작: Split / Unsplit / Pin / Close Others
  - 뷰 전환: Reading / Presentation / Whiteboard
  - AI 동작: Generate Artifact / Suggest Edits / Open KG

```bash
pnpm add fzf  # fuzzy search
```

- [ ] **Commit:** `feat(web): Quick Open (⌘P) + Command Palette (⌘⇧P)`

### 24-F: 탭 키보드 단축키 전체 등록

`apps/web/src/hooks/use-tab-shortcuts.ts`:

```ts
useHotkeys('meta+t', () => tabStore.openNewTab())
useHotkeys('meta+w', () => tabStore.closeActiveTab())
useHotkeys('meta+shift+t', () => tabStore.restoreLastClosed())
useHotkeys('meta+backslash', () => tabStore.splitActive())
useHotkeys('meta+j', () => chatPanelStore.toggle())
useHotkeys('meta+shift+k', () => chatPanelStore.injectSelection())
useHotkeys('meta+p', () => quickOpenStore.open())
useHotkeys('meta+shift+p', () => commandPaletteStore.open())
useHotkeys('meta+shift+r', () => tabStore.toggleReadingMode())
useHotkeys('f11', () => tabStore.togglePresentation())
// meta+1~9 → 탭 n번으로 이동
Array.from({ length: 9 }, (_, i) =>
  useHotkeys(`meta+${i + 1}`, () => tabStore.goToTab(i))
)
```

```bash
pnpm add react-hotkeys-hook
```

- [ ] **Commit:** `feat(web): 탭 키보드 단축키 전체 등록 (⌘T/W/\/J/P/⇧P/⇧R/F11)`

---

### Verification (Task 22~24)

**Split Pane:**
- [ ] `⌘\` → Split / Unsplit 토글
- [ ] PDF source + plate 분할 후 양쪽 독립 스크롤
- [ ] AI "두 노트 비교해줘" → split 이벤트 → 자동 분할

**Diff View:**
- [ ] AI 교정 제안 → diff 탭 전환 → hunk 단위 accept/reject
- [ ] Accept All → plate 모드 복귀, dirty(●) 표시

**Reading Mode:**
- [ ] `⌘⇧R` → 툴바 사라지고 집중 읽기 UI
- [ ] 폰트 슬라이더 조절 → localStorage 저장

**Spreadsheet:**
- [ ] 셀 클릭 편집 → Tab으로 다음 셀 이동
- [ ] CSV export → 다운로드

**Whiteboard:**
- [ ] Excalidraw 드로잉 → 2초 후 자동 저장
- [ ] 두 브라우저에서 동시 편집 → 실시간 동기화

**Presentation:**
- [ ] `⌘⇧P` → "Enter Presentation" → 슬라이드 로드
- [ ] `F11` → 풀스크린
- [ ] `←` / `→` → 슬라이드 이동

**Quick Open / Command Palette:**
- [ ] `⌘P` → fuzzy 검색 → `Enter` 탭 오픈
- [ ] `⌘⇧P` → "Split Right" 선택 → split 실행
