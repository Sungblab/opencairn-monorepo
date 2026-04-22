"use client";

// Plan 2B Task 18 — renders a root comment and its replies. The API returns
// a flat list ordered by createdAt desc; CommentsPanel groups into root+
// replies[] before passing here. A reply composer is always appended when the
// viewer has comment permission (canComment prop).

import { useTranslations } from "next-intl";

import {
  useDeleteComment,
  useResolveComment,
} from "@/hooks/useComments";
import type { CommentResponse } from "@/lib/api-client";

import { CommentComposer } from "./CommentComposer";

interface ThreadProps {
  noteId: string;
  root: CommentResponse & { replies: CommentResponse[] };
  canComment: boolean;
}

export function CommentThread({ noteId, root, canComment }: ThreadProps) {
  const t = useTranslations("collab.comments");
  const resolve = useResolveComment(noteId);
  const remove = useDeleteComment(noteId);

  // Orphan label: a block-anchored thread whose anchor block was deleted by
  // the Hocuspocus reaper (anchorBlockId set to NULL server-side on sweep).
  // We can't reliably distinguish "never had anchor" from "had anchor, lost
  // it" once null — until we add a sentinel, show the label only if the root
  // has at least one reply AND anchorBlockId is null (page-level threads
  // rarely grow replies without context, so this heuristic keeps the label
  // from spamming new empty page-level threads). See task notes.
  const isOrphanBlock =
    root.anchorBlockId === null && root.replies.length > 0;

  return (
    <div className="space-y-3">
      <CommentItem
        c={root}
        onResolve={canComment ? () => resolve.mutate(root.id) : undefined}
        onDelete={canComment ? () => remove.mutate(root.id) : undefined}
        resolveLabel={root.resolvedAt ? t("unresolved") : t("resolve")}
        deleteLabel={t("delete")}
      />
      {isOrphanBlock && (
        <p className="text-fg-muted text-xs">{t("orphan_block")}</p>
      )}
      {root.replies.length > 0 && (
        <ul className="ml-4 space-y-2 border-l pl-3">
          {root.replies.map((r) => (
            <li key={r.id}>
              <CommentItem
                c={r}
                onDelete={canComment ? () => remove.mutate(r.id) : undefined}
                deleteLabel={t("delete")}
              />
            </li>
          ))}
        </ul>
      )}
      {canComment && <CommentComposer noteId={noteId} parentId={root.id} />}
    </div>
  );
}

function CommentItem({
  c,
  onResolve,
  onDelete,
  resolveLabel,
  deleteLabel,
}: {
  c: CommentResponse;
  onResolve?: () => void;
  onDelete?: () => void;
  resolveLabel?: string;
  deleteLabel?: string;
}) {
  return (
    <article className="space-y-1">
      <header className="text-fg-muted flex items-center gap-2 text-xs">
        {/* authorId shown truncated as a placeholder; user profile lookup
            (name + avatar) lands with the mention combobox in Task 19. */}
        <span>{c.authorId.slice(0, 8)}</span>
        <span>·</span>
        <time dateTime={c.createdAt}>
          {new Date(c.createdAt).toLocaleString()}
        </time>
        {c.resolvedAt && <span className="text-emerald-600">✓</span>}
      </header>
      <p className="text-sm whitespace-pre-wrap">{c.body}</p>
      {(onResolve || onDelete) && (
        <div className="flex gap-3 text-xs">
          {onResolve && resolveLabel && (
            <button
              type="button"
              onClick={onResolve}
              className="hover:underline"
            >
              {resolveLabel}
            </button>
          )}
          {onDelete && deleteLabel && (
            <button
              type="button"
              onClick={onDelete}
              className="text-destructive hover:underline"
            >
              {deleteLabel}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
