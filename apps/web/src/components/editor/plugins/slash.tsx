"use client";

import { toggleList } from "@platejs/list";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

// Plan 2A Task 17 — slash command menu.
//
// Trigger: `/` keypress anywhere in the editor opens a centered portal menu
// with nine block conversions. Clicking (or Enter on) an item removes the
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
//   * `math_block` is intentionally NOT in the menu. `editor.tf.insert.equation()`
//     inserts a void node with empty `texExpression`, which MathBlock then
//     renders as a permanent red parse-error banner (no edit popover ships in
//     Plan 2A). Re-enable once Plan 2D provides a TeX input UX — the
//     `editor.slash.math` i18n key is kept in the bundle for that.

export type SlashBlockKey =
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

export type SlashAiKey =
  | "improve"
  | "translate"
  | "summarize"
  | "expand"
  | "cite"
  | "factcheck";

export type SlashKey = SlashBlockKey | SlashAiKey;

// `tNode` helper keeps the menu as an ordered list so the E2E can assert a
// stable sequence.
interface SlashBlockDef {
  key: SlashBlockKey;
  section: "block";
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

interface SlashAiDef {
  key: SlashAiKey;
  section: "ai";
  // Plan 11B Phase A — labels live in the dedicated `docEditor.command`
  // namespace so the AI section can be re-skinned independent of the
  // editor block menu.
  labelKey: SlashAiKey;
}

type SlashCommandDef = SlashBlockDef | SlashAiDef;

const BLOCK_COMMANDS: SlashBlockDef[] = [
  { key: "h1", section: "block", labelKey: "heading_1" },
  { key: "h2", section: "block", labelKey: "heading_2" },
  { key: "h3", section: "block", labelKey: "heading_3" },
  { key: "ul", section: "block", labelKey: "bulleted_list" },
  { key: "ol", section: "block", labelKey: "numbered_list" },
  { key: "blockquote", section: "block", labelKey: "quote" },
  { key: "code", section: "block", labelKey: "code" },
  { key: "hr", section: "block", labelKey: "divider" },
  { key: "mermaid", section: "block", labelKey: "mermaid" },
  { key: "callout", section: "block", labelKey: "callout" },
  { key: "toggle", section: "block", labelKey: "toggle" },
  { key: "table", section: "block", labelKey: "table" },
  { key: "columns", section: "block", labelKey: "columns" },
];

const AI_COMMANDS: SlashAiDef[] = [
  { key: "improve", section: "ai", labelKey: "improve" },
  { key: "translate", section: "ai", labelKey: "translate" },
  { key: "summarize", section: "ai", labelKey: "summarize" },
  { key: "expand", section: "ai", labelKey: "expand" },
];

const RAG_AI_COMMANDS: SlashAiDef[] = [
  { key: "cite", section: "ai", labelKey: "cite" },
  { key: "factcheck", section: "ai", labelKey: "factcheck" },
];

// Type predicate so the AI dispatch path narrows `key` from `SlashKey`
// to `SlashAiKey` without re-listing each member. Adding a new AI
// command is a one-line edit to AI_COMMANDS — the dispatch site
// stays correct.
const isAiKey = (key: SlashKey): key is SlashAiKey =>
  [...AI_COMMANDS, ...RAG_AI_COMMANDS].some((cmd) => cmd.key === key);

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
}

export function SlashMenu({
  editor,
  aiEnabled = false,
  ragEnabled = false,
  onAiCommand,
}: SlashMenuProps) {
  const t = useTranslations("editor.slash");
  const tAi = useTranslations("docEditor");

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Window-scoped keydown mirrors `WikiLinkCombobox`. The `/` here fires in
  // addition to Plate inserting it into the document — we rely on that so the
  // caret is already one-character-past the trigger when the menu opens, and
  // command execution then calls `deleteBackward` to remove it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME composition (Korean/Japanese/Chinese): the `/` key may fire while
      // a composition is pending — opening the menu and running
      // `deleteBackward` in that state removes a composed codepoint rather
      // than the `/` that was never committed. Bail early for both the
      // modern `isComposing` flag and the legacy `keyCode === 229` signal.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "/" && !open && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Let Plate process the `/` insertion first, then open on the next
        // tick. setTimeout(0) is sufficient — no need to read DOM state.
        setTimeout(() => setOpen(true), 0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const runCommand = useCallback(
    (key: SlashKey) => {
      // Step 1: remove the triggering `/` that Plate already inserted.
      editor.tf.deleteBackward("character");

      // AI commands are dispatched to the consumer — the slash plugin
      // stays free of LLM/data-layer coupling. The consumer reads the
      // selection, calls the worker, and renders the diff sheet.
      if (isAiKey(key)) {
        onAiCommand?.(key);
        setOpen(false);
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
    },
    [editor, onAiCommand],
  );

  const items = useMemo<SlashCommandDef[]>(
    () =>
      aiEnabled
        ? [
            ...BLOCK_COMMANDS,
            ...AI_COMMANDS,
            ...(ragEnabled ? RAG_AI_COMMANDS : []),
          ]
        : [...BLOCK_COMMANDS],
    [aiEnabled, ragEnabled],
  );

  // Pre-compute the index of the first row in the AI section so the
  // section header renders inline without a second pass.
  const firstAiIndex = useMemo(
    () => items.findIndex((c) => c.section === "ai"),
    [items],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32"
      onClick={() => setOpen(false)}
      data-testid="slash-menu"
    >
      <div
        className="bg-bg-base w-full max-w-xs rounded-md border border-[color:var(--border)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <ul className="max-h-72 overflow-auto py-1">
          {items.map((cmd, i) => (
            <Fragment key={cmd.key}>
              {i === 8 && (
                <li
                  className="my-1 border-t border-[color:var(--border)]"
                  aria-hidden="true"
                />
              )}
              {firstAiIndex !== -1 && i === firstAiIndex && (
                <li
                  className="my-1 border-t border-[color:var(--border)] pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted"
                  data-testid="slash-section-ai"
                  aria-hidden="true"
                >
                  <span className="px-3">{tAi("section.ai")}</span>
                </li>
              )}
              <li>
                <button
                  type="button"
                  data-testid={`slash-cmd-${cmd.key}`}
                  onMouseDown={(e) => {
                    // Prevent the editor from losing selection before we run
                    // the transform — same pattern as the toolbar buttons.
                    e.preventDefault();
                    runCommand(cmd.key);
                  }}
                  className="hover:bg-bg-muted w-full px-3 py-2 text-left text-sm"
                >
                  {cmd.section === "ai"
                    ? tAi(`command.${cmd.labelKey}`)
                    : t(cmd.labelKey)}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
