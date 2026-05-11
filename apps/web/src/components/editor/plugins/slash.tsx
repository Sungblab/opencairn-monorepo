"use client";

import { toggleList } from "@platejs/list";
import { insertTable } from "@platejs/table";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Code,
  Columns2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Languages,
  List,
  ListOrdered,
  Minus,
  PanelTop,
  Quote,
  SearchCheck,
  Sigma,
  Sparkles,
  Table2,
  ToggleLeft,
  Video,
  WandSparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentCommandId } from "@/components/agent-panel/agent-commands";

// Plan 2A Task 17 — slash command menu.
//
// Trigger: `/` keypress inside the editor opens a caret-anchored portal menu
// with block conversions. Clicking (or Enter on) an item removes the
// triggering `/` via `editor.tf.deleteBackward("character")` and runs the
// transform. Escape / outside-click closes without touching the document.
//
// Plate v49 quirks worth flagging (see plan lines 2568-2712 for the original
// but-partially-wrong call-outs):
//   * `editor.tf.toggleBlock({ type })` does NOT exist. Use the per-plugin
//     transform `editor.tf.<key>.toggle()` (matches the toolbar at
//     editor-toolbar.tsx + NoteEditor.tsx:138-152).
//   * `editor.tf.insertNode` is the singular, deprecated form. v49 ships
//     `editor.tf.insertNodes(node | nodes[], options?)`.
//   * `deleteBackward` takes a `TextUnit` — 'character' | 'word' | 'line' |
//     'block' — confirmed against @platejs/slate 49.2.21's index.d.ts.
//   * The `hr` void node has no `editor.tf.insert.hr` helper; we insert the
//     node via raw `insertNodes`, then drop an empty paragraph after so the
//     caret is not trapped inside a void.
//   * There is no `@platejs/code-block` installed, so the "code" slash
//     command toggles the inline `code` mark (same behaviour as the
//     toolbar). A future upgrade can swap it for a block once the dep is
//     added; i18n label has been narrowed from "코드 블록"/"Code block" to
//     plain "코드"/"Code" to match.
//   * Math now inserts the local `equation` node. MathBlock owns the edit
//     popover, so an empty `texExpression` is immediately fixable in-place.

export type SlashBlockKey =
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "blockquote"
  | "code"
  | "hr"
  | "equation"
  | "mermaid"
  | "callout"
  | "toggle"
  | "table"
  | "columns"
  | "image"
  | "embed";

export type SlashAiKey =
  | "improve"
  | "translate"
  | "summarize"
  | "expand"
  | "cite"
  | "factcheck";

type SlashAgentKey = Extract<
  AgentCommandId,
  "make_note" | "extract_citations"
>;

export type SlashKey = SlashBlockKey | SlashAiKey | SlashAgentKey;

type SlashGroup = "ai" | "text" | "research" | "structure" | "media";

type SlashBlockLabelKey =
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list"
  | "numbered_list"
  | "quote"
  | "code"
  | "divider"
  | "math"
  | "mermaid"
  | "callout"
  | "toggle"
  | "table"
  | "columns"
  | "image"
  | "embed";

interface SlashBlockDef {
  key: SlashBlockKey;
  group: Exclude<SlashGroup, "ai">;
  icon: LucideIcon;
  labelKey: SlashBlockLabelKey;
  descriptionKey: SlashBlockLabelKey;
  keywords: string[];
}

interface SlashAiDef {
  key: SlashAiKey;
  group: "ai";
  icon: LucideIcon;
  // Plan 11B Phase A — labels live in the dedicated `docEditor.command`
  // namespace so the AI section can be re-skinned independent of the
  // editor block menu.
  labelKey: SlashAiKey;
  descriptionKey: SlashAiKey;
  keywords: string[];
}

interface SlashAgentDef {
  key: SlashAgentKey;
  group: "research";
  icon: LucideIcon;
  labelKey: SlashAgentKey;
  descriptionKey: SlashAgentKey;
  keywords: string[];
}

type SlashCommandDef = SlashBlockDef | SlashAiDef | SlashAgentDef;

interface SlashMenuPosition {
  left: number;
  top: number;
}

const MENU_WIDTH = 420;
const MENU_MAX_HEIGHT = 420;
const MENU_GAP = 8;
const GROUP_ORDER: Record<SlashGroup, number> = {
  ai: 0,
  text: 1,
  research: 2,
  structure: 3,
  media: 4,
};

