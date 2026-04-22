"use client";

// Plan 2B Task 18 — right-rail panel listing all comment threads on a note.
// API returns a flat list ordered desc by createdAt; we re-group by
// parentId into (root, replies[]) pairs so `CommentThread` can render each
// conversation as a single card. Root threads keep the API's desc order
// (newest first); replies inside each thread render asc (oldest first), which
// matches how people read conversations top-down.

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useComments } from "@/hooks/useComments";
import type { CommentResponse } from "@/lib/api-client";

import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";

interface CommentsPanelProps {
  noteId: string;
  /**
   * True if the viewer has at least the `commenter` role. Gates the top-level
   * composer and all per-thread reply/resolve/delete buttons. Viewers see
   * the panel read-only.
   */
  canComment: boolean;
}

function groupByRoot(comments: CommentResponse[]) {
  const roots = comments.filter((c) => c.parentId === null);
  return roots.map((r) => ({
    ...r,
    replies: comments
      .filter((c) => c.parentId === r.id)
      .sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
      ),
  }));
}

export function CommentsPanel({ noteId, canComment }: CommentsPanelProps) {
  const t = useTranslations("collab.comments");
  const { data, isLoading } = useComments(noteId);

  const threads = useMemo(
    () => groupByRoot(data?.comments ?? []),
    [data?.comments],
  );

  if (isLoading) return null;

  return (
    <aside className="bg-background flex w-80 flex-col border-l">
      <header className="border-b px-4 py-3 font-medium">
        {t("panel_title")}
      </header>

      {canComment && (
        <div className="border-b p-3">
          {/* Page-level composer — anchorBlockId omitted → null on server. */}
          <CommentComposer noteId={noteId} />
        </div>
      )}

      {threads.length === 0 ? (
        <p className="text-fg-muted p-4 text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex-1 divide-y overflow-y-auto">
          {threads.map((root) => (
            <li key={root.id} className="p-4">
              <CommentThread
                noteId={noteId}
                root={root}
                canComment={canComment}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
