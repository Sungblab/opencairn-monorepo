# Plan 2: Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully-featured rich-text note editor in `apps/web` using Plate v49 with LaTeX, wiki-links, slash commands, and real-time save/load wired to the Hono API.

**Architecture:** The editor lives in `apps/web` as a client component. All persistence goes through the Hono API at `apps/api` — no Server Actions. Plate v49 provides the plugin-based editing foundation; custom plugins handle wiki-links and slash commands. The sidebar (folder tree + note list) is a separate client component that reads from the API and drives navigation.

**Tech Stack:** Plate v49, shadcn/ui, KaTeX, @platejs/math (MathKit), Tailwind CSS 4, Hono 4, Zod, React 19, Next.js 16

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
```

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

### Verification

- [ ] `pnpm --filter @opencairn/web dev` starts without TypeScript errors
- [ ] Navigating to `/notes/[noteId]` renders the Plate editor with content loaded from the API
- [ ] Typing `$...$` inserts an inline LaTeX node rendered by KaTeX
- [ ] Typing `$$...$$` inserts a block LaTeX node
- [ ] Typing `[[` opens the note search combobox; selecting a result inserts a wiki-link node
- [ ] Clicking a wiki-link navigates to the target note
- [ ] Typing `/` opens the slash command menu; selecting "Heading 1" converts the block
- [ ] Edits auto-save after 1.5 s (check network tab for PATCH `/notes/:id`)
- [ ] Sidebar renders folders and notes; clicking a note navigates; "New note" creates and redirects
- [ ] `pnpm --filter @opencairn/web build` succeeds (no missing imports)
