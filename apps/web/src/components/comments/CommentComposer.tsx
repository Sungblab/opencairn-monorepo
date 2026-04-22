"use client";

// Plan 2B Task 19 — @mention autocomplete composer.
//
// MVP keeps a plain <textarea> as the source of truth (no Plate instance,
// no MentionChip element). Typing "@" opens a floating menu with 4 type
// tabs (user / page / concept / date); selecting a result replaces the
// `@<query>` substring with the raw token `@[type:id] ` — that string
// survives the submit payload, and server-side `parseMentions`
// (apps/api/src/lib/mention-parser.ts) extracts tokens into
// `comment_mentions` rows.
//
// Deferrals (intentional, out of MVP scope):
//   1. Rendering chips in the comment DISPLAY (CommentItem body) — tokens
//      currently show as the literal string "@[user:<uuid>]". A follow-up
//      will swap to chip-styled spans using the same parseOne helper.
//   2. Keyboard navigation in the menu (Up/Down/Enter) — click is the only
//      selection path. Esc closes. A keyboard-nav pass is Tier-2.
//   3. Avatar rendering — MentionSearchResult.avatarUrl is threaded but not
//      yet painted; waiting on a shared Avatar primitive.
//   4. Converting the composer to a Plate editor + MentionPlugin — the
//      original plan considered this; rejected for MVP because the extra
//      Plate instance adds style/keyboard/accessibility surface area with
//      no user-visible win over raw tokens.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useCreateComment } from "@/hooks/useComments";
import {
  useMentionSearch,
  type MentionSearchResult,
} from "@/hooks/useMentionSearch";
import { serialize, type MentionType } from "@/lib/mention-format";

interface ComposerProps {
  noteId: string;
  /**
   * Workspace scope for `/api/mentions/search`. Threaded down from
   * CommentsPanel → NoteEditor → page (note.workspaceId).
   */
  workspaceId: string;
  /** Root comment id when posting a reply; undefined for a new root thread. */
  parentId?: string;
  /**
   * Block anchor id (Plate node id) for block-level threads. `null` / omitted
   * means the comment is attached to the page, not to a specific block.
   */
  anchorBlockId?: string | null;
  onSubmitted?: () => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function CommentComposer({
  noteId,
  workspaceId,
  parentId,
  anchorBlockId,
  onSubmitted,
}: ComposerProps) {
  const t = useTranslations("collab.comments");
  const tMention = useTranslations("collab.mention");
  const { mutate, isPending } = useCreateComment(noteId);

  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Mention menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<MentionType>("user");
  const [query, setQuery] = useState("");
  // Character index of the triggering "@" in `body` — anchors the replace
  // range when a result is selected.
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);

  // For the user/page/concept tabs `query` is the text typed after "@" and
  // we fire a search. For the date tab the user types YYYY-MM-DD directly
  // into a dedicated input; we don't query the backend.
  const searchType: "user" | "page" | "concept" =
    tab === "date" ? "user" : tab;
  const { data: results } = useMentionSearch({
    type: searchType,
    q: query,
    workspaceId,
    enabled: menuOpen && tab !== "date" && workspaceId.length > 0,
  });

  const closeMenu = () => {
    setMenuOpen(false);
    setTriggerIndex(null);
    setQuery("");
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);

    const caret = e.target.selectionStart;
    // Walk backwards from the caret to find the nearest "@". Stop on
    // whitespace or string start. The "@" must itself sit at string start
    // or be preceded by whitespace (so "email@domain" does NOT trigger).
    let idx = caret - 1;
    while (idx >= 0 && !/\s/.test(value[idx]!) && value[idx] !== "@") {
      idx--;
    }
    if (
      idx >= 0 &&
      value[idx] === "@" &&
      (idx === 0 || /\s/.test(value[idx - 1]!))
    ) {
      setMenuOpen(true);
      setTriggerIndex(idx);
      setQuery(value.slice(idx + 1, caret));
    } else {
      // Caret moved outside any active trigger — close the menu without
      // clearing the body.
      if (menuOpen) closeMenu();
    }
  };

  const insertToken = (tokenString: string) => {
    if (triggerIndex === null || !textareaRef.current) return;
    const el = textareaRef.current;
    const caret = el.selectionStart;
    const next =
      body.slice(0, triggerIndex) + tokenString + " " + body.slice(caret);
    setBody(next);
    closeMenu();
    // Restore caret to just after the inserted token + trailing space.
    const newCaret = triggerIndex + tokenString.length + 1;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
    });
  };

  const onResultClick = (r: MentionSearchResult) => {
    insertToken(serialize({ type: r.type, id: r.id }));
  };

  const onDateSubmit = () => {
    if (!DATE_RE.test(query)) return;
    insertToken(serialize({ type: "date", id: query }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    mutate(
      { body: trimmed, parentId, anchorBlockId },
      {
        onSuccess: () => {
          setBody("");
          closeMenu();
          onSubmitted?.();
        },
      },
    );
  };

  const tabs: readonly MentionType[] = ["user", "page", "concept", "date"];

  return (
    <form className="relative space-y-2" onSubmit={submit}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === "Escape" && menuOpen) {
            e.preventDefault();
            closeMenu();
          }
        }}
        placeholder={t("composer_placeholder")}
        rows={2}
        className="bg-background w-full rounded border p-2 text-sm"
        disabled={isPending}
      />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending || !body.trim()}
          className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm disabled:opacity-50"
        >
          {t("add_button")}
        </button>
      </div>

      {menuOpen && (
        <div className="bg-popover absolute top-full right-0 left-0 z-10 mt-1 rounded border shadow">
          <div className="flex border-b text-xs">
            {tabs.map((x) => (
              <button
                type="button"
                key={x}
                onClick={() => setTab(x)}
                className={`flex-1 px-2 py-1 ${
                  tab === x ? "bg-muted font-medium" : ""
                }`}
              >
                {tMention(`combobox_hint.${x}`)}
              </button>
            ))}
          </div>
          {tab === "date" ? (
            <div className="flex items-center gap-2 p-2">
              <input
                placeholder={tMention("date.format_hint")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="bg-background flex-1 rounded border p-1 text-sm"
              />
              <button
                type="button"
                onClick={onDateSubmit}
                disabled={!DATE_RE.test(query)}
                className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs disabled:opacity-50"
              >
                {tMention("date.insert")}
              </button>
            </div>
          ) : (
            <ul className="max-h-48 overflow-y-auto">
              {(results ?? []).map((r) => (
                <li key={`${r.type}:${r.id}`}>
                  <button
                    type="button"
                    onClick={() => onResultClick(r)}
                    className="hover:bg-muted flex w-full items-center gap-2 p-2 text-left text-sm"
                  >
                    <span className="font-medium">{r.label}</span>
                    {r.sublabel && (
                      <span className="text-fg-muted text-xs">
                        {r.sublabel}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {results && results.length === 0 && (
                <li className="text-fg-muted p-2 text-xs">
                  {tMention("empty")}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
