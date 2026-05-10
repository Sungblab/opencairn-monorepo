"use client";

// Plan 2B Task 18 — right-rail panel listing all comment threads on a note.
// API returns a flat list ordered desc by createdAt; we re-group by
// parentId into (root, replies[]) pairs so `CommentThread` can render each
// conversation as a single card. Root threads keep the API's desc order
// (newest first); replies inside each thread render asc (oldest first), which
// matches how people read conversations top-down.

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { useComments } from "@/hooks/useComments";
import type { CommentResponse } from "@/lib/api-client";

import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";

interface CommentsPanelProps {
  noteId: string;
  /**
   * Workspace scope for `/api/mentions/search` inside the composer. Forwarded
   * to both the page-level composer and every per-thread reply composer.
   */
  workspaceId: string;
  /**
   * True if the viewer has at least the `commenter` role. Gates the top-level
   * composer and all per-thread reply/resolve/delete buttons. Viewers see
   * the panel read-only.
   */
  canComment: boolean;
  onClose?: () => void;
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

export function CommentsPanel({
  noteId,
  workspaceId,
  canComment,
  onClose,
}: CommentsPanelProps) {
  const t = useTranslations("collab.comments");
  const { data, isLoading } = useComments(noteId);

  const threads = useMemo(
    () => groupByRoot(data?.comments ?? []),
    [data?.comments],
  );

  if (isLoading) return null;

  return (
    <aside
      aria-label={t("panel_title")}
      className="bg-background flex w-full flex-col border-t xl:w-80 xl:border-l xl:border-t-0"
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="font-medium">{t("panel_title")}</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
            aria-label={t("close")}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      {canComment && (
        <div className="border-b p-3">
          {/* Page-level composer — anchorBlockId omitted → null on server. */}
          <CommentComposer noteId={noteId} workspaceId={workspaceId} />
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
                workspaceId={workspaceId}
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