const BLOCK_COMMANDS: SlashBlockDef[] = [
  {
    key: "h1",
    group: "text",
    icon: Heading1,
    labelKey: "heading_1",
    descriptionKey: "heading_1",
    keywords: ["h1", "heading", "title"],
  },
  {
    key: "h2",
    group: "text",
    icon: Heading2,
    labelKey: "heading_2",
    descriptionKey: "heading_2",
    keywords: ["h2", "heading", "subtitle"],
  },
  {
    key: "h3",
    group: "text",
    icon: Heading3,
    labelKey: "heading_3",
    descriptionKey: "heading_3",
    keywords: ["h3", "heading"],
  },
  {
    key: "ul",
    group: "text",
    icon: List,
    labelKey: "bulleted_list",
    descriptionKey: "bulleted_list",
    keywords: ["bullet", "list", "ul"],
  },
  {
    key: "ol",
    group: "text",
    icon: ListOrdered,
    labelKey: "numbered_list",
    descriptionKey: "numbered_list",
    keywords: ["number", "ordered", "list", "ol"],
  },
  {
    key: "blockquote",
    group: "text",
    icon: Quote,
    labelKey: "quote",
    descriptionKey: "quote",
    keywords: ["quote", "blockquote"],
  },
  {
    key: "code",
    group: "text",
    icon: Code,
    labelKey: "code",
    descriptionKey: "code",
    keywords: ["code", "inline"],
  },
  {
    key: "equation",
    group: "research",
    icon: Sigma,
    labelKey: "math",
    descriptionKey: "math",
    keywords: ["math", "latex", "equation", "수식"],
  },
  {
    key: "hr",
    group: "structure",
    icon: Minus,
    labelKey: "divider",
    descriptionKey: "divider",
    keywords: ["divider", "line", "hr"],
  },
  {
    key: "callout",
    group: "structure",
    icon: PanelTop,
    labelKey: "callout",
    descriptionKey: "callout",
    keywords: ["callout", "info", "alert"],
  },
  {
    key: "toggle",
    group: "structure",
    icon: ToggleLeft,
    labelKey: "toggle",
    descriptionKey: "toggle",
    keywords: ["toggle", "collapse"],
  },
  {
    key: "table",
    group: "structure",
    icon: Table2,
    labelKey: "table",
    descriptionKey: "table",
    keywords: ["table", "grid", "tab"],
  },
  {
    key: "columns",
    group: "structure",
    icon: Columns2,
    labelKey: "columns",
    descriptionKey: "columns",
    keywords: ["columns", "layout"],
  },
  {
    key: "mermaid",
    group: "media",
    icon: Sparkles,
    labelKey: "mermaid",
    descriptionKey: "mermaid",
    keywords: ["diagram", "mermaid", "flowchart"],
  },
  {
    key: "image",
    group: "media",
    icon: Image,
    labelKey: "image",
    descriptionKey: "image",
    keywords: ["image", "picture", "photo"],
  },
  {
    key: "embed",
    group: "media",
    icon: Video,
    labelKey: "embed",
    descriptionKey: "embed",
    keywords: ["embed", "video", "youtube", "loom"],
  },
];

const AI_COMMANDS: SlashAiDef[] = [
  {
    key: "improve",
    group: "ai",
    icon: WandSparkles,
    labelKey: "improve",
    descriptionKey: "improve",
    keywords: ["improve", "rewrite", "polish"],
  },
  {
    key: "translate",
    group: "ai",
    icon: Languages,
    labelKey: "translate",
    descriptionKey: "translate",
    keywords: ["translate", "language"],
  },
  {
    key: "summarize",
    group: "ai",
    icon: FileText,
    labelKey: "summarize",
    descriptionKey: "summarize",
    keywords: ["summarize", "summary"],
  },
  {
    key: "expand",
    group: "ai",
    icon: Sparkles,
    labelKey: "expand",
    descriptionKey: "expand",
    keywords: ["expand", "elaborate"],
  },
];

const RAG_AI_COMMANDS: SlashAiDef[] = [
  {
    key: "cite",
    group: "ai",
    icon: Bot,
    labelKey: "cite",
    descriptionKey: "cite",
    keywords: ["cite", "citation", "evidence"],
  },
  {
    key: "factcheck",
    group: "ai",
    icon: SearchCheck,
    labelKey: "factcheck",
    descriptionKey: "factcheck",
    keywords: ["factcheck", "fact", "verify"],
  },
];

