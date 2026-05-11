"use client";

import { createPlatePlugin } from "platejs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import type { NoteSearchHit } from "@/lib/api-client";
import { useNoteSearch } from "@/hooks/use-note-search";

import {
  WikiLinkElement,
  type WikiLinkContext,
  type WikiLinkElement as TWikiLinkElement,
} from "../elements/wiki-link-element";

export const WIKILINK_KEY = "wiki-link";

// Plan 2A Task 16 — inline, non-void wiki-link node. The element carries
// `targetId`/`title` and renders through a `next/link`; `element.deleted` flips
// the rendering to a muted strikethrough (tombstone state set by a later sweep
// task). `[[` autoformat is deferred per the plan; MVP insertion flow is the
// Cmd/Ctrl+K combobox implemented below. The plugin is created per-editor via
// `createWikiLinkPlugin({ wsSlug, projectId })` so the element component has
// the routing context it needs without reaching back into page params.
export function createWikiLinkPlugin(ctx: WikiLinkContext) {
  return createPlatePlugin({
    key: WIKILINK_KEY,
    node: {
      isElement: true,
      isInline: true,
      isVoid: false,
      // Wrap the shared element so the render receives the workspace/project
      // context captured at plugin-construction time.
      component: (props) => <WikiLinkElement {...props} {...ctx} />,
    },
  });
}

/** The node shape emitted into the editor on insert. */
export function buildWikiLinkNode(hit: NoteSearchHit): TWikiLinkElement {
  return {
    type: WIKILINK_KEY,
    targetId: hit.id,
    title: hit.title,
    children: [{ text: "" }],
  };
}

// ---------------------------------------------------------------------------
// Combobox portal. A window-scoped Cmd/Ctrl+K opens it. When a result is
// selected the node is inserted at the current selection via
// `editor.tf.insertNodes` (plural) followed by a trailing space so the caret
// lands outside the inline.
// ---------------------------------------------------------------------------

export interface WikiLinkComboboxProps {
  ctx: WikiLinkContext;
  // Intentionally loose: the editor passed by `usePlateEditor` has a strong
  // internal type, but we only call `.tf.insertNodes` and `.tf.insertText` on
  // it and Plate's `editor.tf` is indexed by any string. Narrowing here would
  // drag in Plate's generic plumbing for no gain.
  editor: {
    tf: {
      insertNodes: (node: unknown, options?: { select?: boolean }) => void;
      insertText: (text: string) => void;
      focus?: () => void;
    };
  };
}

export function WikiLinkCombobox({ ctx, editor }: WikiLinkComboboxProps) {
  const t = useTranslations("editor.wikilink");

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `useNoteSearch` is enabled only when `q.length >= 1`; treat "no data" as
  // the zero state so the empty-string case shows the hint instead of the
  // "no matches" message.
  const { data, isFetching } = useNoteSearch(query, ctx.projectId);

  // Open on Cmd/Ctrl+K. Using window-scoped keydown matches the plan. Keep
  // the handler stable so the listener doesn't churn on every re-render.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  // Autofocus on open, reset on close.
  useEffect(() => {
    if (open) {
      // Next tick so the portal mounts before we focus.
      queueMicrotask(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  const handleSelect = useCallback(
    (hit: NoteSearchHit) => {
      const node = buildWikiLinkNode(hit);
      editor.tf.insertNodes(node, { select: true });
      editor.tf.insertText(" ");
      setOpen(false);
    },
    [editor],
  );

  const hits: NoteSearchHit[] = useMemo(() => data ?? [], [data]);

  // The portal target is the document body — SSR guard keeps Next.js from
  // screaming during the static render pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32"
      onClick={() => setOpen(false)}
      data-testid="wikilink-combobox"
    >
      <div
        className="w-full max-w-md rounded-md border border-[color:var(--border)] bg-[color:var(--theme-bg)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hint")}
          className="w-full border-b border-[color:var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              e.preventDefault();
              handleSelect(hits[0]);
            }
          }}
        />
        <ul className="app-scrollbar-thin max-h-72 overflow-auto py-1">
          {query.length === 0 ? (
            <li className="text-fg-muted px-3 py-2 text-xs">{t("hint")}</li>
          ) : hits.length === 0 && !isFetching ? (
            <li className="text-fg-muted px-3 py-2 text-xs">
              {t("search_empty")}
            </li>
          ) : (
            hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  data-testid={`wikilink-result-${hit.id}`}
                  onClick={() => handleSelect(hit)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--theme-surface)]"
                >
                  {hit.title || t("hint")}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
