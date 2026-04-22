"use client";

// Plan 2B Task 18 — plain-textarea composer. Task 19 (mention combobox)
// replaces the <textarea> with the Plate-powered mention editor; until then
// the body is parsed server-side as pure text (mentions field is extracted
// from a regex in the API route, so literal @handle typing still works).

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useCreateComment } from "@/hooks/useComments";

interface ComposerProps {
  noteId: string;
  /** Root comment id when posting a reply; undefined for a new root thread. */
  parentId?: string;
  /**
   * Block anchor id (Plate node id) for block-level threads. `null` / omitted
   * means the comment is attached to the page, not to a specific block.
   */
  anchorBlockId?: string | null;
  onSubmitted?: () => void;
}

export function CommentComposer({
  noteId,
  parentId,
  anchorBlockId,
  onSubmitted,
}: ComposerProps) {
  const t = useTranslations("collab.comments");
  const [body, setBody] = useState("");
  const { mutate, isPending } = useCreateComment(noteId);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = body.trim();
        if (!trimmed) return;
        mutate(
          { body: trimmed, parentId, anchorBlockId },
          {
            onSuccess: () => {
              setBody("");
              onSubmitted?.();
            },
          },
        );
      }}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
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
    </form>
  );
}