const SOURCE_AGENT_COMMANDS: SlashAgentDef[] = [
  {
    key: "make_note",
    group: "research",
    icon: FileText,
    labelKey: "make_note",
    descriptionKey: "make_note",
    keywords: ["note", "pdf", "source", "자료", "노트"],
  },
  {
    key: "extract_citations",
    group: "research",
    icon: Bot,
    labelKey: "extract_citations",
    descriptionKey: "extract_citations",
    keywords: ["citation", "cite", "source", "인용", "근거"],
  },
];

// Type predicate so the AI dispatch path narrows `key` from `SlashKey`
// to `SlashAiKey` without re-listing each member. Adding a new AI
// command is a one-line edit to AI_COMMANDS — the dispatch site
// stays correct.
const isAiKey = (key: SlashKey): key is SlashAiKey =>
  [...AI_COMMANDS, ...RAG_AI_COMMANDS].some((cmd) => cmd.key === key);

const isAgentKey = (key: SlashKey): key is SlashAgentKey =>
  SOURCE_AGENT_COMMANDS.some((cmd) => cmd.key === key);

const splitEditorCharacters = (value: string) => Array.from(value);

const dropLastEditorCharacter = (value: string) =>
  splitEditorCharacters(value).slice(0, -1).join("");

function readSlashMenuPosition(focused: Element): SlashMenuPosition {
  const selection = window.getSelection();
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rect =
    range && "getBoundingClientRect" in range
      ? range.getBoundingClientRect()
      : null;
  const focusedRect = focused.getBoundingClientRect();
  const anchor =
    rect && (rect.width > 0 || rect.height > 0) ? rect : focusedRect;

  const maxLeft = Math.max(16, window.innerWidth - MENU_WIDTH - 16);
  const left = clamp(anchor.left, 16, maxLeft);
  const below = anchor.bottom + MENU_GAP;
  const above = anchor.top - MENU_MAX_HEIGHT - MENU_GAP;
  const hasRoomBelow = below + MENU_MAX_HEIGHT <= window.innerHeight - 16;
  const top = hasRoomBelow ? below : Math.max(16, above);

  return { left, top };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const normalizeSlashSearch = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLowerCase();

const isPrintableSlashKey = (event: KeyboardEvent) =>
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  splitEditorCharacters(event.key).length === 1;

// The editor surface we actually use. Plate's fully-typed `PlateEditor` drags
// in deep generics; narrow to exactly the transforms this menu touches so the
// caller can pass the editor without an `as any` cast at the usage site (the
// cast lives in `SlashMenuProps` below).
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

export interface SlashMenuProps {
  editor: SlashEditor;
  /**
   * Plan 11B Phase A — when true, an "AI" section is appended after the
   * block-conversion list. Off by default so the menu shape stays
   * unchanged when the doc-editor flag is disabled.
   */
  aiEnabled?: boolean;
  ragEnabled?: boolean;
  /**
   * Fired when the user picks an AI command. The slash menu still removes
   * the triggering `/`, but the actual workflow (selection capture,
   * worker call, InlineDiffSheet) lives in the consumer so the slash
   * plugin stays free of any LLM/data-layer coupling.
   */
  onAiCommand?: (key: SlashAiKey) => void;
  onAgentCommand?: (key: SlashAgentKey) => void;
  /**
   * Plan 2E Phase B — called when a slash command requires a popover UI
   * before insertion (e.g. `/embed` or `/image` needs a URL input). The
   * slash menu removes the triggering `/` and delegates to the caller; the
   * caller owns the popover open/close state and calls the appropriate
   * insert helper on confirm.
   */
  onRequestPopover?: (kind: "embed" | "image") => void;
}

export function SlashMenu({
  editor,
  aiEnabled = false,
  ragEnabled = false,
  onAiCommand,
  onAgentCommand,
  onRequestPopover,
}: SlashMenuProps) {
  const t = useTranslations("editor.slash");
  const tAi = useTranslations("docEditor");

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<SlashMenuPosition>({
    left: 16,
    top: 112,
  });
  useEffect(() => setMounted(true), []);

  const runCommand = useCallback(
    (key: SlashKey) => {
      // Step 1: remove the triggering `/` plus any query the user typed after
      // it. We intentionally keep focus in Plate rather than moving it to a
      // search input, so every query character was already inserted into the
      // document and must be deleted before running the transform.
      const deleteCount = splitEditorCharacters(slashQuery).length + 1;
      for (let i = 0; i < deleteCount; i += 1) {
        editor.tf.deleteBackward("character");
      }

      // AI commands are dispatched to the consumer — the slash plugin
      // stays free of LLM/data-layer coupling. The consumer reads the
      // selection, calls the worker, and renders the diff sheet.
      if (isAiKey(key)) {
        onAiCommand?.(key);
        setOpen(false);
        setSlashQuery("");
        return;
      }

      if (isAgentKey(key)) {
        onAgentCommand?.(key);
        setOpen(false);
        setSlashQuery("");
        return;
      }

      // Popover commands require a UI dialog before insertion. The slash
      // menu removes the triggering `/` and delegates; the caller owns
      // the popover state and performs the actual node insertion.
      if (key === "embed") {
        onRequestPopover?.("embed");
        setOpen(false);
        setSlashQuery("");
        return;
      }
      if (key === "image") {
        onRequestPopover?.("image");
        setOpen(false);
        setSlashQuery("");
        return;
      }

      // Step 2: dispatch the command.
      switch (key) {
        case "h1":
        case "h2":
        case "h3":
        case "blockquote": {
          const tf = editor.tf as unknown as Record<
            string,
            { toggle?: () => void } | undefined
          >;
          tf[key]?.toggle?.();
          break;
        }
        case "ul":
          toggleList(editor as unknown as never, { listStyleType: "disc" });
          break;
        case "ol":
          toggleList(editor as unknown as never, {
            listStyleType: "decimal",
          });
          break;
        case "code":
          editor.tf.code?.toggle();
          break;
        case "hr":
          // Void block — insert the `hr` node, then an empty paragraph so
          // typing after the divider lands in a normal block rather than
          // being trapped against the void.
          editor.tf.insertNodes(
            { type: "hr", children: [{ text: "" }] },
            { select: true },
          );
          editor.tf.insertNodes(
            { type: "p", children: [{ text: "" }] },
            { select: true },
          );
          break;
        case "equation":
          editor.tf.insertNodes(
            { type: "equation", texExpression: "", children: [{ text: "" }] },
            { select: true },
          );
          editor.tf.insertNodes(
            { type: "p", children: [{ text: "" }] },
            { select: true },
          );
          break;
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
          insertTable(
            editor as unknown as Parameters<typeof insertTable>[0],
            { colCount: 3, header: true, rowCount: 3 },
            { select: true },
          );
          break;
        case "columns":
          editor.tf.insertNodes(
            {
              type: "column_group",
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
      }

      setOpen(false);
      setSlashQuery("");
    },
    [editor, onAgentCommand, onAiCommand, onRequestPopover, slashQuery],
  );

  const allItems = useMemo<SlashCommandDef[]>(() => {
    const commands = aiEnabled
      ? [
          ...AI_COMMANDS,
          ...(ragEnabled ? RAG_AI_COMMANDS : []),
          ...SOURCE_AGENT_COMMANDS,
          ...BLOCK_COMMANDS,
        ]
      : [...BLOCK_COMMANDS];
    return commands.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
  }, [aiEnabled, ragEnabled]);

  const items = useMemo(
    () =>
      allItems.map((cmd) => {
        const label =
          cmd.group === "ai"
            ? tAi(`command.${cmd.labelKey}`)
            : cmd.group === "research" &&
                SOURCE_AGENT_COMMANDS.some((item) => item.key === cmd.key)
              ? t(`agent.${cmd.labelKey}`)
            : t(cmd.labelKey);
        const description =
          cmd.group === "ai"
            ? tAi(`description.${cmd.descriptionKey}`)
            : cmd.group === "research" &&
                SOURCE_AGENT_COMMANDS.some((item) => item.key === cmd.key)
              ? t(`description.agent.${cmd.descriptionKey}`)
            : t(`description.${cmd.descriptionKey}`);
        return {
          ...cmd,
          label,
          description,
          searchText: [
            cmd.key,
            label,
            description,
            ...cmd.keywords,
          ]
            .join(" ")
            .normalize("NFKC")
            .toLowerCase(),
        };
      }),
    [allItems, t, tAi],
  );

  const visibleItems = useMemo(() => {
    const query = normalizeSlashSearch(slashQuery);
    if (!query) return items;
    return items.filter((cmd) =>
      normalizeSlashSearch(cmd.searchText).includes(query),
    );
  }, [items, slashQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (activeIndex < visibleItems.length) return;
    setActiveIndex(Math.max(0, visibleItems.length - 1));
  }, [activeIndex, visibleItems.length]);

  // Window-scoped keydown mirrors `WikiLinkCombobox`. The `/` here fires in
  // addition to Plate inserting it into the document — we rely on that so the
  // caret is already one-character-past the trigger when the menu opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME composition (Korean/Japanese/Chinese): the `/` key may fire while
      // a composition is pending — opening the menu and running
      // `deleteBackward` in that state removes a composed codepoint rather
      // than the `/` that was never committed. Bail early for both the
      // modern `isComposing` flag and the legacy `keyCode === 229` signal.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "/" && !open && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // S1-001: the listener is window-scoped, so a `/` typed in the note
        // title input or a comment composer would otherwise pop the menu.
        // Selecting a command then calls `editor.tf.deleteBackward("character")`
        // against the editor and silently destroys unrelated editor content.
        // Plate's `Editable` sets `data-slate-editor="true"` on the
        // contenteditable surface — gate on that.
        const focused = document.activeElement;
        const inEditor =
          focused instanceof Element &&
          focused.closest('[data-slate-editor="true"]') !== null;
        if (!inEditor) return;
        // Let Plate process the `/` insertion first, then anchor the menu to
        // the updated caret rect. Falling back to the editor rect keeps tests
        // and odd browser selection states usable without centering the menu
        // over the whole page.
        setTimeout(() => {
          setPosition(readSlashMenuPosition(focused));
          setSlashQuery("");
          setActiveIndex(0);
          setOpen(true);
        }, 0);
        return;
      }

      if (!open) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setSlashQuery("");
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((index) =>
          visibleItems.length === 0 ? 0 : (index + 1) % visibleItems.length,
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((index) =>
          visibleItems.length === 0
            ? 0
            : (index - 1 + visibleItems.length) % visibleItems.length,
        );
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const active = visibleItems[activeIndex];
        if (!active) return;
        runCommand(active.key);
        return;
      }

      if (e.key === "Backspace") {
        if (slashQuery.length === 0) {
          setOpen(false);
          return;
        }
        setSlashQuery((query) => dropLastEditorCharacter(query));
        return;
      }

      const isPrintable = isPrintableSlashKey(e);
      if (!isPrintable) return;
      if (e.key.trim() === "") {
        setOpen(false);
        setSlashQuery("");
        return;
      }
      setSlashQuery((query) => `${query}${e.key.toLowerCase()}`);
    };
    const onCompositionEnd = (e: CompositionEvent) => {
      if (!open || !e.data) return;
      setSlashQuery((query) => `${query}${e.data.toLowerCase()}`);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("compositionend", onCompositionEnd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [activeIndex, open, runCommand, slashQuery, visibleItems]);

  const groupLabel = useCallback(
    (group: SlashGroup) => {
      if (group === "ai") return tAi("section.ai");
      return t(`section.${group}`);
    },
    [t, tAi],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-transparent"
      onClick={() => setOpen(false)}
      data-testid="slash-menu"
    >
      <div
        className="fixed w-[min(420px,calc(100vw-32px))] rounded-md border border-[color:var(--border)] bg-[color:var(--theme-bg)] shadow-lg"
        style={{ left: position.left, top: position.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[color:var(--border)] px-3 py-2">
          <div className="text-fg-muted text-[11px] font-medium uppercase tracking-wide">
            {t("search_label")}
          </div>
          <div
            data-testid="slash-query"
            className="mt-1 h-6 text-sm font-medium"
          >
            /{slashQuery}
            {!slashQuery ? (
              <span className="text-fg-muted">{t("search_placeholder")}</span>
            ) : null}
          </div>
        </div>
        {visibleItems.length === 0 ? (
          <p className="text-fg-muted px-3 py-4 text-sm">{t("no_results")}</p>
        ) : (
          <ul
            className="app-scrollbar-thin max-h-80 overflow-auto py-1"
            role="listbox"
            aria-label={t("aria_label")}
          >
            {visibleItems.map((cmd, i) => (
              <Fragment key={cmd.key}>
                {(i === 0 || visibleItems[i - 1]?.group !== cmd.group) && (
                  <li
                    className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted"
                    data-testid={`slash-section-${cmd.group}`}
                    aria-hidden="true"
                  >
                    {groupLabel(cmd.group)}
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    data-testid={`slash-cmd-${cmd.key}`}
                    onMouseDown={(e) => {
                      // Prevent the editor from losing selection before we run
                      // the transform — same pattern as the toolbar buttons.
                      e.preventDefault();
                      runCommand(cmd.key);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm ${
                      i === activeIndex
                        ? "bg-[color:var(--theme-surface)]"
                        : "hover:bg-[color:var(--theme-surface)]"
                    }`}
                  >
                    <cmd.icon
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{cmd.label}</span>
                      <span className="text-fg-muted mt-0.5 block text-xs">
                        {cmd.description}
                      </span>
                    </span>
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
